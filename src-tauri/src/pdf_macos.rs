// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! WKWebView's print operation for `pdf.rs`. It is a file of its own, taking the WKWebView,
//! so a small program can run the same code on a test page and look at the PDF it makes.
//!
//! The operation runs as wry's Print… does, with `runOperationModalForWindow`, and says it has
//! finished through a delegate. The blocking `runOperation` wrote blank pages without end
//! from a WKWebView in a test program; the likely cause is that the web process draws the
//! pages while the main thread waits.

use std::cell::RefCell;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Mutex;

use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject};
use objc2::{define_class, msg_send, sel, AnyThread, DefinedClass};
use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob, NSPrintingPaginationMode};
use objc2_foundation::{NSObjectProtocol, NSSize, NSString, NSURL};
use objc2_web_kit::WKWebView;

/// The bench sheet's 9.5 mm print margins, in points.
const MARGIN_PT: f64 = 27.0;

/// The delegate's state, safe to touch from any thread, as the operation may spawn its own
/// (`setCanSpawnSeparateThread`) and which one AppKit calls back on isn't promised.
struct Ivars {
    done: Mutex<Option<Sender<Result<(), String>>>>,
    finished: AtomicBool,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements, and this class has no Drop.
    #[unsafe(super(NSObject))]
    #[name = "StrandivoPdfDone"]
    #[ivars = Ivars]
    struct PdfDone;

    impl PdfDone {
        #[unsafe(method(printOperationDidRun:success:contextInfo:))]
        fn did_run(&self, _operation: &NSPrintOperation, success: Bool, _context: *mut c_void) {
            let done = self.ivars().done.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
            if let Some(done) = done {
                let _ = done.send(if success.as_bool() { Ok(()) } else { Err("macOS couldn't write the file.".into()) });
            }
            // Last, so the delegate is let go only once it has nothing left to do.
            self.ivars().finished.store(true, Ordering::Release);
        }
    }

    unsafe impl NSObjectProtocol for PdfDone {}
);

impl PdfDone {
    fn new(done: Sender<Result<(), String>>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(Ivars { done: Mutex::new(Some(done)), finished: AtomicBool::new(false) });
        unsafe { msg_send![super(this), init] }
    }
}

thread_local! {
    /// The delegates of operations still running: AppKit doesn't keep them. A finished one
    /// is let go when the next export starts, never from inside its own callback.
    static RUNNING: RefCell<Vec<Retained<PdfDone>>> = const { RefCell::new(Vec::new()) };
}

/// Starts writing the page's print layout to `path`; the outcome arrives on `done`. An
/// error before the operation starts is returned instead, and `done` is then dropped.
/// Must run on the main thread, as `with_webview`'s callback does.
pub fn start(webview: &WKWebView, path: &str, width_pt: f64, height_pt: f64, done: Sender<Result<(), String>>) -> Result<(), String> {
    RUNNING.with(|running| running.borrow_mut().retain(|d| !d.ivars().finished.load(Ordering::Acquire)));
    // SAFETY: AppKit and WebKit calls on the main thread, on objects that live through them.
    unsafe {
        if !webview.respondsToSelector(sel!(printOperationWithPrintInfo:)) {
            return Err("This needs macOS 11 or later.".into());
        }
        let window = webview.window().ok_or("The window isn't showing.")?;
        // A fresh NSPrintInfo, so the app's shared print settings are left alone.
        let print_info = NSPrintInfo::new();
        print_info.setPaperSize(NSSize::new(width_pt, height_pt));
        print_info.setTopMargin(MARGIN_PT);
        print_info.setBottomMargin(MARGIN_PT);
        print_info.setLeftMargin(MARGIN_PT);
        print_info.setRightMargin(MARGIN_PT);
        print_info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
        print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
        print_info.setJobDisposition(NSPrintSaveJob);
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        let url_obj: &AnyObject = url.as_ref();
        let _: () = msg_send![&*print_info.dictionary(), setObject: url_obj, forKey: NSPrintJobSavingURL];

        let operation = webview.printOperationWithPrintInfo(&print_info);
        operation.setShowsPrintPanel(false);
        operation.setShowsProgressPanel(false);
        operation.setCanSpawnSeparateThread(true);
        let delegate = PdfDone::new(done);
        RUNNING.with(|running| running.borrow_mut().push(delegate.clone()));
        let delegate_obj: &AnyObject = delegate.as_ref();
        operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
            &window,
            Some(delegate_obj),
            Some(sel!(printOperationDidRun:success:contextInfo:)),
            std::ptr::null_mut(),
        );
    }
    Ok(())
}

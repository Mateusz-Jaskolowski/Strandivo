// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Saves the current window's print layout directly to a PDF file using each platform's
//! native webview printing engine (NSPrintOperation on macOS, WebView2 PrintToPdf on
//! Windows, WebKitGTK PrintOperation on Linux). The page's `@media print` styles control
//! what is rendered, so the PDF matches Print… without adding a second layout engine.

use std::path::Path;
use std::sync::mpsc;

#[cfg(windows)]
#[path = "pdf_windows.rs"]
mod pdf_windows;

#[derive(Debug, Clone, Copy, PartialEq)]
struct PaperSpec {
    width_pt: f64,
    height_pt: f64,
    width_in: f64,
    height_in: f64,
    gtk_name: &'static str,
}

fn paper_spec(paper: &str) -> Result<PaperSpec, String> {
    match paper {
        "a4" => Ok(PaperSpec {
            width_pt: 595.28,
            height_pt: 841.89,
            width_in: 8.27,
            height_in: 11.69,
            gtk_name: "iso_a4",
        }),
        "letter" => Ok(PaperSpec {
            width_pt: 612.0,
            height_pt: 792.0,
            width_in: 8.5,
            height_in: 11.0,
            gtk_name: "na_letter",
        }),
        other => Err(format!("Unsupported paper size: {other}")),
    }
}

/// Percent-encodes an absolute filesystem path into a `file://` URI for GTK's `output-uri`.
#[cfg_attr(not(any(target_os = "linux", target_os = "dragonfly", target_os = "freebsd", target_os = "openbsd", target_os = "netbsd", test)), allow(dead_code))]
fn file_uri(path: &str) -> String {
    let mut out = String::from("file://");
    for byte in path.as_bytes() {
        let b = *byte;
        if b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            use std::fmt::Write;
            let _ = write!(&mut out, "%{b:02X}");
        }
    }
    out
}

#[tauri::command]
pub async fn save_window_pdf(window: tauri::WebviewWindow, path: String, paper: String) -> Result<(), String> {
    let spec = paper_spec(&paper)?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("No destination path was provided.".into());
    }
    let out_path = Path::new(trimmed);
    if let Some(parent) = out_path.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err(format!("Destination folder does not exist: {}", parent.display()));
        }
    }
    let path_owned = trimmed.to_string();
    let (tx, rx) = mpsc::channel::<Result<(), String>>();

    dispatch_pdf(window, path_owned, spec, tx)?;

    tauri::async_runtime::spawn_blocking(move || {
        rx.recv().unwrap_or_else(|_| Err("PDF export did not complete.".into()))
    })
    .await
    .map_err(|e| format!("PDF export task failed: {e}"))?
}

#[cfg(target_os = "macos")]
fn dispatch_pdf(
    window: tauri::WebviewWindow,
    path: String,
    spec: PaperSpec,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use objc2::runtime::AnyObject;
    use objc2::sel;
    use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode};
    use objc2_foundation::{NSObjectProtocol, NSSize, NSString, NSURL};
    use objc2_web_kit::WKWebView;

    window
        .with_webview(move |wv| {
            let result = unsafe {
                let webview = &*(wv.inner() as *const WKWebView);
                if !webview.respondsToSelector(sel!(printOperationWithPrintInfo:)) {
                    Err("Direct PDF export requires macOS 11 or later.".into())
                } else {
                    // Use a fresh NSPrintInfo so we never alter the app's shared print settings.
                    let print_info = NSPrintInfo::new();
                    print_info.setPaperSize(NSSize::new(spec.width_pt, spec.height_pt));
                    // 9.5 mm margins (~27 pt) matching the bench sheet's print margins.
                    let margin_pt = 27.0;
                    print_info.setTopMargin(margin_pt);
                    print_info.setBottomMargin(margin_pt);
                    print_info.setLeftMargin(margin_pt);
                    print_info.setRightMargin(margin_pt);
                    print_info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
                    print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
                    print_info.setJobDisposition(NSPrintSaveJob);

                    let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
                    let dict = print_info.dictionary();
                    let url_obj: &AnyObject = url.as_ref();
                    let _: () = objc2::msg_send![&*dict, setObject: url_obj, forKey: NSPrintJobSavingURL];

                    let op = webview.printOperationWithPrintInfo(&print_info);
                    op.setShowsPrintPanel(false);
                    op.setShowsProgressPanel(false);
                    if op.runOperation() {
                        Ok(())
                    } else {
                        Err("macOS could not write the PDF file.".into())
                    }
                }
            };
            let _ = tx.send(result);
        })
        .map_err(|e| format!("Could not access the webview for PDF export: {e}"))
}

#[cfg(windows)]
fn dispatch_pdf(
    window: tauri::WebviewWindow,
    path: String,
    spec: PaperSpec,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    window
        .with_webview(move |wv| {
            // The completion handler gets one sender; an error before the job starts uses the other.
            if let Err(e) = pdf_windows::start(&wv.controller(), &wv.environment(), &path, spec.width_in, spec.height_in, tx.clone()) {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| format!("Could not access the webview for PDF export: {e}"))
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd"
))]
fn dispatch_pdf(
    window: tauri::WebviewWindow,
    path: String,
    spec: PaperSpec,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    use std::cell::RefCell;
    use std::rc::Rc;
    use webkit2gtk::PrintOperationExt;

    window
        .with_webview(move |wv| {
            let webview = wv.inner();
            let op = webkit2gtk::PrintOperation::new(&webview);
            let settings = gtk::PrintSettings::new();
            settings.set_printer("Print to File");
            settings.set("output-file-format", Some("pdf"));
            settings.set("output-uri", Some(&file_uri(&path)));

            let setup = gtk::PageSetup::new();
            let paper_size = gtk::PaperSize::new(Some(spec.gtk_name));
            setup.set_paper_size(&paper_size);
            setup.set_top_margin(0.0, gtk::Unit::Mm);
            setup.set_bottom_margin(0.0, gtk::Unit::Mm);
            setup.set_left_margin(0.0, gtk::Unit::Mm);
            setup.set_right_margin(0.0, gtk::Unit::Mm);

            op.set_print_settings(&settings);
            op.set_page_setup(&setup);

            let tx_done = Rc::new(RefCell::new(Some(tx)));
            let tx_fail = Rc::clone(&tx_done);
            op.connect_finished(move |_| {
                if let Some(sender) = tx_done.borrow_mut().take() {
                    let _ = sender.send(Ok(()));
                }
            });
            op.connect_failed(move |_, err| {
                if let Some(sender) = tx_fail.borrow_mut().take() {
                    let _ = sender.send(Err(format!("WebKitGTK could not save the PDF: {err}")));
                }
            });
            op.print();
        })
        .map_err(|e| format!("Could not access the webview for PDF export: {e}"))
}

#[cfg(not(any(
    target_os = "macos",
    windows,
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "openbsd",
    target_os = "netbsd"
)))]
fn dispatch_pdf(
    _window: tauri::WebviewWindow,
    _path: String,
    _spec: PaperSpec,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    let _ = tx.send(Err("Direct PDF export is not supported on this platform.".into()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_specs_cover_a4_and_letter_and_reject_unknown() {
        let a4 = paper_spec("a4").unwrap();
        assert_eq!(a4.gtk_name, "iso_a4");
        assert!((a4.width_in - 8.27).abs() < 0.01);
        let letter = paper_spec("letter").unwrap();
        assert_eq!(letter.gtk_name, "na_letter");
        assert_eq!(letter.width_in, 8.5);
        assert_eq!(letter.height_in, 11.0);
        assert!(paper_spec("tabloid").is_err());
    }

    #[test]
    fn file_uri_encodes_spaces_and_special_characters() {
        assert_eq!(
            file_uri("/tmp/pUC19 PCR (F & R) #1.pdf"),
            "file:///tmp/pUC19%20PCR%20%28F%20%26%20R%29%20%231.pdf"
        );
    }
}

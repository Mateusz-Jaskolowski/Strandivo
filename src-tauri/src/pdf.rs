// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Saves the current window's print layout directly to a PDF file using each platform's
//! native webview printing engine (an NSPrintOperation from WKWebView on macOS, in
//! `pdf_macos.rs`; WebView2's PrintToPdf on Windows, in `pdf_windows.rs`; WebKitGTK's
//! PrintOperation on Linux). The page's `@media print` styles control what is rendered, so
//! no second layout engine is added.
//!
//! The engine writes beside the destination, as `write_atomically` in `lib.rs` does, and the
//! file is moved into place only once it holds something, so a failed export never leaves a
//! half-written PDF or removes an older file of the same name.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

#[cfg(target_os = "macos")]
#[path = "pdf_macos.rs"]
mod pdf_macos;
#[cfg(windows)]
#[path = "pdf_windows.rs"]
mod pdf_windows;

/// How long to wait for the engine to say it has finished. Stopping the wait doesn't stop
/// the operating system's job, so the message says the file may still appear.
const FINISH_WITHIN: Duration = Duration::from_secs(120);
const TIMED_OUT: &str = "No answer from the system after 2 minutes, so Strandivo stopped waiting. The file may still appear.";

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
        other => Err(format!("Unsupported paper size: {other}.")),
    }
}

/// The path as given (spaces at either end are part of a file's name), if it names a file
/// in a folder that exists.
fn destination(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() {
        return Err("No destination path was provided.".into());
    }
    let target = PathBuf::from(path);
    if !target.is_absolute() {
        return Err(format!("The destination isn't a full path: {path}"));
    }
    if target.file_name().is_none() {
        return Err(format!("The destination doesn't name a file: {path}"));
    }
    match target.parent() {
        Some(parent) if parent.is_dir() => Ok(target),
        Some(parent) => Err(format!("The folder doesn't exist: {}", parent.display())),
        None => Err(format!("The destination doesn't name a file: {path}")),
    }
}

/// Where the engine writes before the file is moved into place: beside it, hidden, like
/// `write_atomically`'s temporary file.
fn staging_path(target: &Path) -> PathBuf {
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "plan.pdf".into());
    target.with_file_name(format!(".{name}.saving"))
}

/// What the engine said, or that it said nothing in time.
#[derive(Debug)]
enum Outcome {
    Done,
    Failed(String),
    TimedOut,
}

/// Moves a finished PDF into place, or clears what a failed one left. After a timeout the
/// engine may still be writing, so its file is left alone.
fn finish(outcome: Outcome, staging: &Path, target: &Path) -> Result<(), String> {
    match outcome {
        Outcome::Done => {}
        Outcome::Failed(e) => {
            let _ = std::fs::remove_file(staging);
            return Err(e);
        }
        Outcome::TimedOut => return Err(TIMED_OUT.into()),
    }
    let written = std::fs::metadata(staging).map(|m| m.is_file() && m.len() > 0).unwrap_or(false);
    if !written {
        let _ = std::fs::remove_file(staging);
        return Err("The system finished without writing the file.".into());
    }
    std::fs::rename(staging, target).map_err(|e| {
        let _ = std::fs::remove_file(staging);
        format!("Could not save {}: {e}", target.display())
    })
}

#[tauri::command]
pub async fn save_window_pdf(window: tauri::WebviewWindow, path: String, paper: String) -> Result<(), String> {
    let spec = paper_spec(&paper)?;
    let target = destination(&path)?;
    let staging = staging_path(&target);
    // A leftover from an export that timed out would otherwise pass for this one's output.
    let _ = std::fs::remove_file(&staging);
    let staging_text = staging.to_str().ok_or("The destination path isn't valid text.")?.to_string();
    let (tx, rx) = mpsc::channel::<Result<(), String>>();

    dispatch_pdf(window, staging_text, spec, tx)?;

    let outcome = tauri::async_runtime::spawn_blocking(move || match rx.recv_timeout(FINISH_WITHIN) {
        Ok(Ok(())) => Outcome::Done,
        Ok(Err(e)) => Outcome::Failed(e),
        Err(mpsc::RecvTimeoutError::Timeout) => Outcome::TimedOut,
        Err(mpsc::RecvTimeoutError::Disconnected) => Outcome::Failed("The export stopped without finishing.".into()),
    })
    .await
    .map_err(|e| format!("The export stopped: {e}"))?;
    finish(outcome, &staging, &target)
}

#[cfg(target_os = "macos")]
fn dispatch_pdf(
    window: tauri::WebviewWindow,
    path: String,
    spec: PaperSpec,
    tx: mpsc::Sender<Result<(), String>>,
) -> Result<(), String> {
    window
        .with_webview(move |wv| {
            // SAFETY: Tauri hands over its WKWebView, alive for this call, on the main thread.
            let webview = unsafe { &*(wv.inner() as *const objc2_web_kit::WKWebView) };
            // The delegate gets one sender; an error before the operation starts uses the other.
            if let Err(e) = pdf_macos::start(webview, &path, spec.width_pt, spec.height_pt, tx.clone()) {
                let _ = tx.send(Err(e));
            }
        })
        .map_err(|e| format!("Couldn't reach the window: {e}"))
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
        .map_err(|e| format!("Couldn't reach the window: {e}"))
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
            // WebKitGTK finds the printer by its name, which GTK's file backend gives in the
            // desktop's language: look it up in GTK's own translations rather than assume English.
            let file_printer = gtk::glib::dgettext(Some("gtk30"), "Print to File");
            settings.set_printer(&file_printer);
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

            // "failed" comes before "finished", so whichever is first answers.
            let tx_done = Rc::new(RefCell::new(Some(tx)));
            let tx_fail = Rc::clone(&tx_done);
            op.connect_finished(move |_| {
                if let Some(sender) = tx_done.borrow_mut().take() {
                    let _ = sender.send(Ok(()));
                }
            });
            op.connect_failed(move |_, err| {
                if let Some(sender) = tx_fail.borrow_mut().take() {
                    let _ = sender.send(Err(format!("WebKitGTK couldn't write the file: {err}")));
                }
            });
            op.print();
        })
        .map_err(|e| format!("Couldn't reach the window: {e}"))
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
    let _ = tx.send(Err("Saving a PDF directly isn't available on this system.".into()));
    Ok(())
}

/// Percent-encodes an absolute filesystem path into a `file://` URI for GTK's `output-uri`.
#[cfg_attr(
    not(any(target_os = "linux", target_os = "dragonfly", target_os = "freebsd", target_os = "openbsd", target_os = "netbsd", test)),
    allow(dead_code)
)]
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

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("strandivo-pdf-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

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
        assert_eq!(file_uri("/tmp/é.pdf"), "file:///tmp/%C3%A9.pdf");
    }

    #[test]
    fn destination_keeps_spaces_and_needs_a_full_path_in_a_folder_that_exists() {
        let dir = scratch("dest");
        let spaced = dir.join(" plan .pdf");
        let given = spaced.to_str().unwrap();
        assert_eq!(destination(given).unwrap(), spaced, "spaces at the ends are part of the name");
        assert!(destination("").is_err());
        assert!(destination("plan.pdf").unwrap_err().contains("full path"));
        assert!(destination(dir.join("missing").join("plan.pdf").to_str().unwrap()).unwrap_err().contains("doesn't exist"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn staging_file_sits_beside_the_destination() {
        let target = Path::new("/plans/PCR plan.pdf");
        assert_eq!(staging_path(target), Path::new("/plans/.PCR plan.pdf.saving"));
    }

    #[test]
    fn a_finished_pdf_replaces_the_destination() {
        let dir = scratch("done");
        let target = dir.join("plan.pdf");
        std::fs::write(&target, b"older").unwrap();
        let staging = staging_path(&target);
        std::fs::write(&staging, b"%PDF-1.7").unwrap();
        finish(Outcome::Done, &staging, &target).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"%PDF-1.7");
        assert!(!staging.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_failed_or_empty_export_keeps_the_older_file() {
        let dir = scratch("fail");
        let target = dir.join("plan.pdf");
        std::fs::write(&target, b"older").unwrap();
        let staging = staging_path(&target);

        std::fs::write(&staging, b"half").unwrap();
        assert_eq!(finish(Outcome::Failed("engine said no".into()), &staging, &target).unwrap_err(), "engine said no");
        assert!(!staging.exists(), "a failed export's partial file is removed");

        std::fs::write(&staging, b"").unwrap();
        assert!(finish(Outcome::Done, &staging, &target).unwrap_err().contains("without writing"));
        assert!(!staging.exists());

        assert!(finish(Outcome::Done, &staging, &target).unwrap_err().contains("without writing"), "no file at all");
        assert_eq!(std::fs::read(&target).unwrap(), b"older");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_timeout_leaves_the_engines_file_alone() {
        let dir = scratch("timeout");
        let target = dir.join("plan.pdf");
        let staging = staging_path(&target);
        std::fs::write(&staging, b"still writing").unwrap();
        assert_eq!(finish(Outcome::TimedOut, &staging, &target).unwrap_err(), TIMED_OUT);
        assert!(staging.exists());
        assert!(!target.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! WebView2's PrintToPdf for `pdf.rs`. It is a file of its own, taking the controller and
//! environment rather than Tauri's webview, so the same code can be type-checked against
//! the locked webview2-com and windows-core on a computer that can't build the whole app.

use std::sync::mpsc::Sender;

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2Environment, ICoreWebView2Environment6, ICoreWebView2_7,
};
use webview2_com::PrintToPdfCompletedHandler;
use windows_core::{Interface, HSTRING};

/// Starts writing the page's print layout to `path`. WebView2's completion handler sends the
/// outcome on `done`; an error before the job starts is returned instead, and `done` is then
/// dropped unused.
pub fn start(
    controller: &ICoreWebView2Controller,
    environment: &ICoreWebView2Environment,
    path: &str,
    width_in: f64,
    height_in: f64,
    done: Sender<Result<(), String>>,
) -> Result<(), String> {
    let text = |e: windows_core::Error| e.to_string();
    // SAFETY: COM calls on interfaces WebView2 handed out, made on the thread that owns them
    // (`with_webview` runs on the main thread).
    unsafe {
        let core = controller.CoreWebView2().map_err(text)?;
        let core7: ICoreWebView2_7 = core
            .cast()
            .map_err(|_| "This version of WebView2 can't save PDFs. Updating Windows updates it.".to_string())?;
        let env6: ICoreWebView2Environment6 = environment
            .cast()
            .map_err(|_| "This version of WebView2 can't set a PDF's paper size. Updating Windows updates it.".to_string())?;
        let settings = env6.CreatePrintSettings().map_err(text)?;
        settings.SetPageWidth(width_in).map_err(text)?;
        settings.SetPageHeight(height_in).map_err(text)?;
        // The sheet's `@page { margin: 9.5mm }` sets the margins.
        settings.SetMarginTop(0.0).map_err(text)?;
        settings.SetMarginBottom(0.0).map_err(text)?;
        settings.SetMarginLeft(0.0).map_err(text)?;
        settings.SetMarginRight(0.0).map_err(text)?;
        settings.SetShouldPrintBackgrounds(true).map_err(text)?;
        settings.SetShouldPrintHeaderAndFooter(false).map_err(text)?;

        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, ok| {
            let _ = done.send(match result {
                Ok(()) if ok => Ok(()),
                Ok(()) => Err("WebView2 couldn't write the file.".into()),
                Err(e) => Err(format!("WebView2 couldn't write the file: {e}")),
            });
            Ok(())
        }));
        core7.PrintToPdf(&HSTRING::from(path), &settings, &handler).map_err(text)
    }
}

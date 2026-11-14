// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! How the windows look outside their page: the title bar, and on Windows the menu bar,
//! light or dark as the page's theme is, or following the system's mode; and the
//! background shown before the page has drawn. The page says which (`set_window_look`,
//! from `src/theme.ts`), and the shell keeps it in app data, so the next launch opens its
//! windows with it, before any page could say.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::window::Color;
use tauri::{AppHandle, Manager, Runtime, Theme, WebviewWindowBuilder};

const FILE: &str = "window-look.json";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowLook {
    /// "light" or "dark"; none follows the system's mode.
    pub theme: Option<String>,
    /// The page's background, as `#rrggbb`, if it could tell.
    pub background: Option<String>,
}

/// What the windows have now, kept to style each new one.
static CURRENT: Mutex<Option<WindowLook>> = Mutex::new(None);

fn theme_of(name: Option<&str>) -> Result<Option<Theme>, String> {
    match name {
        None => Ok(None),
        Some("light") => Ok(Some(Theme::Light)),
        Some("dark") => Ok(Some(Theme::Dark)),
        Some(other) => Err(format!("Unknown window theme: {other}")),
    }
}

fn color_of(hex: &str) -> Result<Color, String> {
    let digits = hex
        .strip_prefix('#')
        .filter(|d| d.len() == 6 && d.bytes().all(|b| b.is_ascii_hexdigit()))
        .ok_or_else(|| format!("Not a colour: {hex}"))?;
    let byte = |i: usize| u8::from_str_radix(&digits[i..i + 2], 16).unwrap_or(0);
    Ok(Color(byte(0), byte(2), byte(4), 255))
}

impl WindowLook {
    /// The window theme (none: the system's) and background, or why the page's look is wrong.
    fn parts(&self) -> Result<(Option<Theme>, Option<Color>), String> {
        Ok((theme_of(self.theme.as_deref())?, self.background.as_deref().map(color_of).transpose()?))
    }
}

fn path_of<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join(FILE))
}

fn read_at(path: &Path) -> Option<WindowLook> {
    let look: WindowLook = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    look.parts().ok()?;
    Some(look)
}

/// At start, before any window opens: the look the windows had when the app last ran.
pub fn restore<R: Runtime>(app: &AppHandle<R>) {
    let Some(look) = path_of(app).and_then(|p| read_at(&p)) else { return };
    if let Ok((theme, _)) = look.parts() {
        app.set_theme(theme);
    }
    *CURRENT.lock().unwrap() = Some(look);
}

/// A new window, in the look the others have: no flash of light before its page draws.
pub fn style<'a, R: Runtime>(builder: WebviewWindowBuilder<'a, R, AppHandle<R>>) -> WebviewWindowBuilder<'a, R, AppHandle<R>> {
    let Some(Ok((theme, background))) = CURRENT.lock().unwrap().as_ref().map(WindowLook::parts) else {
        return builder;
    };
    let builder = builder.theme(theme);
    match background {
        Some(color) => builder.background_color(color),
        None => builder,
    }
}

/// The page's theme changed, or a window started: every window takes the look, and the
/// next launch starts with it. Windows ask this as each starts, so an unchanged look does
/// nothing.
#[tauri::command]
pub fn set_window_look<R: Runtime>(app: AppHandle<R>, look: WindowLook) -> Result<(), String> {
    let (theme, background) = look.parts()?;
    {
        let mut current = CURRENT.lock().map_err(|e| e.to_string())?;
        if current.as_ref() == Some(&look) {
            return Ok(());
        }
        *current = Some(look.clone());
    }
    // The title bars, Windows' menu bars and the pages' `prefers-color-scheme`.
    app.set_theme(theme);
    if background.is_some() {
        for window in app.webview_windows().values() {
            let _ = window.set_background_color(background);
        }
    }
    let path = path_of(&app).ok_or("No app data folder")?;
    let contents = serde_json::to_string(&look).map_err(|e| e.to_string())?;
    crate::app_data::save_at(&path, &contents)
}

// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Updating from inside the app (part 2 of docs/updates-feedback-usage-plan.md).
//!
//! The page asks whether there is an update and has it downloaded, but never installs it:
//! `restart_to_update` only quits the way ⌘Q does, so the main window asks about unsaved
//! tabs first, and the update is installed once the last window has gone (`finish_quit`).
//! If the user cancels that quit, the download stays here for the next "Restart".
//! That is also why the updater plugin's own commands aren't in the capability: the page
//! has no way to install anything itself.

use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::utils::config::BundleType;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Update, UpdaterExt};

const RELEASES: &str = "https://github.com/Mateusz-Jaskolowski/Strandivo/releases";

#[derive(Default)]
pub struct UpdateState {
    /// The update the last check found, and its bytes once downloaded and verified.
    found: Option<(Update, Option<Vec<u8>>)>,
    /// The user chose Restart: install when the last window closes.
    install_on_quit: bool,
    /// Why the last install failed, for the main window to say when it opens again.
    failed: Option<String>,
}

pub type SharedUpdates = Mutex<UpdateState>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    version: String,
    current_version: String,
    /// The release's notes from latest.json (a link to the release page).
    notes: Option<String>,
    /// Whether it is already downloaded, so Restart needs no wait.
    ready: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    downloaded: u64,
    total: Option<u64>,
}

/// Why this copy can't update itself, if it can't. A development build isn't a bundle,
/// and a .deb or .rpm belongs to the system's package manager: latest.json's Linux file is
/// the AppImage, which the updater would otherwise try to install over the package.
fn unsupported() -> Option<&'static str> {
    if cfg!(debug_assertions) {
        return Some("Development builds don't update themselves.");
    }
    match tauri::utils::platform::bundle_type() {
        Some(BundleType::App | BundleType::Nsis | BundleType::AppImage) => None,
        Some(BundleType::Deb | BundleType::Rpm) => {
            Some("Strandivo was installed as a package, so it can't update itself. Download the new version from strandivo.com.")
        }
        _ => Some("This copy of Strandivo can't update itself. Download the new version from strandivo.com."),
    }
}

/// What went wrong, in words for the user: a network error says only that, as its own text
/// is a URL and a library's message.
fn failure(doing: &str, e: tauri_plugin_updater::Error) -> String {
    match e {
        tauri_plugin_updater::Error::Reqwest(_) | tauri_plugin_updater::Error::Network(_) => {
            format!("Couldn't {doing}: Strandivo couldn't reach the internet, or the server didn't answer.")
        }
        e => format!("Couldn't {doing}: {e}"),
    }
}

/// Asks updates.strandivo.com for a newer version. `None` when this is the latest.
#[tauri::command]
pub async fn check_update<R: Runtime>(app: AppHandle<R>) -> Result<Option<UpdateInfo>, String> {
    if let Some(why) = unsupported() {
        return Err(why.to_string());
    }
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| failure("check for updates", e))?;
    let state = app.state::<SharedUpdates>();
    let mut st = state.lock().unwrap();
    let Some(update) = update else {
        st.found = None;
        return Ok(None);
    };
    // Keep a download of the same version; a newer one replaces it.
    let ready = match &st.found {
        Some((old, Some(_))) if old.version == update.version => true,
        _ => {
            st.found = Some((update.clone(), None));
            false
        }
    };
    Ok(Some(UpdateInfo {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
        ready,
    }))
}

/// Downloads the update the last check found, telling the page how far it has got. The
/// plugin checks the signature against the public key in tauri.conf.json before keeping it.
#[tauri::command]
pub async fn download_update<R: Runtime>(app: AppHandle<R>, on_progress: Channel<Progress>) -> Result<(), String> {
    let update = {
        let state = app.state::<SharedUpdates>();
        let st = state.lock().unwrap();
        match &st.found {
            Some((_, Some(_))) => return Ok(()),
            Some((u, None)) => u.clone(),
            None => return Err("There is no update to download.".into()),
        }
    };
    let mut downloaded: u64 = 0;
    let bytes = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = on_progress.send(Progress { downloaded, total });
            },
            || {},
        )
        .await
        .map_err(|e| failure("download the update", e))?;
    let state = app.state::<SharedUpdates>();
    let mut st = state.lock().unwrap();
    if let Some((u, slot)) = st.found.as_mut() {
        if u.version == update.version {
            *slot = Some(bytes);
        }
    }
    Ok(())
}

/// Quits to install the downloaded update, asking about unsaved tabs first.
#[tauri::command]
pub fn restart_to_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    {
        let state = app.state::<SharedUpdates>();
        let mut st = state.lock().unwrap();
        if !matches!(st.found, Some((_, Some(_)))) {
            return Err("The update hasn't been downloaded yet.".into());
        }
        st.install_on_quit = true;
    }
    super::request_quit(&app);
    Ok(())
}

/// Opens the found update's release page in the browser. The page names no address, so
/// this can't be used to open anything else.
#[tauri::command]
pub fn open_release_notes<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let version = {
        let state = app.state::<SharedUpdates>();
        let st = state.lock().unwrap();
        st.found.as_ref().map(|(u, _)| u.version.clone()).ok_or("There is no update to show.")?
    };
    let url = format!("{RELEASES}/tag/v{version}");
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Why the last install failed, once.
#[tauri::command]
pub fn take_update_failure<R: Runtime>(app: AppHandle<R>) -> Option<String> {
    app.state::<SharedUpdates>().lock().unwrap().failed.take()
}

/// A quit was cancelled (an unsaved tab): keep the download, but don't install on the
/// next ordinary quit, which the user didn't ask to restart.
pub fn quit_cancelled<R: Runtime>(app: &AppHandle<R>) {
    app.state::<SharedUpdates>().lock().unwrap().install_on_quit = false;
}

/// The last window has closed on the way out. Installs the update if the user chose
/// Restart and starts the new version; returns false if it couldn't, so the app stays
/// open and says why.
pub fn finish_quit<R: Runtime>(app: &AppHandle<R>) -> bool {
    let pending = {
        let state = app.state::<SharedUpdates>();
        let mut st = state.lock().unwrap();
        if !std::mem::take(&mut st.install_on_quit) {
            return true;
        }
        match st.found.take() {
            Some((u, Some(bytes))) => (u, bytes),
            other => {
                st.found = other;
                return true;
            }
        }
    };
    let (update, bytes) = pending;
    // On Windows this starts the installer, which opens the new version, and exits.
    match update.install(&bytes) {
        Ok(()) => app.restart(),
        Err(e) => {
            let state = app.state::<SharedUpdates>();
            let mut st = state.lock().unwrap();
            st.failed = Some(format!("Couldn't install Strandivo {}: {e}", update.version));
            false
        }
    }
}

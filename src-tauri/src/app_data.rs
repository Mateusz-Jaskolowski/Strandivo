// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Lists the app keeps for the user (the lab's enzyme stock), as JSON files in app data,
//! outside the web view's storage, which a reinstall or a cleared cache can lose. Only the
//! names in `NAMES` can be read or written, so the page can't reach any other file. A file
//! is replaced only after the new contents have been written, so an interrupted save keeps
//! the old one.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// What the page may keep. The primer library can move here from local storage later.
const NAMES: &[&str] = &["enzyme-library"];
const CHANGED_EVENT: &str = "app-data-changed";

static WRITE_LOCK: Mutex<()> = Mutex::new(());

fn path_of(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    if !NAMES.contains(&name) {
        return Err(format!("Unknown app data: {name}"));
    }
    let folder = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(folder.join(format!("{name}.json")))
}

fn load_at(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

fn save_at(path: &Path, contents: &str) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    serde_json::from_str::<serde_json::Value>(contents).map_err(|e| format!("Invalid JSON: {e}"))?;
    let parent = path.parent().ok_or("No folder for the file")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    let temporary = path.with_extension("json.tmp");
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temporary)?;
        file.write_all(contents.as_bytes())?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, path)
    })();
    if let Err(e) = result {
        let _ = std::fs::remove_file(&temporary);
        return Err(format!("Could not save {}: {e}", path.display()));
    }
    Ok(())
}

/// Moves a file the page can't read out of the way, beside it with the time in its name,
/// so a fresh list can start without losing it. Returns where it went.
fn set_aside_at(path: &Path) -> Result<Option<String>, String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    if !path.exists() {
        return Ok(None);
    }
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("data");
    let aside = path.with_file_name(format!("{stem}-unreadable-{secs}.json"));
    std::fs::rename(path, &aside).map_err(|e| format!("Could not move {}: {e}", path.display()))?;
    Ok(Some(aside.display().to_string()))
}

#[tauri::command]
pub fn load_app_data(app: AppHandle, name: String) -> Result<Option<String>, String> {
    load_at(&path_of(&app, &name)?)
}

#[tauri::command]
pub fn save_app_data(app: AppHandle, name: String, contents: String) -> Result<(), String> {
    save_at(&path_of(&app, &name)?, &contents)?;
    let _ = app.emit(CHANGED_EVENT, name);
    Ok(())
}

#[tauri::command]
pub fn set_aside_app_data(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let aside = set_aside_at(&path_of(&app, &name)?)?;
    let _ = app.emit(CHANGED_EVENT, name);
    Ok(aside)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A new folder for each call. The clock alone is not enough: macOS gives only
    /// microseconds, so tests running in parallel could get the same folder.
    fn folder() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static CALLS: AtomicU64 = AtomicU64::new(0);
        let call = CALLS.fetch_add(1, Ordering::Relaxed);
        let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("strandivo-app-data-{}-{time}-{call}", std::process::id()))
    }

    #[test]
    fn saves_replace_the_file_and_invalid_json_keeps_the_previous_copy() {
        let folder = folder();
        let path = folder.join("enzyme-library.json");
        assert_eq!(load_at(&path).unwrap(), None);
        let first = r#"{"version":1,"entries":[]}"#;
        save_at(&path, first).unwrap();
        assert_eq!(load_at(&path).unwrap().as_deref(), Some(first));
        assert!(save_at(&path, "{broken").is_err());
        assert_eq!(load_at(&path).unwrap().as_deref(), Some(first));
        let next = r#"{"version":1,"entries":[{"enzyme":"EcoRI","notes":"−20 °C"}]}"#;
        save_at(&path, next).unwrap();
        assert_eq!(load_at(&path).unwrap().as_deref(), Some(next));
        assert!(!path.with_extension("json.tmp").exists());
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn an_unreadable_file_is_set_aside_not_deleted() {
        let folder = folder();
        let path = folder.join("enzyme-library.json");
        assert_eq!(set_aside_at(&path).unwrap(), None);
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(&path, "damaged").unwrap();
        let aside = set_aside_at(&path).unwrap().expect("moved");
        assert!(!path.exists());
        assert!(aside.contains("enzyme-library-unreadable-"));
        assert_eq!(std::fs::read_to_string(&aside).unwrap(), "damaged");
        std::fs::remove_dir_all(folder).unwrap();
    }
}

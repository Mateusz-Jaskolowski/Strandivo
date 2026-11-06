// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! The lab's stock is user data, kept outside the app bundle. Replace the JSON file
//! only after the new contents have been written, so an interrupted save keeps the old list.

use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

static WRITE_LOCK: Mutex<()> = Mutex::new(());
const FILE_NAME: &str = "enzyme-library.json";

fn load_at(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(path) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read the enzyme library: {e}")),
    }
}

fn save_at(path: &Path, contents: &str) -> Result<(), String> {
    let _guard = WRITE_LOCK.lock().map_err(|e| e.to_string())?;
    serde_json::from_str::<serde_json::Value>(contents).map_err(|e| format!("Invalid enzyme library JSON: {e}"))?;
    let parent = path.parent().ok_or("No enzyme library folder")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("Could not create the enzyme library folder: {e}"))?;
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
        return Err(format!("Could not save the enzyme library: {e}"));
    }
    Ok(())
}

#[tauri::command]
pub fn load_enzyme_library(app: AppHandle) -> Result<Option<String>, String> {
    let folder = app.path().app_data_dir().map_err(|e| e.to_string())?;
    load_at(&folder.join(FILE_NAME))
}

#[tauri::command]
pub fn save_enzyme_library(app: AppHandle, contents: String) -> Result<(), String> {
    let folder = app.path().app_data_dir().map_err(|e| e.to_string())?;
    save_at(&folder.join(FILE_NAME), &contents)?;
    let _ = app.emit("enzyme-library-changed", ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_replace_the_file_and_invalid_json_keeps_the_previous_copy() {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let folder = std::env::temp_dir().join(format!("strandivo-enzymes-{}-{unique}", std::process::id()));
        let path = folder.join(FILE_NAME);
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
}

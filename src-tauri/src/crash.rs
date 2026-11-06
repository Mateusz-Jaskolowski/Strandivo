// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! What a crash leaves behind. Release builds abort on a panic and carry no symbols, so
//! without this a crash leaves only the system's unreadable report. A panic hook writes
//! what the panic says, where, in which thread, this copy's version, system and the time
//! to `crash.json` in the app's data folder, and lets the abort happen. On the next launch
//! the main window takes the file (`take_crash_report`, once) and offers to report it;
//! nothing is sent unless the user opens the report and clicks Send, which shows it first.
//! The page removes file paths from the message (`scrubPaths` in src/lib/feedback.ts);
//! here only the source location is shortened, as it names the build machine's folders.
//!
//! The hook runs while panicking, so it does as little as it can: no allocation of its
//! own, one buffer on the stack written to the file at once, and only the first panic.

use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager, Runtime};

const FILE_NAME: &str = "crash.json";
/// The file's layout, for the page (`parseCrash` in src/lib/crash.ts).
const FORMAT: u32 = 1;
/// A panic's message is cut to this many bytes, and the location and thread to less, so
/// the file always fits the buffer, even if every byte had to be escaped.
const MAX_MESSAGE: usize = 2000;
const MAX_LOCATION: usize = 300;
const MAX_THREAD: usize = 64;
const BUFFER: usize = 6 * (MAX_MESSAGE + MAX_LOCATION + MAX_THREAD) + 512;

/// Where the hook writes; set once the app knows its data folder.
static FILE: OnceLock<PathBuf> = OnceLock::new();
static WRITTEN: AtomicBool = AtomicBool::new(false);

/// Sets the hook: called first thing in `run()`. Panics before `set_folder` aren't kept.
pub fn install() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(path) = FILE.get() {
            if !WRITTEN.swap(true, Ordering::SeqCst) {
                let message = info.payload().downcast_ref::<&str>().copied().or_else(|| info.payload().downcast_ref::<String>().map(|s| s.as_str())).unwrap_or("(no message)");
                let thread = std::thread::current();
                let location = info.location().map(|l| (l.file(), l.line(), l.column()));
                let time = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
                let _ = write_crash(path, message, location, thread.name().unwrap_or("unnamed"), time);
            }
        }
        // The standard message on stderr, as before.
        previous(info);
    }));
}

/// The app's data folder, made if need be, so the hook needn't make it while panicking.
pub fn set_folder<R: Runtime>(app: &AppHandle<R>) {
    if let Ok(folder) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&folder);
        let _ = FILE.set(folder.join(FILE_NAME));
    }
}

/// The longest prefix of `s` within `max` bytes that ends on a character's edge.
fn cut(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Where in the source it panicked, without the build machine's folders: a dependency
/// from its crate's folder (reqwest-0.13.0/src/…), the standard library from `library/`,
/// one of ours from `crates/` or as it is, and anything else by its last three parts.
fn short_location(file: &str) -> &str {
    let after_part = |s: &'_ str| -> usize { s.find(['/', '\\']).map_or(0, |i| i + 1) };
    for marker in ["/registry/src/", "\\registry\\src\\", "/git/checkouts/", "\\git\\checkouts\\", "/rustc/", "\\rustc\\"] {
        if let Some(i) = file.rfind(marker) {
            let rest = &file[i + marker.len()..];
            return &rest[after_part(rest)..];
        }
    }
    for marker in ["/crates/", "\\crates\\", "/src-tauri/", "\\src-tauri\\"] {
        if let Some(i) = file.rfind(marker) {
            return &file[i + 1..];
        }
    }
    let absolute = file.starts_with(['/', '\\']) || file.get(1..2) == Some(":");
    if !absolute {
        return file;
    }
    let mut end = file.len();
    for _ in 0..3 {
        match file[..end].rfind(['/', '\\']) {
            Some(i) => end = i,
            None => return file,
        }
    }
    &file[end + 1..]
}

/// Writes `s` as a JSON string.
fn json_string(out: &mut impl Write, s: &str) -> std::io::Result<()> {
    out.write_all(b"\"")?;
    json_escaped(out, s)?;
    out.write_all(b"\"")
}

/// Writes `s` escaped as JSON wants it inside quotes.
fn json_escaped(out: &mut impl Write, s: &str) -> std::io::Result<()> {
    let mut start = 0;
    for (i, c) in s.char_indices() {
        let escaped: Option<&[u8]> = match c {
            '"' => Some(b"\\\""),
            '\\' => Some(b"\\\\"),
            '\n' => Some(b"\\n"),
            '\r' => Some(b"\\r"),
            '\t' => Some(b"\\t"),
            c if (c as u32) < 0x20 || c == '\u{7f}' => None,
            _ => continue,
        };
        out.write_all(&s.as_bytes()[start..i])?;
        match escaped {
            Some(e) => out.write_all(e)?,
            None => write!(out, "\\u{:04x}", c as u32)?,
        }
        start = i + c.len_utf8();
    }
    out.write_all(&s.as_bytes()[start..])
}

/// The file's contents, into `buf`; returns how many bytes it took.
fn crash_json(buf: &mut [u8], message: &str, location: Option<(&str, u32, u32)>, thread: &str, time: u64) -> std::io::Result<usize> {
    let mut out = std::io::Cursor::new(buf);
    write!(out, "{{\"format\":{FORMAT},\"version\":\"{}\",\"os\":\"{}\",\"arch\":\"{}\",\"time\":{time},\"thread\":", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH)?;
    json_string(&mut out, cut(thread, MAX_THREAD))?;
    out.write_all(b",\"location\":")?;
    match location {
        Some((file, line, column)) => {
            // file:line:column as one string; the line and column are digits alone.
            out.write_all(b"\"")?;
            json_escaped(&mut out, cut(short_location(file), MAX_LOCATION - 24))?;
            write!(out, ":{line}:{column}\"")?;
        }
        None => out.write_all(b"null")?,
    }
    out.write_all(b",\"message\":")?;
    json_string(&mut out, cut(message, MAX_MESSAGE))?;
    out.write_all(b"}\n")?;
    Ok(out.position() as usize)
}

fn write_crash(path: &std::path::Path, message: &str, location: Option<(&str, u32, u32)>, thread: &str, time: u64) -> std::io::Result<()> {
    let mut buf = [0u8; BUFFER];
    let n = crash_json(&mut buf, message, location, thread, time)?;
    let mut file = std::fs::File::create(path)?;
    file.write_all(&buf[..n])?;
    file.sync_all()
}

/// The last crash's file, if the app crashed since it was last asked; it is deleted as it
/// is read, so a crash is offered once, and counted once in usage statistics.
#[tauri::command]
pub fn take_crash_report() -> Option<String> {
    let path = FILE.get()?;
    let contents = std::fs::read_to_string(path).ok();
    let _ = std::fs::remove_file(path);
    contents.filter(|c| c.len() <= BUFFER)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locations_lose_the_build_machines_folders() {
        assert_eq!(short_location("src/usage.rs"), "src/usage.rs");
        assert_eq!(
            short_location("/home/runner/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/reqwest-0.13.0/src/async_impl/client.rs"),
            "reqwest-0.13.0/src/async_impl/client.rs"
        );
        assert_eq!(
            short_location("C:\\Users\\runneradmin\\.cargo\\registry\\src\\index.crates.io-1949cf8c6b5b557f\\tauri-2.9.0\\src\\app.rs"),
            "tauri-2.9.0\\src\\app.rs"
        );
        assert_eq!(short_location("/rustc/58cf8f9c3/library/core/src/option.rs"), "library/core/src/option.rs");
        assert_eq!(short_location("/Users/anna/Strandivo/crates/seqcore/src/sanger.rs"), "crates/seqcore/src/sanger.rs");
        assert_eq!(short_location("/Users/anna/somewhere/else/deep/file.rs"), "else/deep/file.rs");
        assert_eq!(short_location("/a.rs"), "/a.rs");
    }

    #[test]
    fn the_file_is_json_whatever_the_message() {
        let mut buf = [0u8; BUFFER];
        let message = "quote \" backslash \\ line\nbreak \u{1} tab\t é 🧬";
        let n = crash_json(&mut buf, message, Some(("src/lib.rs", 12, 5)), "main", 1_762_420_000).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf[..n]).unwrap();
        assert_eq!(v["format"], 1);
        assert_eq!(v["message"], message);
        assert_eq!(v["location"], "src/lib.rs:12:5");
        assert_eq!(v["thread"], "main");
        assert_eq!(v["time"], 1_762_420_000u64);
        assert_eq!(v["version"], env!("CARGO_PKG_VERSION"));
        // The worst message there is still fits, cut short on a character's edge.
        let worst = "\u{1}".repeat(10_000) + "é";
        let n = crash_json(&mut buf, &worst, Some((&"\u{2}".repeat(1000), 1, 1)), &"\u{3}".repeat(500), 0).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf[..n]).unwrap();
        assert_eq!(v["message"].as_str().unwrap().len(), MAX_MESSAGE);
        let n = crash_json(&mut buf, "x", None, "t", 0).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&buf[..n]).unwrap();
        assert!(v["location"].is_null());
        assert_eq!(cut("aé", 2), "a");
    }

    #[test]
    fn a_panic_leaves_the_file_and_it_is_taken_once() {
        let folder = std::env::temp_dir().join(format!("strandivo-crash-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        FILE.set(folder.join(FILE_NAME)).unwrap();
        install();
        let line = line!() + 3;
        let caught = std::thread::Builder::new()
            .name("worker".into())
            .spawn(|| panic!("Could not read {}", "/Users/anna/Lab plasmids/pSecret.gb"))
            .unwrap()
            .join();
        assert!(caught.is_err());
        // Back to the default hook, so a failing assertion below reads as usual.
        let _ = std::panic::take_hook();
        let text = take_crash_report().expect("the hook wrote the file");
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        // The message as the panic gave it: the page removes the path before showing it.
        assert_eq!(v["message"], "Could not read /Users/anna/Lab plasmids/pSecret.gb");
        assert_eq!(v["location"].as_str().unwrap().rsplit_once(':').unwrap().0, format!("src/crash.rs:{line}"));
        assert_eq!(v["thread"], "worker");
        assert_eq!(v["os"], std::env::consts::OS);
        assert!(v["time"].as_u64().unwrap() > 1_700_000_000);
        assert_eq!(take_crash_report(), None);
        std::fs::remove_dir_all(folder).unwrap();
    }
}

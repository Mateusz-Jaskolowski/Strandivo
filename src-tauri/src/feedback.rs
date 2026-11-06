// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! What Help → Send Feedback… needs from the shell (part 4 of
//! docs/updates-feedback-usage-plan.md): this copy's version and system, and opening an
//! issue, an email or one of the project's pages in the user's own apps. The page sends
//! the report itself (feedback.strandivo.com). Every address opened here is built from
//! fixed parts, never taken from the page: an issue from its number, an email to
//! feedback@strandivo.com with the page's text only as its subject and body.

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;

const REPO: &str = "https://github.com/Mateusz-Jaskolowski/Strandivo";
const WEBSITE: &str = "https://strandivo.com";
const FEEDBACK_EMAIL: &str = "feedback@strandivo.com";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    version: String,
    os: String,
    os_version: String,
    arch: String,
}

/// Letters, digits and a little punctuation, at most 40 of them: what a report may carry
/// (`reportProblem` in src/lib/feedback.ts checks the same).
fn short(s: &str) -> String {
    let kept: String = s.chars().filter(|c| c.is_ascii_alphanumeric() || " ._()+,-".contains(*c)).take(40).collect();
    if kept.trim().is_empty() { "unknown".to_string() } else { kept.trim().to_string() }
}

#[tauri::command]
pub fn system_info<R: Runtime>(app: AppHandle<R>) -> SystemInfo {
    SystemInfo {
        version: short(&app.package_info().version.to_string()),
        os: short(std::env::consts::OS),
        os_version: short(&os_info::get().version().to_string()),
        arch: short(std::env::consts::ARCH),
    }
}

/// The links in the Help menu.
pub fn open_page<R: Runtime>(app: &AppHandle<R>, which: &str) {
    let url = match which {
        "website" => WEBSITE.to_string(),
        "github" => REPO.to_string(),
        _ => return,
    };
    let _ = app.opener().open_url(url, None::<&str>);
}

/// A sent report's issue, from its number.
#[tauri::command]
pub fn open_issue<R: Runtime>(app: AppHandle<R>, number: u32) -> Result<(), String> {
    app.opener().open_url(format!("{REPO}/issues/{number}"), None::<&str>).map_err(|e| e.to_string())
}

/// Encodes all but the characters a URL keeps as they are.
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Mail apps cut long mailto links short, so the body is kept to what they all take.
const MAX_BODY: usize = 1800;

fn mailto(subject: &str, body: &str) -> String {
    let subject: String = subject.chars().filter(|c| !c.is_control()).take(150).collect();
    let cut = body.chars().count() > MAX_BODY;
    let mut body: String = body.chars().take(MAX_BODY).collect();
    if cut {
        body.push('…');
    }
    format!("mailto:{FEEDBACK_EMAIL}?subject={}&body={}", encode(&subject), encode(&body))
}

/// Email instead: a new message to feedback@strandivo.com in the user's mail app.
#[tauri::command]
pub fn email_feedback<R: Runtime>(app: AppHandle<R>, subject: String, body: String) -> Result<(), String> {
    app.opener().open_url(mailto(&subject, &body), None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_email_goes_only_to_the_feedback_address() {
        let link = mailto("Bug: a&b", "line 1\nline 2 ?to=x@evil.example");
        assert!(link.starts_with("mailto:feedback@strandivo.com?subject=Bug%3A%20a%26b&body="));
        // The page's text can't add a recipient or a header.
        assert!(!link[link.find('?').unwrap()..].contains('@'));
        assert!(link.contains("line%201%0Aline%202"));
        let long = mailto("x", &"a".repeat(5000));
        assert!(long.ends_with(&format!("body={}%E2%80%A6", "a".repeat(MAX_BODY))));
    }

    #[test]
    fn system_details_are_short_and_plain() {
        assert_eq!(short("15.1.0"), "15.1.0");
        assert_eq!(short("Rolling <b>Release</b>"), "Rolling bReleaseb");
        assert_eq!(short(""), "unknown");
        assert_eq!(short(&"9".repeat(100)).len(), 40);
    }
}

// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! What Help → Send Feedback… needs from the shell (part 4 of
//! docs/updates-feedback-usage-plan.md): this copy's version and system, and opening an
//! issue, an email or one of the project's pages in the user's own apps. The page sends
//! the report itself (feedback.strandivo.com). Every address opened here is built from
//! fixed parts, never taken from the page: an issue from its number, an email to
//! feedback@strandivo.com with the page's text only as its subject and body, and a new
//! issue from the report's kind with the page's text only as the values of its fields.

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

/// The links in the Help menu, and Settings' "What is sent" (the Privacy page's list of
/// usage statistics); the page names one of these, never an address.
pub fn open_page<R: Runtime>(app: &AppHandle<R>, which: &str) {
    let url = match which {
        "website" => WEBSITE.to_string(),
        "github" => REPO.to_string(),
        "privacy-usage" => format!("{WEBSITE}/privacy#usage-statistics"),
        _ => return,
    };
    let _ = app.opener().open_url(url, None::<&str>);
}

#[tauri::command]
pub fn open_project_page<R: Runtime>(app: AppHandle<R>, which: String) {
    open_page(&app, &which);
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

/// The repository's issue form for a kind of report, and the ids of the fields it fills.
/// A form's labels are added for anyone, whereas an address with `labels=` needs the right
/// to label issues. `ISSUE_FORMS` in src/lib/feedback.ts is the same table.
struct IssueForm {
    template: &'static str,
    text: &'static str,
    version: Option<&'static str>,
    more: Option<&'static str>,
}

fn issue_form(kind: &str) -> Option<IssueForm> {
    match kind {
        "bug" => Some(IssueForm { template: "bug_report.yml", text: "what", version: Some("version"), more: Some("more") }),
        "idea" => Some(IssueForm { template: "feature_request.yml", text: "task", version: None, more: None }),
        "question" => Some(IssueForm { template: "question.yml", text: "question", version: None, more: Some("more") }),
        _ => None,
    }
}

/// How much of each field the address holds, encoded: GitHub turns down an address of
/// about 8,000 characters (`ISSUE_URL_LIMITS` in src/lib/feedback.ts).
const MAX_TITLE: usize = 900;
const MAX_TEXT: usize = 3600;
const MAX_VERSION: usize = 120;
const MAX_MORE: usize = 2700;

fn encoded_len(c: char) -> usize {
    if c.is_ascii_alphanumeric() || "-._~".contains(c) { 1 } else { 3 * c.len_utf8() }
}

/// Text encoded for an address, cut short with "…" to fit `max` encoded characters.
fn encode_within(text: &str, max: usize) -> String {
    if text.chars().map(encoded_len).sum::<usize>() <= max {
        return encode(text);
    }
    let mut kept = String::new();
    let mut len = encoded_len('…');
    for c in text.chars() {
        if len + encoded_len(c) > max {
            break;
        }
        len += encoded_len(c);
        kept.push(c);
    }
    kept.push('…');
    encode(&kept)
}

/// A new issue filled in with the report, for the user to post from their own account.
fn new_issue_url(kind: &str, title: &str, text: &str, more: &str, version: &str) -> Option<String> {
    let form = issue_form(kind)?;
    let mut url = format!("{REPO}/issues/new?template={}", form.template);
    let mut add = |id: Option<&str>, value: &str, max: usize| {
        if let Some(id) = id {
            if !value.trim().is_empty() {
                url.push_str(&format!("&{id}={}", encode_within(value, max)));
            }
        }
    };
    let title: String = title.chars().filter(|c| !c.is_control()).collect();
    add(Some("title"), &title, MAX_TITLE);
    add(Some(form.text), text, MAX_TEXT);
    add(form.version, version, MAX_VERSION);
    add(form.more, more, MAX_MORE);
    Some(url)
}

/// Post on GitHub instead: the report as a new issue in the user's browser, this copy's
/// own version filled in.
#[tauri::command]
pub fn new_issue<R: Runtime>(app: AppHandle<R>, kind: String, title: String, text: String, more: String) -> Result<(), String> {
    let version = short(&app.package_info().version.to_string());
    let url = new_issue_url(&kind, &title, &text, &more, &version).ok_or_else(|| format!("No issue form for \"{}\".", short(&kind)))?;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
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
    fn a_new_issue_fills_in_the_kinds_form_and_nothing_else() {
        // The page builds the same address from the same text (src/lib/feedback.test.ts).
        assert_eq!(
            new_issue_url("bug", "Map is blank*", "Opened pUC19 & saw (nothing)!\nNext: ?", "Strandivo 0.4.1 · macOS 15.1 · Apple silicon\nOpen view: Map", "0.4.1").unwrap(),
            "https://github.com/Mateusz-Jaskolowski/Strandivo/issues/new?template=bug_report.yml&title=Map%20is%20blank%2A&what=Opened%20pUC19%20%26%20saw%20%28nothing%29%21%0ANext%3A%20%3F&version=0.4.1&more=Strandivo%200.4.1%20%C2%B7%20macOS%2015.1%20%C2%B7%20Apple%20silicon%0AOpen%20view%3A%20Map"
        );
        assert_eq!(
            new_issue_url("idea", "Dark mode", "", "Strandivo 0.4.1", "0.4.1").unwrap(),
            "https://github.com/Mateusz-Jaskolowski/Strandivo/issues/new?template=feature_request.yml&title=Dark%20mode"
        );
        // The page names a kind, never a template, a field or another address.
        assert!(new_issue_url("../../evil", "x", "y", "", "1").is_none());
        let link = new_issue_url("question", "a&labels=x\n", "b&template=c", "", "1").unwrap();
        assert!(link.ends_with("?template=question.yml&title=a%26labels%3Dx&question=b%26template%3Dc"));
        // Long text is cut by its encoded length, whole characters only.
        let long = new_issue_url("question", "x", &"猫".repeat(5000), &"a".repeat(9000), "1").unwrap();
        assert!(long.contains(&format!("&question={}%E2%80%A6&", "%E7%8C%AB".repeat((MAX_TEXT - 9) / 9))));
        assert!(long.ends_with(&format!("&more={}%E2%80%A6", "a".repeat(MAX_MORE - 9))));
        assert!(long.len() < 7500);
    }

    #[test]
    fn system_details_are_short_and_plain() {
        assert_eq!(short("15.1.0"), "15.1.0");
        assert_eq!(short("Rolling <b>Release</b>"), "Rolling bReleaseb");
        assert_eq!(short(""), "unknown");
        assert_eq!(short(&"9".repeat(100)).len(), 40);
    }
}

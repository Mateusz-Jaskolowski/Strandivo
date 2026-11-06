// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! Usage statistics (part 5 of docs/updates-feedback-usage-plan.md): sends the events the
//! page queued to Aptabase, in its EU region. The page decides whether to send at all (the
//! user's choice) and what (src/lib/usage.ts); this adds the app's version and system and
//! a session number, and posts them.
//!
//! The key is built in from `APTABASE_APP_KEY` when a release is built, and only then, so
//! CI and e2e builds have none and send nothing. A fork building from the source has none
//! either. Events are checked again here, so that whatever reaches the page can still send
//! nothing but listed words.
//!
//! Aptabase keeps Debug events apart from Release ones (its dashboard's bug and rocket
//! icons). A release candidate's are Debug, so trying one never mixes with what people do,
//! and so are a development build's, which sends only if its developer builds it with the
//! key (`APTABASE_APP_KEY=… npm run app:dev`), to try the whole path before a release:
//! 0.3.0's crash was in code only a build with the key reached.

use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Runtime, State};

const ENDPOINT: &str = "https://eu.aptabase.com/api/v0/events";
/// Aptabase takes at most 25 events in one request.
const MAX_EVENTS: usize = 25;
/// A new session after this long without events, as Aptabase's own SDKs do.
const SESSION_IDLE: Duration = Duration::from_secs(4 * 60 * 60);

/// The key, if this build was given one for the EU region.
fn app_key() -> Option<&'static str> {
    valid_key(option_env!("APTABASE_APP_KEY")?)
}

/// Whether events go to Aptabase's Debug mode: from a development build, or from a release
/// candidate (a version with a pre-release part, such as 0.4.0-rc.1).
fn is_debug(version: &str) -> bool {
    cfg!(debug_assertions) || version.contains('-')
}

fn valid_key(key: &str) -> Option<&str> {
    let rest = key.strip_prefix("A-EU-")?;
    (!rest.is_empty() && rest.chars().all(|c| c.is_ascii_alphanumeric())).then_some(key)
}

#[derive(Default)]
pub struct UsageState {
    /// The session's number and when it last sent; a number is seconds since 1970 times
    /// 10⁸ plus a random part, the form Aptabase checks.
    session: Option<(u64, SystemTime)>,
}

pub type SharedUsage = Mutex<UsageState>;

fn new_session(now: SystemTime) -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let secs = now.duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // Not a secret, only unlikely to repeat: the standard library's random hasher seed.
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(now.duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    secs * 100_000_000 + h.finish() % 100_000_000
}

fn session_id(state: &SharedUsage, now: SystemTime) -> u64 {
    let mut s = state.lock().unwrap_or_else(|e| e.into_inner());
    let id = match s.session {
        Some((id, last)) if now.duration_since(last).unwrap_or_default() < SESSION_IDLE => id,
        _ => new_session(now),
    };
    s.session = Some((id, now));
    id
}

#[derive(Deserialize)]
pub struct UsageEvent {
    name: String,
    props: Map<String, Value>,
    at: String,
}

fn word(s: &str, chars: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || chars.contains(c))
}

/// 2026-11-06T09:30:00.000Z, as the page's `toISOString` writes it.
fn timestamp(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 24
        && b.iter().enumerate().all(|(i, c)| match i {
            4 | 7 => *c == b'-',
            10 => *c == b'T',
            13 | 16 => *c == b':',
            19 => *c == b'.',
            23 => *c == b'Z',
            _ => c.is_ascii_digit(),
        })
}

/// The event as Aptabase takes it, or None if it isn't made of listed words alone.
fn event_body(e: &UsageEvent, session: u64, version: &str, os: &str, os_version: &str) -> Option<Value> {
    if !word(&e.name, "_", 32) || !timestamp(&e.at) || e.props.len() > 4 {
        return None;
    }
    for (k, v) in &e.props {
        if !word(k, "_", 24) || !v.as_str().is_some_and(|v| word(v, "_+-", 24)) {
            return None;
        }
    }
    Some(json!({
        "timestamp": e.at,
        "sessionId": session.to_string(),
        "eventName": e.name,
        "systemProps": {
            "isDebug": is_debug(version),
            "osName": os,
            "osVersion": os_version,
            "appVersion": version,
            "sdkVersion": format!("strandivo@{version}"),
        },
        "props": e.props,
    }))
}

fn os_name() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        _ => "Other",
    }
}

/// The client events are posted with.
fn http_client(version: &str) -> reqwest::Result<reqwest::Client> {
    crate::install_tls_provider();
    reqwest::Client::builder().timeout(Duration::from_secs(5)).user_agent(format!("Strandivo/{version}")).build()
}

/// Sends the page's events. Says whether they went: false without a key, for events that
/// aren't made of listed words, or when Aptabase can't be reached (they are then dropped,
/// as statistics aren't worth retrying for). Never an error, so a failure here never
/// becomes an error event of its own.
#[tauri::command]
pub async fn send_usage<R: Runtime>(app: AppHandle<R>, state: State<'_, SharedUsage>, events: Vec<UsageEvent>) -> Result<bool, ()> {
    let Some(key) = app_key() else { return Ok(false) };
    if events.is_empty() || events.len() > MAX_EVENTS {
        return Ok(false);
    }
    let version = app.package_info().version.to_string();
    let os_version: String = os_info::get().version().to_string().chars().filter(|c| c.is_ascii_alphanumeric() || ".-_ ()".contains(*c)).take(40).collect();
    let session = session_id(&state, SystemTime::now());
    let Some(body) = events.iter().map(|e| event_body(e, session, &version, os_name(), &os_version)).collect::<Option<Vec<_>>>() else {
        return Ok(false);
    };
    let Ok(client) = http_client(&version) else { return Ok(false) };
    let sent = client.post(ENDPOINT).header("App-Key", key).json(&body).send().await;
    Ok(sent.is_ok_and(|r| r.status().is_success()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(name: &str, props: Value) -> UsageEvent {
        UsageEvent { name: name.into(), props: props.as_object().cloned().unwrap_or_default(), at: "2026-11-06T09:30:00.000Z".into() }
    }

    // Release builds are the only ones with a key, so nothing else ever builds the client:
    // 0.3.0 crashed here, as reqwest had no TLS provider until an update check installed one.
    #[test]
    fn the_client_builds_before_any_update_check() {
        assert!(http_client("0.0.0").is_ok());
    }

    #[test]
    fn release_candidates_go_to_debug_mode() {
        assert!(is_debug("0.4.0-rc.1"));
        assert_eq!(is_debug("0.4.0"), cfg!(debug_assertions));
    }

    #[test]
    fn only_eu_keys_are_used() {
        assert_eq!(valid_key("A-EU-1234567890"), Some("A-EU-1234567890"));
        for k in ["", "A-US-1234567890", "A-EU-", "A-EU-12 34", "A-SH-1234"] {
            assert_eq!(valid_key(k), None, "{k}");
        }
        // Tests are debug builds, which never send.
        assert_eq!(app_key(), None);
    }

    #[test]
    fn events_are_listed_words_alone() {
        let ok = event_body(&ev("view_shown", json!({ "view": "map" })), 1, "0.3.0", "macOS", "15.1").unwrap();
        assert_eq!(ok["eventName"], "view_shown");
        assert_eq!(ok["props"]["view"], "map");
        assert_eq!(ok["systemProps"]["appVersion"], "0.3.0");
        assert!(ok["systemProps"].get("locale").is_none());
        assert!(event_body(&ev("reads_aligned", json!({ "reads": "21+" })), 1, "0.3.0", "macOS", "15.1").is_some());
        for bad in [
            ev("view_shown", json!({ "view": "pX330 copy.gb" })),
            ev("view_shown", json!({ "view": "/Users/anna" })),
            ev("view_shown", json!({ "view": 3 })),
            ev("view_shown", json!({ "View": "map" })),
            ev("View shown", json!({})),
            ev("e", json!({ "a": "a", "b": "b", "c": "c", "d": "d", "e": "e" })),
        ] {
            assert!(event_body(&bad, 1, "0.3.0", "macOS", "15.1").is_none(), "{}", bad.name);
        }
        let mut late = ev("check_saved", json!({}));
        late.at = "yesterday".into();
        assert!(event_body(&late, 1, "0.3.0", "macOS", "15.1").is_none());
    }

    #[test]
    fn a_session_lasts_until_four_hours_pass_without_events() {
        let state = SharedUsage::default();
        let t = UNIX_EPOCH + Duration::from_secs(1_800_000_000);
        let a = session_id(&state, t);
        assert_eq!(a / 100_000_000, 1_800_000_000);
        assert_eq!(session_id(&state, t + Duration::from_secs(3 * 3600)), a);
        assert_eq!(session_id(&state, t + Duration::from_secs(6 * 3600)), a);
        assert_ne!(session_id(&state, t + Duration::from_secs(11 * 3600)), a);
    }
}

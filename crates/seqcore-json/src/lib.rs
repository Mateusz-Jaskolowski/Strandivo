// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! What the interface sees of `seqcore`: the requests it sends and the responses it gets,
//! with their JSON field names. The desktop shell passes typed requests (Tauri parses
//! them) to [`align`] and [`detect`]; the WebAssembly build passes strings to
//! [`align_json`] and [`detect_json`]. Both use these structs, so they can't drift apart.

pub mod annotate;
pub mod sanger;

pub use annotate::{detect, DetectRequest, DetectResponse};
pub use sanger::{align, AlignRequest, AlignResponse};

/// Fingerprint of the built-in parts catalog (see `DetectResponse::catalog_version`).
pub fn catalog_version() -> &'static str {
    seqcore::parts::catalog_version()
}

/// Aligns the reads of an [`AlignRequest`] given as JSON and returns the
/// [`AlignResponse`] as JSON, or `{"error": "…"}` when the request doesn't parse.
pub fn align_json(request: &str) -> String {
    run(request, align)
}

/// Detects features for a [`DetectRequest`] given as JSON and returns the
/// [`DetectResponse`] as JSON, or `{"error": "…"}` when the request doesn't parse.
pub fn detect_json(request: &str) -> String {
    run(request, detect)
}

fn run<Req, Res>(request: &str, f: impl FnOnce(Req) -> Res) -> String
where
    Req: serde::de::DeserializeOwned,
    Res: serde::Serialize,
{
    let result = serde_json::from_str(request)
        .map_err(|e| format!("Bad request: {e}"))
        .and_then(|req| serde_json::to_string(&f(req)).map_err(|e| e.to_string()));
    result.unwrap_or_else(|message| serde_json::json!({ "error": message }).to_string())
}

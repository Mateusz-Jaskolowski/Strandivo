// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

//! The core for the browser version, run in a Web Worker by `src/core/worker.ts`.
//!
//! Requests and responses are the JSON of `seqcore-json`, passed through linear memory:
//! the worker gets a buffer with [`sv_alloc`], writes the request into it, calls
//! [`sv_align`] or [`sv_detect`] and frees it with [`sv_free`]. Every answer is a buffer
//! holding its length (4 bytes, little-endian) and then its UTF-8 bytes; the worker copies
//! it out and frees it, length included. No `wasm-bindgen`: two functions taking a string
//! and returning one don't need its command-line tool or generated glue.
//!
//! A panic aborts, which traps: the worker then drops this instance and starts a fresh one.
//! Just before that, [`sv_panic`] hands the worker the panic's message.

use std::slice;

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    /// Imported from the worker, which keeps the message to reject the request with.
    fn sv_panic(ptr: *const u8, len: usize);
}

#[cfg(target_arch = "wasm32")]
fn report_panics() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        std::panic::set_hook(Box::new(|info| {
            let payload = info.payload();
            let what = (payload.downcast_ref::<&str>().copied())
                .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("a panic");
            let message = match info.location() {
                Some(at) => format!("{what} at {}:{}", short_path(at.file()), at.line()),
                None => what.to_string(),
            };
            // SAFETY: the worker only reads `len` bytes from `ptr`, during this call.
            unsafe { sv_panic(message.as_ptr(), message.len()) };
        }));
    });
}

#[cfg(not(target_arch = "wasm32"))]
fn report_panics() {}

/// `…/crates/seqcore/src/align.rs` as `seqcore/src/align.rs`: a bug report names the
/// crate, not the folder it was built in.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn short_path(file: &str) -> &str {
    file.rfind("/src/")
        .and_then(|i| file[..i].rfind('/'))
        .map_or(file, |j| &file[j + 1..])
}

/// A buffer of `len` bytes for the worker to write a request into.
#[no_mangle]
pub extern "C" fn sv_alloc(len: usize) -> *mut u8 {
    // The first call into a fresh instance: from here on a panic says what it was.
    report_panics();
    Box::into_raw(vec![0u8; len].into_boxed_slice()) as *mut u8
}

/// Frees a buffer from [`sv_alloc`] or an answer, given its whole length.
///
/// # Safety
/// `ptr` and `len` must be a buffer this module handed out and not yet freed.
#[no_mangle]
pub unsafe extern "C" fn sv_free(ptr: *mut u8, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

/// Aligns reads: an `AlignRequest` in, an `AlignResponse` or `{"error": …}` out.
///
/// # Safety
/// `ptr` and `len` must be a buffer from [`sv_alloc`].
#[no_mangle]
pub unsafe extern "C" fn sv_align(ptr: *const u8, len: usize) -> *mut u8 {
    run(ptr, len, seqcore_json::align_json)
}

/// Detects features: a `DetectRequest` in, a `DetectResponse` or `{"error": …}` out.
///
/// # Safety
/// `ptr` and `len` must be a buffer from [`sv_alloc`].
#[no_mangle]
pub unsafe extern "C" fn sv_detect(ptr: *const u8, len: usize) -> *mut u8 {
    run(ptr, len, seqcore_json::detect_json)
}

/// The parts catalog's fingerprint, as plain text.
#[no_mangle]
pub extern "C" fn sv_catalog_version() -> *mut u8 {
    report_panics();
    answer(seqcore_json::catalog_version())
}

unsafe fn run(ptr: *const u8, len: usize, f: fn(&str) -> String) -> *mut u8 {
    match std::str::from_utf8(slice::from_raw_parts(ptr, len)) {
        Ok(request) => answer(&f(request)),
        Err(e) => answer(&format!(r#"{{"error":"Bad request: {e}"}}"#)),
    }
}

/// The answer's length, then its bytes, in a buffer the worker frees.
fn answer(text: &str) -> *mut u8 {
    let mut buf = Vec::with_capacity(4 + text.len());
    buf.extend_from_slice(&(text.len() as u32).to_le_bytes());
    buf.extend_from_slice(text.as_bytes());
    Box::into_raw(buf.into_boxed_slice()) as *mut u8
}

#[cfg(test)]
mod tests {
    use super::*;

    unsafe fn read(out: *mut u8) -> String {
        let len = u32::from_le_bytes(slice::from_raw_parts(out, 4).try_into().unwrap()) as usize;
        let text = String::from_utf8(slice::from_raw_parts(out.add(4), len).to_vec()).unwrap();
        sv_free(out, 4 + len);
        text
    }

    unsafe fn call(f: unsafe extern "C" fn(*const u8, usize) -> *mut u8, request: &str) -> String {
        let ptr = sv_alloc(request.len());
        ptr.copy_from_nonoverlapping(request.as_ptr(), request.len());
        let out = f(ptr, request.len());
        sv_free(ptr, request.len());
        read(out)
    }

    #[test]
    fn answers_carry_their_length() {
        unsafe {
            assert_eq!(read(sv_catalog_version()), seqcore_json::catalog_version());
            let found = call(
                sv_detect,
                r#"{"sequence":"ACGT","circular":false,"existing":[]}"#,
            );
            assert!(
                found.starts_with('{') && found.contains("suggestions"),
                "{found}"
            );
        }
    }

    #[test]
    fn a_bad_request_is_an_error_not_a_panic() {
        unsafe {
            assert!(call(sv_align, "not json").starts_with(r#"{"error":"Bad request"#));
            let ptr = sv_alloc(2);
            ptr.copy_from_nonoverlapping([0xff, 0xfe].as_ptr(), 2);
            let out = read(sv_align(ptr, 2));
            sv_free(ptr, 2);
            assert!(out.starts_with(r#"{"error":"Bad request"#), "{out}");
        }
    }

    #[test]
    fn panics_name_the_crate_not_the_build_folder() {
        assert_eq!(
            short_path("/home/runner/work/Strandivo/crates/seqcore/src/align.rs"),
            "seqcore/src/align.rs"
        );
        assert_eq!(
            short_path("/rustc/abc/library/alloc/src/raw_vec/mod.rs"),
            "alloc/src/raw_vec/mod.rs"
        );
        assert_eq!(short_path("lib.rs"), "lib.rs");
    }

    #[test]
    fn empty_buffers_are_fine() {
        unsafe {
            let ptr = sv_alloc(0);
            sv_free(ptr, 0);
        }
    }
}

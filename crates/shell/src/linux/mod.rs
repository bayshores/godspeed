//! What Linux needs beyond Tauri: WebKitGTK calls the webkit2gtk crate has no binding for.
#![expect(unsafe_code, reason = "the WebKitGTK calls with no safe binding go through the C library")]

pub mod demo;

//! What Windows needs beyond Tauri: WebView2 COM calls through webview2-com.
#![expect(unsafe_code, reason = "WebView2 is called through COM, whose calls are unsafe")]

pub mod demo;
pub mod drop;

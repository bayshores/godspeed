//! What the Mac needs beyond Tauri: AppKit and WebKit calls through objc2.
#![expect(unsafe_code, reason = "AppKit and WebKit are called through objc2, whose calls are unsafe")]

pub mod app_icon;
pub mod demo;
pub mod fonts;
pub mod print;
#[cfg(feature = "screens")]
pub mod screens;
pub mod window;

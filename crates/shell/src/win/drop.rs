//! A dropped file's path on Windows. WebView2 gives the page none, but a file the page posts to
//! the shell as an extra object of a message carries it (the shim's `pathForFile`). This second
//! message handler, beside wry's, takes the shim's drop messages and pushes the path back as
//! `drop-path`. They are strings: WebView2 calls no handler after wry's for any other kind.

use serde_json::{Value, json};
use tauri::webview::PlatformWebview;
use tauri::{AppHandle, Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs, ICoreWebView2WebMessageReceivedEventArgs2};
use webview2_com::{WebMessageReceivedEventHandler, take_pwstr};
use windows::core::{Interface, PWSTR};

use crate::log;
use crate::push::push;

pub fn install(main: &WebviewWindow) -> tauri::Result<()> {
	let app = main.app_handle().clone();
	main.with_webview(move |webview| {
		if let Err(err) = listen(&webview, app) {
			log::line(&format!("cannot take dropped files: {err}"));
		}
	})
}

fn listen(webview: &PlatformWebview, app: AppHandle) -> windows::core::Result<()> {
	let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
		let Some(args) = args else { return Ok(()) };
		let mut message = PWSTR::null();
		// SAFETY: reading a live message WebView2 handed over, on the main thread.
		unsafe { args.TryGetWebMessageAsString(&mut message)? };
		if let Some(n) = drop_number(&take_pwstr(message)) {
			push(&app, "drop-path", &json!({ "n": n, "path": file_path(&args).unwrap_or_default() }));
		}
		Ok(())
	}));
	let mut token = 0;
	// SAFETY: COM calls on the live main web view, on the main thread, where with_webview runs.
	unsafe { webview.controller().CoreWebView2()?.add_WebMessageReceived(&handler, &mut token) }
}

/// The shim's `{"lhDrop": n}`; any other message (Tauri's own calls) is someone else's.
fn drop_number(message: &str) -> Option<u64> {
	serde_json::from_str::<Value>(message).ok()?.get("lhDrop")?.as_u64()
}

/// The path of the message's first extra object, when it is a file.
fn file_path(args: &ICoreWebView2WebMessageReceivedEventArgs) -> Option<String> {
	let mut count = 0;
	let mut path = PWSTR::null();
	// SAFETY: reading the extra objects of a live message, on the main thread.
	unsafe {
		let objects = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>().ok()?.AdditionalObjects().ok()?;
		objects.Count(&mut count).ok()?;
		if count == 0 {
			return None;
		}
		objects.GetValueAtIndex(0).ok()?.cast::<ICoreWebView2File>().ok()?.Path(&mut path).ok()?;
	}
	Some(take_pwstr(path))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn only_the_shims_drop_messages_are_taken() {
		assert_eq!(drop_number(r#"{"lhDrop":3}"#), Some(3));
		assert_eq!(drop_number(r#"{"lhDrop":"3"}"#), None);
		assert_eq!(drop_number(r#"{"cmd":"x"}"#), None);
		assert_eq!(drop_number("not json"), None);
	}
}

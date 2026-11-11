//! What the screenshot lab needs from WebKit and AppKit: a picture of the page and the id of
//! the window.

use std::cell::Cell;
use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Duration;

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2::rc::Retained;
use objc2_app_kit::{NSImage, NSWindow};
use objc2_foundation::{NSError, NSNumber, NSSize};
use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
use tauri::WebviewWindow;

use super::demo::{describe, exact_png};

const LIMIT: Duration = Duration::from_secs(30);

/// Writes the page (not the title bar) to `path` as a PNG with two pixels to a point, whatever
/// the screen's own scale, and waits until the file is written.
pub fn snapshot(window: &WebviewWindow, path: PathBuf) -> Result<(), String> {
	let (tx, rx) = mpsc::channel();
	window
		.with_webview(move |platform| {
			// SAFETY: Tauri hands over this window's WKWebView on the main thread.
			let Some(view) = (unsafe { Retained::retain(platform.inner().cast::<WKWebView>()) }) else {
				let _ = tx.send(Err("the web view is gone".to_owned()));
				return;
			};
			let Some(scale) = view.window().map(|window| window.backingScaleFactor()) else {
				let _ = tx.send(Err("the web view has no window".to_owned()));
				return;
			};
			let size = view.frame().size;
			let pixels = NSSize::new(size.width * 2.0, size.height * 2.0);
			let tx = Cell::new(Some(tx));
			let drawn = RcBlock::new(move |image: *mut NSImage, err: *mut NSError| {
				// SAFETY: WebKit passes a valid image, or null and a valid error.
				let png = match unsafe { image.as_ref() } {
					Some(image) => exact_png(image, pixels),
					None => Err(describe(err)),
				};
				if let Some(tx) = tx.take() {
					let _ = tx.send(png.and_then(|png| gs_base::fsx::write_atomic(&path, &png, None).map_err(|err| err.to_string())));
				}
			});
			// SAFETY: a snapshot of the whole view on the main thread; the block lives until WebKit
			// calls it. WebKit draws the width in points at the screen's scale, so a 1x screen
			// asks for twice the width to get two pixels a point.
			unsafe {
				let config = WKSnapshotConfiguration::new(MainThreadMarker::from(&*view));
				config.setRect(view.bounds());
				config.setSnapshotWidth(Some(&NSNumber::new_f64(size.width * 2.0 / scale)));
				view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &drawn);
			}
		})
		.map_err(|err| err.to_string())?;
	rx.recv_timeout(LIMIT).map_err(|_| "the snapshot did not finish".to_owned())?
}

/// The window's id for `screencapture -l`.
pub fn window_number(window: &WebviewWindow) -> Result<isize, String> {
	let (tx, rx) = mpsc::channel();
	window
		.with_webview(move |platform| {
			// SAFETY: Tauri hands over this window's NSWindow on the main thread.
			let number = unsafe { Retained::retain(platform.ns_window().cast::<NSWindow>()) }.map(|window| window.windowNumber());
			let _ = tx.send(number);
		})
		.map_err(|err| err.to_string())?;
	rx.recv_timeout(LIMIT).ok().flatten().ok_or_else(|| "the window is gone".to_owned())
}

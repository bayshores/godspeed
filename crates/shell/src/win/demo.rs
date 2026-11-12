//! The demo window's WebView2 parts: its browser arguments, which keep every name of this
//! machine out of its network stack, and the SVG snapshot through the DevTools protocol.

use serde_json::{Value, json};
use tauri::webview::PlatformWebview;
use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2, ICoreWebView2CallDevToolsProtocolMethodCompletedHandler};
use windows::core::HSTRING;

use crate::demo::SvgDone;

/// The Mac's loopback rules as host resolver rules: 127.*, localhost with its subdomains and a
/// trailing dot, every IPv6 form starting with `::` (no public address does), and 0.0.0.0. The
/// resolver sits under every request the demo's browser makes (frames, workers, WebSockets,
/// redirects), and `^NOTFOUND` fails such a host before a socket opens. The page itself never
/// reaches it: WebView2 serves the `demo` scheme before the network.
const LOOPBACK_RULES: &str = "MAP 127.* ^NOTFOUND, MAP localhost ^NOTFOUND, MAP *.localhost ^NOTFOUND, MAP localhost. ^NOTFOUND, MAP *.localhost. ^NOTFOUND, MAP ::* ^NOTFOUND, MAP 0.0.0.0 ^NOTFOUND";

/// The demo browser's arguments: wry's defaults plus the loopback rules. The demo window has a
/// profile folder of its own, so it gets a browser of its own and these never reach the main one.
pub fn browser_args() -> String {
	// The self-test's name for this machine stands for any public name whose DNS answer is
	// 127.0.0.1, which no rule can see.
	#[cfg(feature = "self-test")]
	let rules = format!("MAP {} 127.0.0.1, {LOOPBACK_RULES}", crate::self_test::LOOPBACK_NAME);
	#[cfg(not(feature = "self-test"))]
	let rules = LOOPBACK_RULES;
	format!("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --host-resolver-rules=\"{rules}\"")
}

/// The loaded page as a PNG of exactly `width` × `height` px: the viewport is set to that size
/// at one pixel a point, whatever the screen's scale, then captured.
pub fn snapshot(webview: &PlatformWebview, width: u32, height: u32, done: SvgDone) {
	let metrics = json!({ "width": width, "height": height, "deviceScaleFactor": 1, "mobile": false }).to_string();
	let capture = json!({ "format": "png", "clip": { "x": 0, "y": 0, "width": width, "height": height, "scale": 1 } }).to_string();
	// SAFETY: COM calls on the live web view, on the main thread; WebView2 calls each handler
	// there once.
	let started = unsafe {
		webview.controller().CoreWebView2().and_then(|core| {
			let next = core.clone();
			let sized = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |sized, _| {
				if let Err(err) = sized {
					done(Err(format!("cannot size the snapshot: {err}")));
					return Ok(());
				}
				let captured = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |captured, answer| {
					done(captured.map_err(|err| err.to_string()).and_then(|()| png_from(&answer)));
					Ok(())
				}));
				call(&next, "Page.captureScreenshot", &capture, &captured)
			}));
			call(&core, "Emulation.setDeviceMetricsOverride", &metrics, &sized)
		})
	};
	// A call that never started leaves `done` unheard; the run's time limit answers it.
	if let Err(err) = started {
		crate::log::line(&format!("demo snapshot: {err}"));
	}
}

/// A DevTools protocol call.
///
/// # Safety
/// On the main thread, with a live web view.
unsafe fn call(core: &ICoreWebView2, method: &str, params: &str, then: &ICoreWebView2CallDevToolsProtocolMethodCompletedHandler) -> windows::core::Result<()> {
	// SAFETY: the caller's promise; the strings live through the call.
	unsafe { core.CallDevToolsProtocolMethod(&HSTRING::from(method), &HSTRING::from(params), then) }
}

/// `Page.captureScreenshot`'s answer is `{"data": <base64 PNG>}`.
fn png_from(answer: &str) -> Result<Vec<u8>, String> {
	let answer: Value = serde_json::from_str(answer).map_err(|err| err.to_string())?;
	let data = answer["data"].as_str().ok_or("the snapshot came back empty")?;
	Ok(gs_base::base64::decode(data))
}

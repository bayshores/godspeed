//! The demo window's WebView2 parts: a request filter that answers 403 for every address of this
//! machine, and the SVG snapshot through the DevTools protocol.

use std::net::{Ipv4Addr, Ipv6Addr};

use serde_json::{Value, json};
use tauri::Url;
use tauri::webview::PlatformWebview;
use webview2_com::Microsoft::Web::WebView2::Win32::{
	COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL, ICoreWebView2, ICoreWebView2_22,
	ICoreWebView2CallDevToolsProtocolMethodCompletedHandler,
};
use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, WebResourceRequestedEventHandler, take_pwstr};
use windows::core::{HSTRING, Interface, PWSTR};

use crate::demo::SvgDone;

/// wry hands every request that starts with this to the `demo` scheme, never the network.
const DEMO_SCHEME: &str = "http://demo.";

/// Answers 403, before the network, for every request that names this machine, from the page,
/// its frames and its workers.
pub fn block_loopback(webview: &PlatformWebview) -> Result<(), String> {
	let env = webview.environment();
	// SAFETY: COM calls on the live web view and its environment, on the main thread, where
	// with_webview runs and WebView2 calls the handler.
	unsafe {
		let core = webview.controller().CoreWebView2().map_err(|err| err.to_string())?;
		let all = HSTRING::from("*");
		match core.cast::<ICoreWebView2_22>() {
			Ok(core) => core.AddWebResourceRequestedFilterWithRequestSourceKinds(&all, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL),
			Err(_) => core.AddWebResourceRequestedFilter(&all, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL),
		}
		.map_err(|err| err.to_string())?;
		let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
			let Some(args) = args else { return Ok(()) };
			let mut uri = PWSTR::null();
			args.Request()?.Uri(&mut uri)?;
			if names_this_machine(&take_pwstr(uri)) {
				args.SetResponse(&env.CreateWebResourceResponse(None, 403, &HSTRING::from("Forbidden"), &HSTRING::new())?)?;
			}
			Ok(())
		}));
		let mut token = 0;
		core.add_WebResourceRequested(&handler, &mut token).map_err(|err| err.to_string())
	}
}

/// The Mac's loopback rules as a host check: 127.*, localhost with its subdomains and a trailing
/// dot, every IPv6 form starting with `::` (no public address does), and 0.0.0.0. The demo page
/// itself is let through.
fn names_this_machine(uri: &str) -> bool {
	if uri.starts_with(DEMO_SCHEME) {
		return false;
	}
	let Some(host) = Url::parse(uri).ok().and_then(|url| url.host_str().map(str::to_ascii_lowercase)) else { return false };
	if let Some(v6) = host.strip_prefix('[').and_then(|h| h.strip_suffix(']')) {
		return v6.parse::<Ipv6Addr>().is_ok_and(|ip| ip.segments()[0] == 0);
	}
	if let Ok(ip) = host.parse::<Ipv4Addr>() {
		return ip.is_loopback() || ip.is_unspecified();
	}
	let host = host.trim_end_matches('.');
	host == "localhost" || host.ends_with(".localhost")
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

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn every_name_of_this_machine_is_blocked() {
		for uri in [
			"http://127.0.0.1:4000/x",
			"https://127.8.9.10/",
			"http://a@127.0.0.1/",
			"http://a:b@localhost:3000/",
			"http://localhost/",
			"http://LOCALHOST/",
			"http://foo.localhost/",
			"http://a.b.localhost:9/",
			"http://localhost./",
			"http://[::1]:4000/",
			"http://a@[::1]/",
			"http://[::]/",
			"http://[::ffff:127.0.0.1]/",
			"http://0.0.0.0:4000/",
			"http://2130706433/",
			"http://ipc.localhost/get_zoom",
		] {
			assert!(names_this_machine(uri), "{uri} is not blocked");
		}
	}

	#[test]
	fn the_web_and_the_demo_page_go_through() {
		for uri in [
			"https://cdn.jsdelivr.net/npm/x.js",
			"https://example.com/",
			"http://128.0.0.1/",
			"http://[2001:db8::1]/",
			"http://localhost.example.com/",
			"http://demo.localhost/",
			"data:text/plain,hi",
		] {
			assert!(!names_this_machine(uri), "{uri} is blocked");
		}
	}
}

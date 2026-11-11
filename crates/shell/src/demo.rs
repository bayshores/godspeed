//! Runs what the server asks the shell's browser to do: a demo check or an SVG snapshot, each in
//! a hidden view of its own.

#[cfg(target_os = "macos")]
pub use crate::mac::demo::{run, svg};

#[cfg(not(target_os = "macos"))]
pub use crate::demo_webview::{run, svg};

#[cfg_attr(not(target_os = "macos"), expect(dead_code, reason = "the demo runner reads it"))]
pub struct DemoJob {
	pub html: String,
	/// A script whose value comes back as the probe result.
	pub probe: Option<String>,
}

/// Draw `svg` as a PNG of exactly `width` × `height` px.
#[cfg_attr(not(target_os = "macos"), expect(dead_code, reason = "the demo runner reads it"))]
pub struct SvgJob {
	pub svg: String,
	pub width: u32,
	pub height: u32,
}

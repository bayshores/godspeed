//! The clipboard's text, for Paste in an agent's terminal.

use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};

pub fn text() -> Option<String> {
	// SAFETY: AppKit's own pasteboard type constant.
	let string = unsafe { NSPasteboardTypeString };
	NSPasteboard::generalPasteboard().stringForType(string).map(|text| text.to_string())
}

//! Window behavior AppKit and WebKit settle: typing defaults, dragged file paths and the title
//! bar's double-click.

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSPasteboard, NSPasteboardNameDrag, NSPasteboardTypeFileURL, NSWindow};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL, NSUserDefaults};
use tauri::WebviewWindow;

/// What a double-click on the title bar does (System Settings, Desktop & Dock).
pub enum DoubleClick {
	Zoom,
	Minimize,
	Nothing,
}

/// WebKit's typing defaults, set before the first web view: red underlines for misspellings
/// like Chromium, and no rewriting of what is typed, which math and code boxes depend on.
pub fn register_text_defaults() {
	let (on, off) = (NSNumber::new_bool(true), NSNumber::new_bool(false));
	let keys = [
		"WebContinuousSpellCheckingEnabled",
		"WebAutomaticSpellingCorrectionEnabled",
		"WebAutomaticTextReplacementEnabled",
		"WebAutomaticQuoteSubstitutionEnabled",
		"WebAutomaticDashSubstitutionEnabled",
	]
	.map(NSString::from_str);
	let values: [&AnyObject; 5] = [&on, &off, &off, &off, &off];
	let defaults = NSDictionary::from_slices(&keys.each_ref().map(|key| &**key), &values);
	// SAFETY: string keys with NSNumber values, the property list types defaults take.
	unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&defaults) };
}

/// The file paths on the drag pasteboard (Finder puts one file URL per item).
pub fn drag_paths() -> Vec<String> {
	// SAFETY: AppKit's own pasteboard name and type constants.
	let (name, file_url) = unsafe { (NSPasteboardNameDrag, NSPasteboardTypeFileURL) };
	let Some(items) = NSPasteboard::pasteboardWithName(name).pasteboardItems() else { return Vec::new() };
	items
		.iter()
		.filter_map(|item| item.stringForType(file_url))
		// Finder's are file reference URLs (file:///.file/id=…), which name no path until resolved.
		.filter_map(|url| NSURL::URLWithString(&url)?.filePathURL()?.path())
		.map(|path| path.to_string())
		.collect()
}

pub fn double_click_action() -> DoubleClick {
	let action = NSUserDefaults::standardUserDefaults().stringForKey(&NSString::from_str("AppleActionOnDoubleClick"));
	match action.map(|action| action.to_string()).as_deref() {
		Some("Minimize") => DoubleClick::Minimize,
		Some("None") => DoubleClick::Nothing,
		_ => DoubleClick::Zoom,
	}
}

/// AppKit moves the traffic lights back to their default place when the title changes, and tao
/// puts them in ours only while it draws its content view, so that view is asked to draw again.
pub fn redraw_lights(window: &WebviewWindow) {
	let ns_window = window.clone();
	let _ = window.run_on_main_thread(move || {
		// SAFETY: Tauri hands over this window's NSWindow, autoreleased, on the main thread.
		let ns_window = ns_window.ns_window().ok().and_then(|ptr| unsafe { Retained::retain(ptr.cast::<NSWindow>()) });
		if let Some(view) = ns_window.and_then(|window| window.contentView()) {
			view.setNeedsDisplay(true);
		}
	});
}

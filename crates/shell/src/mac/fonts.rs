//! The installed font families, as the font picker lists them.

use objc2::MainThreadMarker;
use objc2_app_kit::NSFontManager;

/// AppKit's family names. AppKit's font manager lives on the main thread, where a command
/// without `async` runs; elsewhere the list is empty.
pub fn families() -> Vec<String> {
	let Some(mtm) = MainThreadMarker::new() else { return Vec::new() };
	NSFontManager::sharedFontManager(mtm).availableFontFamilies().iter().map(|family| family.to_string()).collect()
}

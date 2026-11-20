//! The app icon picked in Settings. The Dock shows it at once, and it is set on the app's own
//! bundle as a custom icon (what Finder's Get Info does), so the Dock, Finder and Spotlight keep
//! it after quit. A custom icon leaves the app's code signature valid.

use std::path::{Path, PathBuf};

use objc2::rc::Retained;
use objc2::{AnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage, NSWorkspace, NSWorkspaceIconCreationOptions};
use objc2_foundation::{NSData, NSString};
use serde_json::Value;

/// The picture of each icon Settings offers besides the app's own. The names must match
/// APP_ICONS in crates/core/src/records/settings.rs.
const CHOICES: [(&str, &[u8]); 2] = [("paper", include_bytes!("../../icons/choices/paper.png")), ("classic", include_bytes!("../../icons/choices/classic.png"))];

/// The file a custom icon lives in, inside the bundle.
const CUSTOM_ICON_FILE: &str = "Icon\r";

/// The picked icon's picture; None when the app's own icon is picked or the file cannot be read.
fn picked(settings: &Path) -> Option<&'static [u8]> {
	let saved: Value = serde_json::from_str(&std::fs::read_to_string(settings).ok()?).ok()?;
	let name = saved.pointer("/appearance/appIcon")?.as_str()?;
	CHOICES.iter().find(|(choice, _)| *choice == name).map(|(_, picture)| *picture)
}

/// The `.app` this program runs from; None for a build run straight from `target/`.
fn bundle() -> Option<PathBuf> {
	let program = std::env::current_exe().ok()?;
	program.ancestors().find(|folder| folder.extension().is_some_and(|extension| extension == "app")).map(Path::to_path_buf)
}

fn image(picture: &[u8]) -> Result<Retained<NSImage>, String> {
	NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(picture)).ok_or_else(|| "The icon's picture could not be read.".to_owned())
}

fn show_in_dock(image: Option<&NSImage>, mtm: MainThreadMarker) {
	// SAFETY: the property is `null_resettable`: nil brings back the app's own icon.
	unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(image) };
}

/// Sets `image` as the bundle's custom icon; None removes the custom icon.
fn stamp(bundle: &Path, image: Option<&NSImage>) -> Result<(), String> {
	let path = NSString::from_str(&bundle.to_string_lossy());
	if NSWorkspace::sharedWorkspace().setIcon_forFile_options(image, &path, NSWorkspaceIconCreationOptions::empty()) {
		Ok(())
	} else {
		Err(format!("The icon could not be saved on the app at {}, so it lasts only until godspeed quits.", bundle.display()))
	}
}

/// After a pick in Settings: the Dock and the bundle take the icon `settings` names.
pub fn apply(settings: &Path) -> Result<(), String> {
	let mtm = MainThreadMarker::new().ok_or("The icon can only change on the main thread.")?;
	let image = picked(settings).map(image).transpose()?;
	show_in_dock(image.as_deref(), mtm);
	bundle().map_or(Ok(()), |bundle| stamp(&bundle, image.as_deref()))
}

/// At start: the Dock shows the picked icon, and a bundle that lost it (an update replaces the
/// bundle) gets it back. With the app's own icon picked nothing is touched, so a custom icon
/// the learner set in Finder stays.
pub fn restore(settings: &Path) -> Result<(), String> {
	let Some(picture) = picked(settings) else { return Ok(()) };
	let mtm = MainThreadMarker::new().ok_or("The icon can only change on the main thread.")?;
	let image = image(picture)?;
	show_in_dock(Some(&image), mtm);
	match bundle() {
		Some(bundle) if !bundle.join(CUSTOM_ICON_FILE).exists() => stamp(&bundle, Some(&image)),
		_ => Ok(()),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn picked_for(name: &str, text: Option<&str>) -> Option<&'static [u8]> {
		let file = std::env::temp_dir().join(format!("gs-shell-app-icon-{name}-{}.json", std::process::id()));
		let _ = std::fs::remove_file(&file);
		if let Some(text) = text {
			gs_base::fsx::write_text_atomic(&file, text).unwrap();
		}
		let picture = picked(&file);
		let _ = std::fs::remove_file(&file);
		picture
	}

	#[test]
	fn a_picked_icon_has_its_picture() {
		for (name, picture) in CHOICES {
			assert_eq!(picked_for(name, Some(&format!(r#"{{"appearance":{{"appIcon":"{name}"}}}}"#))), Some(picture), "{name}");
			assert!(picture.starts_with(b"\x89PNG"), "{name}");
		}
	}

	#[test]
	fn the_app_s_own_icon_needs_no_picture() {
		assert_eq!(picked_for("missing", None), None);
		for (name, text) in [("null", r#"{"appearance":{"appIcon":null}}"#), ("no-appearance", r#"{"general":{}}"#), ("corrupt", "{"), ("unknown", r#"{"appearance":{"appIcon":"gold"}}"#)] {
			assert_eq!(picked_for(name, Some(text)), None, "{name}");
		}
	}
}

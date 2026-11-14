//! Opening things for the learner: a file in the file manager, and a folder or PDF in its
//! default app. Nothing here can launch a program the page names.

use std::path::{Path, PathBuf};

/// macOS treats these folders as packages: opening one launches or installs it.
const BUNDLE_EXTENSIONS: [&str; 14] = ["app", "appex", "bundle", "framework", "kext", "mdimporter", "mpkg", "pkg", "plugin", "prefpane", "qlgenerator", "saver", "workflow", "xpc"];

fn is_app_bundle(folder: &Path) -> bool {
	let Some(name) = folder.file_name().map(|name| name.to_string_lossy().to_lowercase()) else { return false };
	name.rsplit_once('.').is_some_and(|(_, extension)| BUNDLE_EXTENSIONS.contains(&extension))
}

/// Shows an absolute path selected in the file manager; a relative path, or one that is not there
/// (moved or deleted since the page listed it), does nothing.
pub fn show_in_folder(target: &str) -> Result<(), String> {
	if !Path::new(target).is_absolute() || std::fs::metadata(target).is_err() {
		return Ok(());
	}
	tauri_plugin_opener::reveal_item_in_dir(target).map_err(|err| err.to_string())
}

/// Opens a folder, or a PDF, in its default app. Links are resolved before any check, an app
/// bundle is a folder too and is only shown, and any other file does nothing.
pub fn open_path(target: &str) -> Result<(), String> {
	if !Path::new(target).is_absolute() {
		return Ok(());
	}
	let Ok(real) = std::fs::canonicalize(target) else { return Ok(()) };
	if real.is_dir() && is_app_bundle(&real) {
		tauri_plugin_opener::reveal_item_in_dir(&real).map_err(|err| err.to_string())
	} else if real.is_dir() || (real.is_file() && real.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))) {
		tauri_plugin_opener::open_path(without_verbatim_prefix(&real), None::<&str>).map_err(|err| err.to_string())
	} else {
		Ok(())
	}
}

/// Windows canonicalizes to `\\?\C:\…`, which Explorer's open call may not take; drive paths
/// lose the prefix, network paths keep it.
fn without_verbatim_prefix(path: &Path) -> PathBuf {
	let text = path.to_string_lossy();
	match text.strip_prefix(r"\\?\") {
		Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
		_ => path.to_owned(),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn macos_bundle_folders_are_told_apart_from_plain_folders() {
		for folder in ["/Applications/Utilities/Terminal.app", "/Users/me/Downloads/Installer.APP", "/Library/PreferencePanes/X.prefPane", "/x/Y.bundle", "/Users/me/Downloads/Setup.pkg", "/x/Z.xpc"] {
			assert!(is_app_bundle(Path::new(folder)), "{folder}");
		}
		for folder in ["/Users/me/CSE 21", "/Users/me/notes.app.d", "/Users/me/app", "/Users/me/Foo.app/Contents"] {
			assert!(!is_app_bundle(Path::new(folder)), "{folder}");
		}
	}

	#[test]
	fn a_drive_path_loses_the_verbatim_prefix_and_a_network_path_keeps_it() {
		assert_eq!(without_verbatim_prefix(Path::new(r"\\?\C:\Users\me\CSE 21")), PathBuf::from(r"C:\Users\me\CSE 21"));
		assert_eq!(without_verbatim_prefix(Path::new(r"\\?\UNC\host\share")), PathBuf::from(r"\\?\UNC\host\share"));
		assert_eq!(without_verbatim_prefix(Path::new("/Users/me")), PathBuf::from("/Users/me"));
	}

	fn temp(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("gs-shell-open-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	#[test]
	fn a_path_that_is_not_absolute_or_not_there_does_nothing() {
		assert_eq!(open_path("relative/dir"), Ok(()));
		assert_eq!(open_path("/gs-shell-open-nowhere"), Ok(()));
		assert_eq!(show_in_folder("relative/file"), Ok(()));
		assert_eq!(show_in_folder("/gs-shell-open-nowhere/gone.pdf"), Ok(()));
	}

	#[test]
	fn a_file_that_is_not_a_pdf_does_nothing() {
		let dir = temp("files");
		gs_base::fsx::write_text_atomic(&dir.join("notes.txt"), "x").unwrap();
		assert_eq!(open_path(dir.join("notes.txt").to_str().unwrap()), Ok(()));
		std::fs::remove_dir_all(dir).unwrap();
	}
}

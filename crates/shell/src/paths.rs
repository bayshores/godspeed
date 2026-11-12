//! Where the shell and its server keep things. userData is Electron's folder
//! (`app.getPath("userData")` with the name `godspeed`), so an update finds the same data.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Each launch's demo folder is this and its process id.
pub const DEMO_FOLDER_PREFIX: &str = "godspeed-demo-";

pub struct Paths {
	/// `godspeed` in the OS config folder; `godspeed-dev` for a debug build, so it never shares
	/// logs or the old-app check with the installed app.
	pub user_data: PathBuf,
	pub data: PathBuf,
	pub logs: PathBuf,
	/// What ships beside the server (`ui/`, `models/`, `pdfjs-dist/`): its working directory.
	pub resources: PathBuf,
	pub pdfium: PathBuf,
	/// The Electron updater's cache, which the first run removes. A debug build names its own,
	/// so it never removes the installed app's.
	pub updater_cache: PathBuf,
	/// The demo view's own folder: its browser profile on Windows, its compiled loopback rules
	/// on the Mac and Linux. It sits in the temp folder, except on Linux, where that is the
	/// shared /tmp: another user could make the folder first and swap the rules, so it sits in
	/// this user's cache folder there.
	pub demo_data: PathBuf,
}

impl Paths {
	pub fn new(app: &AppHandle) -> tauri::Result<Paths> {
		let resolver = app.path();
		let user_data = user_data(&resolver.config_dir()?, cfg!(debug_assertions));
		let resources = if cfg!(debug_assertions) { repo().join(".dev-resources") } else { resolver.resource_dir()? };
		Ok(Paths {
			data: data(&user_data),
			logs: user_data.join("logs"),
			pdfium: pdfium(&resources, std::env::consts::OS, cfg!(debug_assertions)),
			updater_cache: updater_cache(&resolver.cache_dir()?, cfg!(debug_assertions)),
			demo_data: if cfg!(target_os = "linux") { resolver.cache_dir()? } else { resolver.temp_dir()? }.join(format!("{DEMO_FOLDER_PREFIX}{}", std::process::id())),
			user_data,
			resources,
		})
	}
}

/// The repo a debug build was compiled from.
fn repo() -> PathBuf {
	Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn user_data(config_dir: &Path, debug: bool) -> PathBuf {
	config_dir.join(if debug { "godspeed-dev" } else { "godspeed" })
}

fn updater_cache(cache_dir: &Path, debug: bool) -> PathBuf {
	cache_dir.join(if debug { "godspeed-dev-updater" } else { "godspeed-updater" })
}

/// A debug build uses the repo's `data/` (or `LH_DATA_DIR`), as the browser dev server does.
fn data(user_data: &Path) -> PathBuf {
	if !cfg!(debug_assertions) {
		return user_data.join("data");
	}
	std::env::var_os("LH_DATA_DIR").filter(|v| !v.is_empty()).map_or_else(|| repo().join("data"), PathBuf::from)
}

/// pdfium's library: the Mac app keeps it in `Contents/Frameworks` (signed there), the others
/// in the resource folder, and debug runs in `.dev-resources`.
fn pdfium(resources: &Path, os: &str, debug: bool) -> PathBuf {
	match os {
		"macos" if debug => resources.join("libpdfium.dylib"),
		"macos" => resources.join("../Frameworks/libpdfium.dylib"),
		"windows" => resources.join("pdfium.dll"),
		_ => resources.join("libpdfium.so"),
	}
}

/// The server binary beside the shell's own (`Contents/MacOS` in the app, `target/<profile>`
/// in a cargo build).
pub fn server_binary() -> std::io::Result<PathBuf> {
	Ok(std::env::current_exe()?.with_file_name(if cfg!(windows) { "godspeed-server.exe" } else { "godspeed-server" }))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn user_data_is_electrons_folder_and_dev_has_its_own() {
		assert_eq!(user_data(Path::new("/c"), false), Path::new("/c/godspeed"));
		assert_eq!(user_data(Path::new("/c"), true), Path::new("/c/godspeed-dev"));
	}

	#[test]
	fn a_debug_build_never_names_the_installed_apps_updater_cache() {
		assert_eq!(updater_cache(Path::new("/k"), false), Path::new("/k/godspeed-updater"));
		assert_eq!(updater_cache(Path::new("/k"), true), Path::new("/k/godspeed-dev-updater"));
	}

	#[test]
	fn pdfium_per_os() {
		let r = Path::new("/app/Contents/Resources");
		assert_eq!(pdfium(r, "macos", false), Path::new("/app/Contents/Resources/../Frameworks/libpdfium.dylib"));
		assert_eq!(pdfium(r, "macos", true), Path::new("/app/Contents/Resources/libpdfium.dylib"));
		assert_eq!(pdfium(Path::new("C:/g"), "windows", false), Path::new("C:/g/pdfium.dll"));
		assert_eq!(pdfium(Path::new("/usr/lib/godspeed"), "linux", false), Path::new("/usr/lib/godspeed/libpdfium.so"));
		assert_eq!(pdfium(Path::new("/r"), "linux", true), Path::new("/r/libpdfium.so"));
	}

	#[test]
	fn the_server_sits_beside_the_shell() {
		let server = server_binary().unwrap();
		assert_eq!(server.parent(), std::env::current_exe().unwrap().parent());
		assert_eq!(server.file_stem().unwrap(), "godspeed-server");
	}
}

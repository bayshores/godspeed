//! What a program godspeed starts runs under: the app's own variables it must not inherit, and
//! the login shell that reads the learner's profile. The agent runtime uses them.

use std::ffi::OsStr;
use std::path::Path;

/// What an AppImage sets for itself; a program started from it must not inherit them.
const APPIMAGE_VARIABLES: [&str; 12] = ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "LD_LIBRARY_PATH", "LD_PRELOAD", "GDK_PIXBUF_MODULE_FILE", "GIO_EXTRA_MODULES", "GSETTINGS_SCHEMA_DIR", "GTK_PATH", "GTK_EXE_PREFIX", "GTK_DATA_PREFIX"];

/// Whether `key` is one of the app's own variables, which no program godspeed starts inherits:
/// the server's (`LH_`), Tauri's, and on Linux what an AppImage sets.
pub fn app_variable(key: &str, os: &str) -> bool {
	let upper = key.to_ascii_uppercase();
	upper.starts_with("LH_") || upper.starts_with("TAURI_") || (os == "linux" && APPIMAGE_VARIABLES.contains(&key))
}

/// The shells that read the learner's profile the way `-l -i -c` expects; any other `$SHELL`
/// (fish, nu) is replaced by the system's own.
const KNOWN_SHELLS: [&str; 5] = ["zsh", "bash", "sh", "dash", "ksh"];

pub fn login_shell(shell: &str, os: &str) -> String {
	let known = Path::new(shell).file_name().and_then(OsStr::to_str).is_some_and(|name| KNOWN_SHELLS.contains(&name));
	if known {
		shell.to_owned()
	} else if os == "macos" {
		"/bin/zsh".to_owned()
	} else {
		"/bin/bash".to_owned()
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_apps_own_variables_are_known_and_appimage_ones_only_on_linux() {
		assert!(app_variable("LH_DATA_DIR", "macos"));
		assert!(app_variable("tauri_env_debug", "windows"));
		assert!(app_variable("APPIMAGE", "linux"));
		assert!(!app_variable("APPIMAGE", "macos"));
		assert!(!app_variable("PATH", "linux"));
	}

	#[test]
	fn an_unknown_login_shell_falls_back_to_the_systems() {
		assert_eq!(login_shell("/opt/homebrew/bin/bash", "macos"), "/opt/homebrew/bin/bash");
		assert_eq!(login_shell("/usr/local/bin/fish", "macos"), "/bin/zsh", "fish ends in sh but is not one");
		assert_eq!(login_shell("/usr/bin/nu", "linux"), "/bin/bash");
		assert_eq!(login_shell("", "linux"), "/bin/bash");
	}
}

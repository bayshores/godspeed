//! Places the learner-filesystem tools never open: the home folder's credential stores, keys,
//! other agents' folders and browser profiles, `.env` files, and godspeed's own secret files.
//! Whatever a tool reads goes to the model, so a protected path is refused when named and left out
//! of listings and walks. This is a path check, not a sandbox.

use std::path::{Component, Path, PathBuf};

use gs_base::config::{Paths, home_dir, resolve};
use gs_base::fsx;

/// Folders and files of the home folder, with `/` between parts.
const HOME_LOCATIONS: [&str; 31] = [
	".ssh",
	".gnupg",
	".aws",
	".azure",
	".config/gcloud",
	".kube",
	".docker",
	".netrc",
	".npmrc",
	".pypirc",
	".git-credentials",
	".claude",
	".codex",
	".cursor",
	".gemini",
	"Library/Keychains",
	"Library/Cookies",
	"Library/Safari",
	"Library/Application Support/Google/Chrome",
	"Library/Application Support/BraveSoftware",
	"Library/Application Support/Microsoft Edge",
	"Library/Application Support/Firefox",
	".mozilla",
	".config/google-chrome",
	".config/chromium",
	".config/BraveSoftware",
	".config/microsoft-edge",
	"AppData/Local/Google/Chrome",
	"AppData/Local/BraveSoftware",
	"AppData/Local/Microsoft/Edge",
	"AppData/Roaming/Mozilla",
];

/// Files in the data folder that hold a secret. The rest of the data folder stays readable.
const DATA_SECRETS: [&str; 3] = ["mcp-token", "search-key", "settings.json"];

/// Protected locations as lower-case path parts, in the spelling they are named by and with
/// symlinks settled. A part is compared whole, so `.sshfoo` is not `.ssh`.
pub struct Protected {
	roots: Vec<Vec<String>>,
	data_folders: Vec<Vec<String>>,
}

impl Protected {
	/// The protected places of this learner's home folder and godspeed's data folder.
	pub fn current() -> Protected {
		Protected::new(&home_dir(), &Paths::from_env().data)
	}

	pub fn new(home: &Path, data: &Path) -> Protected {
		let mut roots = Vec::new();
		for location in HOME_LOCATIONS {
			add_both_spellings(&mut roots, &location.split('/').fold(home.to_path_buf(), |path, part| path.join(part)));
		}
		let mut data_folders = Vec::new();
		add_both_spellings(&mut data_folders, data);
		Protected { roots, data_folders }
	}

	/// Err when `path` is protected, in the words the tools give. `given` is the path as the
	/// caller wrote it. The path is checked as named and with every symlink in it settled, so a
	/// link into a protected folder is refused too.
	pub fn refuse(&self, given: &str, path: &Path) -> Result<(), String> {
		if self.hides(&resolve(path)) || self.hides(&real_path(path)) {
			return Err(format!("Access denied: {given} is a protected location."));
		}
		Ok(())
	}

	/// True for a protected path, which a walk or listing leaves out. `path` has no symlink or
	/// `..` in it, as a path made from an entry of a folder that was checked.
	pub fn hides(&self, path: &Path) -> bool {
		let parts = parts(path);
		let Some(name) = parts.last() else { return false };
		name.starts_with(".env")
			|| self.roots.iter().any(|root| parts.starts_with(root))
			|| self.data_folders.iter().any(|folder| parts.len() == folder.len() + 1 && parts.starts_with(folder) && is_secret(name))
	}
}

/// A data file that holds a secret, or the temp file a crashed save of it can leave.
fn is_secret(name: &str) -> bool {
	DATA_SECRETS.iter().any(|secret| name == *secret || name.strip_prefix(secret).is_some_and(|rest| rest.starts_with(".tmp-")))
}

/// `path` as written and as it really is, when that differs.
fn add_both_spellings(list: &mut Vec<Vec<String>>, path: &Path) {
	let named = parts(&resolve(path));
	let real = parts(&real_path(path));
	if real != named {
		list.push(real);
	}
	list.push(named);
}

fn parts(path: &Path) -> Vec<String> {
	path.components().filter(|part| !matches!(part, Component::CurDir)).map(|part| part.as_os_str().to_string_lossy().to_lowercase()).collect()
}

/// The path with symlinks settled. A part that does not exist yet stays as written, below the
/// real form of the nearest folder that does.
pub fn real_path(path: &Path) -> PathBuf {
	if let Ok(real) = std::fs::canonicalize(path) {
		return fsx::without_long_prefix(real);
	}
	let flat = resolve(path);
	let mut missing = Vec::new();
	let mut folder = flat.as_path();
	while let (Some(name), Some(parent)) = (folder.file_name(), folder.parent()) {
		missing.push(name);
		folder = parent;
		if let Ok(real) = std::fs::canonicalize(folder) {
			return missing.iter().rev().fold(fsx::without_long_prefix(real), |real, part| real.join(part));
		}
	}
	flat
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::fs_tools::tests::TempDir;

	/// A made-up home and data folder inside one temp folder.
	fn lab(label: &str) -> (TempDir, Protected) {
		let dir = TempDir::new(label);
		let guard = Protected::new(&dir.path().join("home"), &dir.path().join("data"));
		(dir, guard)
	}

	fn denied(guard: &Protected, dir: &TempDir, rel: &str) -> bool {
		guard.refuse(rel, &dir.path().join(rel)).is_err()
	}

	#[test]
	fn a_protected_folder_and_what_is_in_it_are_refused() {
		let (dir, guard) = lab("protected-folder");
		for rel in [
			"home/.ssh",
			"home/.ssh/id_rsa",
			"home/.aws/credentials",
			"home/.config/gcloud/credentials.db",
			"home/.claude/projects/x.jsonl",
			"home/.netrc",
			"home/Library/Keychains/login.keychain-db",
			"home/Library/Application Support/Google/Chrome/Default/Cookies",
			"home/AppData/Local/Microsoft/Edge/User Data/Default/Login Data",
		] {
			assert!(denied(&guard, &dir, rel), "{rel}");
		}
	}

	#[test]
	fn the_case_of_a_name_does_not_matter() {
		let (dir, guard) = lab("protected-case");
		dir.put("home/.ssh/id_rsa", "key");
		assert!(denied(&guard, &dir, "home/.SSH/id_rsa"));
		assert!(denied(&guard, &dir, "home/LIBRARY/keychains"));
		assert!(denied(&guard, &dir, "home/notes/.ENV.Local"));
	}

	#[test]
	fn a_dotdot_cannot_walk_into_a_protected_folder() {
		let (dir, guard) = lab("protected-dotdot");
		dir.put("home/notes/a.txt", "x");
		assert!(denied(&guard, &dir, "home/notes/../.ssh/id_rsa"));
		assert!(denied(&guard, &dir, "home/missing/../.ssh/id_rsa"));
	}

	#[test]
	#[cfg(unix)]
	fn a_symlink_into_a_protected_folder_is_refused() {
		let (dir, guard) = lab("protected-link");
		dir.put("home/.ssh/id_rsa", "key");
		dir.put("home/notes/a.txt", "x");
		dir.link("home/.ssh", "home/notes/innocent");
		dir.link("home/.ssh/id_rsa", "home/notes/key-link");
		assert!(denied(&guard, &dir, "home/notes/innocent"));
		assert!(denied(&guard, &dir, "home/notes/innocent/id_rsa"));
		assert!(denied(&guard, &dir, "home/notes/innocent/not-made-yet"));
		assert!(denied(&guard, &dir, "home/notes/key-link"));
		assert!(!denied(&guard, &dir, "home/notes/a.txt"));
	}

	#[test]
	#[cfg(unix)]
	fn a_home_that_is_itself_a_link_still_protects_its_folders() {
		let dir = TempDir::new("protected-home-link");
		dir.put("real/.ssh/id_rsa", "key");
		dir.link("real", "home");
		let guard = Protected::new(&dir.path().join("home"), &dir.path().join("data"));
		assert!(guard.refuse("x", &dir.path().join("home/.ssh/id_rsa")).is_err());
		assert!(guard.refuse("x", &dir.path().join("real/.ssh/id_rsa")).is_err());
	}

	#[test]
	fn env_files_are_refused_anywhere() {
		let (dir, guard) = lab("protected-env");
		for rel in ["home/notes/.env", "home/notes/.env.local", "elsewhere/.env.production", "home/project/.envrc"] {
			assert!(denied(&guard, &dir, rel), "{rel}");
		}
		assert!(!denied(&guard, &dir, "home/notes/env.txt"));
		assert!(!denied(&guard, &dir, "home/notes/my.env.md"));
	}

	#[test]
	fn the_data_folder_keeps_only_its_three_secret_files() {
		let (dir, guard) = lab("protected-data");
		for rel in ["data/mcp-token", "data/search-key", "data/settings.json", "data/Settings.JSON", "data/search-key.tmp-0123abcd"] {
			assert!(denied(&guard, &dir, rel), "{rel}");
		}
		for rel in ["data", "data/chats/chat_a.json", "data/spaces/spc_a/space.json", "data/spaces/spc_a/files/settings.json", "data/search-keys.txt", "home/notes/settings.json"] {
			assert!(!denied(&guard, &dir, rel), "{rel}");
		}
	}

	#[test]
	fn ordinary_paths_and_look_alikes_are_allowed() {
		let (dir, guard) = lab("protected-allowed");
		for rel in ["home", "home/notes/a.txt", "home/.sshfoo", "home/.sshfoo/key", "home/notes/.ssh-notes.txt", "home/.config", "home/.config/other/x", "home/Library/Application Support/Other", "home/.aws-notes"] {
			assert!(!denied(&guard, &dir, rel), "{rel}");
		}
	}

	#[test]
	fn a_refusal_names_the_path_as_given() {
		let (dir, guard) = lab("protected-text");
		assert_eq!(guard.refuse("~/.ssh/id_rsa", &dir.path().join("home/.ssh/id_rsa")), Err("Access denied: ~/.ssh/id_rsa is a protected location.".to_owned()));
		assert_eq!(guard.refuse("a.txt", &dir.path().join("home/a.txt")), Ok(()));
	}

	#[test]
	fn walks_and_listings_leave_protected_entries_out() {
		let (dir, guard) = lab("protected-hides");
		let home = dir.path().join("home");
		assert!(guard.hides(&home.join(".ssh")));
		assert!(guard.hides(&home.join(".env")));
		assert!(guard.hides(&home.join("a/.env.local")));
		assert!(!guard.hides(&home.join("a/b.txt")));
	}
}

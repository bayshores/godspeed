//! A scratch folder and a small `App` on it, for this module's unit tests.

use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::ids;

use crate::App;

/// A new folder under the system temp folder, removed when dropped.
pub struct Scratch(PathBuf);

impl Deref for Scratch {
	type Target = Path;
	fn deref(&self) -> &Path {
		&self.0
	}
}

impl Drop for Scratch {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.0);
	}
}

pub fn scratch_dir(label: &str) -> Scratch {
	let dir = std::env::temp_dir().join(format!("gs-app-{label}-{}", ids::uuid()));
	std::fs::create_dir_all(&dir).expect("the temp folder is writable");
	Scratch(dir)
}

/// An `App` whose data, home, tmp and resources folders are `root`'s `data`, `home`, `tmp` and
/// `res`.
pub fn test_app(root: &Path) -> Arc<App> {
	for name in ["data", "home", "tmp", "res"] {
		std::fs::create_dir_all(root.join(name)).expect("the scratch folder is writable");
	}
	App::new(Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")))
}

//! A scratch folder that is removed (and made writable again first) when the test ends.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

pub struct TempDir(PathBuf);

impl TempDir {
	pub fn new() -> TempDir {
		let dir = std::env::temp_dir().join(format!("gs-files-test-{}", gs_base::ids::uuid()));
		fs::create_dir_all(&dir).unwrap();
		TempDir(dir)
	}

	pub fn path(&self) -> &Path {
		&self.0
	}
}

/// Test files go through the same atomic writer the server uses.
pub fn write(file: impl AsRef<Path>, data: impl AsRef<[u8]>) {
	gs_base::fsx::write_atomic(file.as_ref(), data.as_ref(), None).unwrap();
}

fn unlock(dir: &Path) {
	let _ = fs::set_permissions(dir, fs::Permissions::from_mode(0o755));
	for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
		if entry.file_type().is_ok_and(|t| t.is_dir()) {
			unlock(&entry.path());
		}
	}
}

impl Drop for TempDir {
	fn drop(&mut self) {
		unlock(&self.0);
		let _ = fs::remove_dir_all(&self.0);
	}
}

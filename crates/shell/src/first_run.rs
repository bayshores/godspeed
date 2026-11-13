//! The first launch after the Electron app: back the data up once, then remove what Chromium and
//! the old updater left in userData. A failed backup leaves everything for the next launch.

use std::io;
use std::path::Path;
use std::time::Instant;

use crate::log;

/// Chromium writes it on every Electron run; a fresh install has none.
const MARKER: &str = "Local State";

/// Top level of userData only, never a pattern; the marker goes last.
const LEFTOVERS: [&str; 45] = [
	"Cache",
	"Code Cache",
	"GPUCache",
	"GPUPersistentCache",
	"DawnCache",
	"DawnGraphiteCache",
	"DawnWebGPUCache",
	"GraphiteDawnCache",
	"GrShaderCache",
	"ShaderCache",
	"Local Storage",
	"Session Storage",
	"IndexedDB",
	"WebStorage",
	"Shared Dictionary",
	"SharedStorage",
	"SharedStorage-wal",
	"Service Worker",
	"blob_storage",
	"databases",
	"Network",
	"Cookies",
	"Cookies-journal",
	"Network Persistent State",
	"TransportSecurity",
	"Trust Tokens",
	"Trust Tokens-journal",
	"DIPS",
	"DIPS-wal",
	"Preferences",
	"Crashpad",
	"Dictionaries",
	"VideoDecodeStats",
	"shared_proto_db",
	"QuotaManager",
	"QuotaManager-journal",
	"declarative_performance_observer.db",
	"declarative_performance_observer.db-journal",
	"Partitions",
	"SingletonLock",
	"SingletonCookie",
	"SingletonSocket",
	"lockfile",
	"compile-cache",
	MARKER,
];

pub fn run(user_data: &Path, updater_cache: &Path, version: &str) {
	if !user_data.join(MARKER).exists() {
		return;
	}
	if let Err(err) = back_up(user_data, version) {
		log::line(&format!("data backup failed: {err}"));
		return;
	}
	for name in LEFTOVERS {
		remove(&user_data.join(name));
	}
	remove(updater_cache);
}

/// `data/` to `data-backup-<version>`, once, without the search model.
fn back_up(user_data: &Path, version: &str) -> io::Result<()> {
	let data = user_data.join("data");
	let backup = user_data.join(format!("data-backup-{version}"));
	if !data.exists() || backup.exists() {
		return Ok(());
	}
	let partial = user_data.join(format!("data-backup-{version}.partial"));
	remove(&partial);
	let started = Instant::now();
	let bytes = copy_dir(&data, &partial, Some("models"))?;
	std::fs::rename(&partial, &backup)?;
	log::line(&format!("backed up data to {} ({bytes} bytes in {} ms)", backup.display(), started.elapsed().as_millis()));
	Ok(())
}

/// Copies `from` into the new folder `to` (APFS clones each file) and answers the bytes copied.
fn copy_dir(from: &Path, to: &Path, skip: Option<&str>) -> io::Result<u64> {
	std::fs::create_dir(to)?;
	let mut bytes = 0;
	for entry in std::fs::read_dir(from)? {
		let entry = entry?;
		if skip.is_some_and(|name| entry.file_name() == name) {
			continue;
		}
		let (source, target) = (entry.path(), to.join(entry.file_name()));
		let kind = entry.file_type()?;
		if kind.is_symlink() {
			copy_link(&source, &target)?;
		} else if kind.is_dir() {
			bytes += copy_dir(&source, &target, None)?;
		} else {
			bytes += std::fs::copy(&source, &target)?;
		}
	}
	Ok(bytes)
}

#[cfg(unix)]
fn copy_link(source: &Path, target: &Path) -> io::Result<()> {
	std::os::unix::fs::symlink(std::fs::read_link(source)?, target)
}

#[cfg(windows)]
fn copy_link(source: &Path, target: &Path) -> io::Result<()> {
	let link = std::fs::read_link(source)?;
	if std::fs::metadata(source).is_ok_and(|m| m.is_dir()) { std::os::windows::fs::symlink_dir(link, target) } else { std::os::windows::fs::symlink_file(link, target) }
}

fn remove(path: &Path) {
	let Ok(meta) = std::fs::symlink_metadata(path) else { return };
	let removed = if meta.is_dir() { std::fs::remove_dir_all(path) } else { std::fs::remove_file(path) };
	if let Err(err) = removed {
		log::line(&format!("cannot remove {}: {err}", path.display()));
	}
}

#[cfg(test)]
mod tests {
	use std::path::PathBuf;

	use super::*;

	fn put(file: &Path, text: &str) {
		gs_base::fsx::write_text_atomic(file, text).unwrap();
	}

	fn user_data(name: &str) -> PathBuf {
		let dir = std::env::temp_dir().join(format!("gs-shell-first-run-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(dir.join("data/models/m")).unwrap();
		std::fs::create_dir_all(dir.join("data/chats")).unwrap();
		put(&dir.join("data/settings.json"), "{}");
		put(&dir.join("data/chats/a.json"), "[1]");
		put(&dir.join("data/models/m/model.onnx"), "big");
		for kept in ["logs", "data-backup-0.5.1"] {
			std::fs::create_dir_all(dir.join(kept)).unwrap();
		}
		put(&dir.join(".updaterId"), "id");
		put(&dir.join("shell.pid"), "1\n");
		dir
	}

	fn electron_leftovers(dir: &Path) {
		std::fs::create_dir_all(dir.join("Code Cache/js")).unwrap();
		put(&dir.join("Cookies"), "c");
		put(&dir.join(MARKER), "{}");
	}

	#[test]
	fn backs_up_data_then_removes_the_leftovers() {
		let dir = user_data("after-electron");
		electron_leftovers(&dir);
		let cache = dir.join("updater-cache");
		std::fs::create_dir_all(cache.join("pending")).unwrap();
		run(&dir, &cache, "0.6.0");
		let backup = dir.join("data-backup-0.6.0");
		assert_eq!(std::fs::read_to_string(backup.join("chats/a.json")).unwrap(), "[1]");
		assert_eq!(std::fs::read_to_string(backup.join("settings.json")).unwrap(), "{}");
		assert!(!backup.join("models").exists());
		assert!(!dir.join("data-backup-0.6.0.partial").exists());
		for gone in ["Code Cache", "Cookies", MARKER] {
			assert!(!dir.join(gone).exists(), "{gone}");
		}
		assert!(!cache.exists());
		for kept in ["data/models/m/model.onnx", "data/chats/a.json", "logs", "data-backup-0.5.1", ".updaterId", "shell.pid"] {
			assert!(dir.join(kept).exists(), "{kept}");
		}
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn a_fresh_install_touches_nothing() {
		let dir = user_data("fresh");
		put(&dir.join("Cookies"), "not electron's");
		run(&dir, &dir.join("updater-cache"), "0.6.0");
		assert!(!dir.join("data-backup-0.6.0").exists());
		assert!(dir.join("Cookies").exists());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn an_existing_backup_is_kept_and_the_cleanup_still_runs() {
		let dir = user_data("backup-exists");
		electron_leftovers(&dir);
		std::fs::create_dir_all(dir.join("data-backup-0.6.0")).unwrap();
		put(&dir.join("data-backup-0.6.0/old.json"), "old");
		run(&dir, &dir.join("updater-cache"), "0.6.0");
		assert_eq!(std::fs::read_to_string(dir.join("data-backup-0.6.0/old.json")).unwrap(), "old");
		assert!(!dir.join("data-backup-0.6.0/chats").exists());
		assert!(!dir.join("Cookies").exists());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	#[cfg(unix)]
	fn a_failed_backup_keeps_the_leftovers_for_the_next_launch() {
		use std::os::unix::fs::PermissionsExt;
		let dir = user_data("failed");
		electron_leftovers(&dir);
		let locked = dir.join("data/chats");
		std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
		run(&dir, &dir.join("updater-cache"), "0.6.0");
		std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
		assert!(!dir.join("data-backup-0.6.0").exists());
		assert!(dir.join("Cookies").exists());
		assert!(dir.join(MARKER).exists());
		run(&dir, &dir.join("updater-cache"), "0.6.0");
		assert!(dir.join("data-backup-0.6.0/chats/a.json").exists());
		assert!(!dir.join(MARKER).exists());
		std::fs::remove_dir_all(dir).unwrap();
	}
}

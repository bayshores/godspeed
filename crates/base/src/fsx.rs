//! File helpers with Node's behavior: text read as `readFileSync(f, "utf8")`, writes by temp
//! file + rename (src/backend/store/write-file-atomic.ts), broken JSON set aside
//! (set-aside.ts), and fs error texts worded like Node's.

use std::io;
use std::path::Path;

use gs_json::{Json, parse};

use crate::{clock, ids, text};

/// `fs.readFileSync(file, "utf8")`: bad bytes become U+FFFD, a BOM stays.
pub fn read_text(file: &Path) -> io::Result<String> {
	Ok(text::from_utf8_lossy(&std::fs::read(file)?))
}

/// `fs.statSync(file).mtimeMs`: seconds and nanoseconds as fractional milliseconds.
pub fn modified_ms(meta: &std::fs::Metadata) -> f64 {
	#[cfg(unix)]
	{
		use std::os::unix::fs::MetadataExt;
		meta.mtime() as f64 * 1000.0 + meta.mtime_nsec() as f64 / 1e6
	}
	#[cfg(not(unix))]
	{
		let since_epoch = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).unwrap_or_default();
		since_epoch.as_secs_f64() * 1000.0
	}
}

/// Writes through `<file>.tmp-<8 hex>` and a rename, so a crash leaves the old file whole.
/// `mode` applies to a new file (Unix permissions, e.g. 0o600).
pub fn write_atomic(file: &Path, data: &[u8], mode: Option<u32>) -> io::Result<()> {
	if let Some(dir) = file.parent() {
		std::fs::create_dir_all(dir)?;
	}
	let tmp = file.with_file_name(format!("{}.tmp-{}", file.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(), &ids::uuid()[..8]));
	let written = write_new(&tmp, data, mode).and_then(|()| std::fs::rename(&tmp, file));
	if written.is_err() {
		let _ = std::fs::remove_file(&tmp);
	}
	written
}

/// `writeFileAtomic(file, text)`: the text as Node encodes it.
pub fn write_text_atomic(file: &Path, content: &str) -> io::Result<()> {
	write_atomic(file, &text::utf8_bytes(content), None)
}

fn write_new(file: &Path, data: &[u8], mode: Option<u32>) -> io::Result<()> {
	use std::io::Write;
	let mut options = std::fs::OpenOptions::new();
	options.write(true).create(true).truncate(true);
	#[cfg(unix)]
	if let Some(mode) = mode {
		std::os::unix::fs::OpenOptionsExt::mode(&mut options, mode);
	}
	#[cfg(not(unix))]
	let _ = mode;
	options.open(file)?.write_all(data)
}

/// Renames a file that is not valid JSON to `<file>.corrupt-<Date.now()>`, so the next save
/// cannot overwrite it. Never fails: the read still answers empty.
pub fn set_aside_corrupt(file: &Path) {
	let aside = format!("{}.corrupt-{}", file.display(), clock::now_ms());
	if std::fs::rename(file, aside).is_ok() {
		eprintln!("[store] {} was not valid JSON; kept it aside", file.display());
	}
}

/// A data file's parsed JSON. A missing or unreadable file reads as None; one that is not valid
/// JSON is kept aside (so the next save cannot overwrite it) and reads as None.
pub fn read_json_or_set_aside(file: &Path) -> Option<Json> {
	let raw = read_text(file).ok()?;
	match parse(&raw) {
		Ok(parsed) => Some(parsed),
		Err(_) => {
			set_aside_corrupt(file);
			None
		}
	}
}

/// Node's error code for an fs error (`err.code`), e.g. "ENOENT".
pub fn error_code(err: &io::Error) -> Option<&'static str> {
	describe(err).map(|(code, _)| code)
}

/// Node's fs error message: `ENOENT: no such file or directory, open '/x'`.
pub fn node_error_message(err: &io::Error, syscall: &str, path: &Path) -> String {
	match describe(err) {
		Some((code, text)) => format!("{code}: {text}, {syscall} '{}'", path.display()),
		None => format!("{err}, {syscall} '{}'", path.display()),
	}
}

/// libuv's code and text for an error.
fn describe(err: &io::Error) -> Option<(&'static str, &'static str)> {
	use io::ErrorKind as K;
	// EPERM (1) and EACCES (13) share a kind; the number is the same on macOS and Linux. On
	// Windows 1 is another error.
	if cfg!(unix) && err.raw_os_error() == Some(1) {
		return Some(("EPERM", "operation not permitted"));
	}
	Some(match err.kind() {
		K::NotFound => ("ENOENT", "no such file or directory"),
		K::PermissionDenied => ("EACCES", "permission denied"),
		K::AlreadyExists => ("EEXIST", "file already exists"),
		K::IsADirectory => ("EISDIR", "illegal operation on a directory"),
		K::NotADirectory => ("ENOTDIR", "not a directory"),
		K::DirectoryNotEmpty => ("ENOTEMPTY", "directory not empty"),
		K::ReadOnlyFilesystem => ("EROFS", "read-only file system"),
		K::InvalidFilename => ("ENAMETOOLONG", "name too long"),
		K::CrossesDevices => ("EXDEV", "cross-device link not permitted"),
		K::StorageFull => ("ENOSPC", "no space left on device"),
		K::ResourceBusy => ("EBUSY", "resource busy or locked"),
		K::InvalidInput => ("EINVAL", "invalid argument"),
		_ => return None,
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	fn dir(name: &str) -> std::path::PathBuf {
		let d = std::env::temp_dir().join(format!("gs-base-fsx-{name}-{}", ids::uuid()));
		std::fs::create_dir_all(&d).unwrap();
		d
	}

	#[test]
	fn atomic_write_replaces_whole_and_leaves_no_temp() {
		let d = dir("write");
		let f = d.join("sub/a.json");
		write_text_atomic(&f, "one").unwrap();
		write_atomic(&f, b"two", Some(0o600)).unwrap();
		assert_eq!(read_text(&f).unwrap(), "two");
		assert_eq!(std::fs::read_dir(d.join("sub")).unwrap().count(), 1);
		set_aside_corrupt(&f);
		assert!(!f.exists());
		let aside = std::fs::read_dir(d.join("sub")).unwrap().next().unwrap().unwrap().file_name();
		assert!(aside.to_string_lossy().starts_with("a.json.corrupt-"));
		std::fs::remove_dir_all(d).unwrap();
	}

	#[test]
	fn json_reads_back_and_a_broken_file_is_set_aside() {
		let d = dir("json");
		let f = d.join("a.json");
		assert_eq!(read_json_or_set_aside(&f), None);
		write_text_atomic(&f, r#"{"a":1}"#).unwrap();
		assert_eq!(read_json_or_set_aside(&f).unwrap()["a"].as_i64(), Some(1));
		write_text_atomic(&f, "{").unwrap();
		assert_eq!(read_json_or_set_aside(&f), None);
		assert!(!f.exists());
		assert_eq!(std::fs::read_dir(&d).unwrap().count(), 1);
		std::fs::remove_dir_all(d).unwrap();
	}

	#[test]
	fn errors_read_like_node() {
		let missing = Path::new("/nonexistent-gs/x");
		let err = std::fs::read(missing).unwrap_err();
		assert_eq!(node_error_message(&err, "open", missing), "ENOENT: no such file or directory, open '/nonexistent-gs/x'");
		assert_eq!(error_code(&err), Some("ENOENT"));
	}
}

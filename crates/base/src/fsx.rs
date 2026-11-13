//! File helpers with Node's behavior: text read as `readFileSync(f, "utf8")`, writes by temp
//! file + rename (src/backend/store/write-file-atomic.ts), broken JSON set aside
//! (set-aside.ts), and fs error texts worded like Node's.

use std::io::{self, Write};
use std::path::{Path, PathBuf};

use gs_json::{Json, parse};

use crate::{clock, ids, text};

/// `fs.readFileSync(file, "utf8")`: bad bytes become U+FFFD, a BOM stays.
pub fn read_text(file: &Path) -> io::Result<String> {
	Ok(text::from_utf8_lossy(&std::fs::read(file)?))
}

/// `fs.statSync(file).mtimeMs`: whole seconds and nanoseconds added as milliseconds, as Node
/// does (one fractional-seconds product rounds differently).
pub fn modified_ms(meta: &std::fs::Metadata) -> f64 {
	#[cfg(unix)]
	let (sec, nsec) = {
		use std::os::unix::fs::MetadataExt;
		(meta.mtime() as f64, meta.mtime_nsec() as f64)
	};
	#[cfg(not(unix))]
	let (sec, nsec) = {
		let since_epoch = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).unwrap_or_default();
		(since_epoch.as_secs() as f64, f64::from(since_epoch.subsec_nanos()))
	};
	sec * 1000.0 + nsec / 1e6
}

/// The path without Windows' `\\?\` long-path prefix, as Node's realpath and readlink give it, so
/// it still opens in tools that do not know the prefix and compares equal to the plain form.
pub fn without_long_prefix(path: PathBuf) -> PathBuf {
	let plain = path.to_string_lossy().strip_prefix(r"\\?\").and_then(|rest| {
		if rest.as_bytes().get(1) == Some(&b':') { Some(rest.to_owned()) } else { rest.strip_prefix("UNC\\").map(|share| format!(r"\\{share}")) }
	});
	plain.map_or(path, PathBuf::from)
}

/// `fs.mkdtempSync(path.join(tmp, prefix))`: a new folder `<prefix><6 random letters>`, owner only,
/// and Node's error text naming `<prefix>XXXXXX`.
pub fn make_temp_dir(tmp: &Path, prefix: &str) -> Result<PathBuf, String> {
	const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	loop {
		let suffix: String = ids::random_bytes(6).iter().map(|b| CHARS[*b as usize % CHARS.len()] as char).collect();
		let dir = tmp.join(format!("{prefix}{suffix}"));
		#[cfg_attr(not(unix), allow(unused_mut))]
		let mut builder = std::fs::DirBuilder::new();
		#[cfg(unix)]
		std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
		match builder.create(&dir) {
			Ok(()) => return Ok(dir),
			Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {}
			Err(err) => return Err(node_error_message(&err, "mkdtemp", &tmp.join(format!("{prefix}XXXXXX")))),
		}
	}
}

/// Writes through `<file>.tmp-<8 hex>` and a rename, so a crash leaves the old file whole.
/// `mode` applies to a new file (Unix permissions, e.g. 0o600).
pub fn write_atomic(file: &Path, data: &[u8], mode: Option<u32>) -> io::Result<()> {
	replace(file, mode, |out| out.write_all(data))
}

/// `write_atomic` for a file written piece by piece, so a big file is never built in memory first.
pub fn write_atomic_with(file: &Path, write: impl FnOnce(&mut dyn Write) -> io::Result<()>) -> io::Result<()> {
	replace(file, None, write)
}

/// `writeFileAtomic(file, text)`: the text as Node encodes it.
pub fn write_text_atomic(file: &Path, content: &str) -> io::Result<()> {
	write_atomic(file, &text::utf8_bytes(content), None)
}

fn replace(file: &Path, mode: Option<u32>, write: impl FnOnce(&mut dyn Write) -> io::Result<()>) -> io::Result<()> {
	if let Some(dir) = file.parent() {
		std::fs::create_dir_all(dir)?;
	}
	let tmp = file.with_file_name(format!("{}.tmp-{}", file.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(), &ids::uuid()[..8]));
	let written = write_new(&tmp, mode, write).and_then(|()| std::fs::rename(&tmp, file));
	if written.is_err() {
		let _ = std::fs::remove_file(&tmp);
	}
	written
}

fn write_new(file: &Path, mode: Option<u32>, write: impl FnOnce(&mut dyn Write) -> io::Result<()>) -> io::Result<()> {
	let mut options = std::fs::OpenOptions::new();
	options.write(true).create(true).truncate(true);
	#[cfg(unix)]
	if let Some(mode) = mode {
		std::os::unix::fs::OpenOptionsExt::mode(&mut options, mode);
	}
	#[cfg(not(unix))]
	let _ = mode;
	let mut out = io::BufWriter::new(options.open(file)?);
	write(&mut out)?;
	out.flush()
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
	fn a_file_written_in_pieces_is_whole_or_left_as_it_was() {
		let d = dir("pieces");
		let f = d.join("a.f32");
		write_atomic_with(&f, |out| (0..3).try_for_each(|i| out.write_all(&[i]))).unwrap();
		assert_eq!(std::fs::read(&f).unwrap(), [0, 1, 2]);
		let failed = write_atomic_with(&f, |out| {
			out.write_all(b"half")?;
			Err(io::Error::other("stopped"))
		});
		assert_eq!(failed.unwrap_err().to_string(), "stopped");
		assert_eq!(std::fs::read(&f).unwrap(), [0, 1, 2]);
		assert_eq!(std::fs::read_dir(&d).unwrap().count(), 1);
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
	fn modified_ms_adds_seconds_and_nanoseconds_like_node() {
		let d = dir("mtime");
		let f = d.join("a.txt");
		write_text_atomic(&f, "x").unwrap();
		// A time where (secs + nanos / 1e9) * 1000 gives 1700000000123.457 instead.
		let at = std::time::UNIX_EPOCH + std::time::Duration::new(1_700_000_000, 123_456_900);
		std::fs::File::options().write(true).open(&f).unwrap().set_modified(at).unwrap();
		assert_eq!(modified_ms(&std::fs::metadata(&f).unwrap()), 1_700_000_000_123.456_8);
		std::fs::remove_dir_all(d).unwrap();
	}

	#[test]
	fn a_temp_dir_is_new_each_time_and_a_missing_parent_reads_like_mkdtemp() {
		let d = dir("mkdtemp");
		let one = make_temp_dir(&d, "run-").unwrap();
		let two = make_temp_dir(&d, "run-").unwrap();
		assert_ne!(one, two);
		let name = one.file_name().unwrap().to_string_lossy().into_owned();
		assert!(name.starts_with("run-") && name.len() == 10, "{name}");
		let gone = d.join("gone");
		assert_eq!(make_temp_dir(&gone, "run-").unwrap_err(), format!("ENOENT: no such file or directory, mkdtemp '{}'", gone.join("run-XXXXXX").display()));
		std::fs::remove_dir_all(d).unwrap();
	}

	#[test]
	fn the_long_path_prefix_is_dropped() {
		let plain = |p: &str| without_long_prefix(PathBuf::from(p)).to_string_lossy().into_owned();
		assert_eq!(plain(r"\\?\C:\a\b"), r"C:\a\b");
		assert_eq!(plain(r"\\?\UNC\server\share\a"), r"\\server\share\a");
		assert_eq!(plain(r"\\?\Volume{x}\a"), r"\\?\Volume{x}\a");
		assert_eq!(plain("/a/b"), "/a/b");
	}

	#[test]
	fn errors_read_like_node() {
		let missing = Path::new("/nonexistent-gs/x");
		let err = std::fs::read(missing).unwrap_err();
		assert_eq!(node_error_message(&err, "open", missing), "ENOENT: no such file or directory, open '/nonexistent-gs/x'");
		assert_eq!(error_code(&err), Some("ENOENT"));
	}
}

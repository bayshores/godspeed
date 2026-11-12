//! Finding ffmpeg and whisper-cli (findProgram, WhisperMissingError in transcribe.ts).

use std::fmt;
use std::path::{Path, PathBuf};

use gs_core::contracts::space::SPEECH_TOOL_INSTALL;

/// Apps opened from the Dock don't inherit the shell's PATH, so the Homebrew prefixes are
/// searched explicitly.
pub(crate) const EXTRA_BIN_DIRS: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];

/// Shown on a file's badge when the programs are missing.
#[derive(Debug, PartialEq)]
pub struct WhisperMissingError {
	pub missing: Vec<&'static str>,
}

impl fmt::Display for WhisperMissingError {
	fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
		write!(f, "Recordings need whisper.cpp and ffmpeg. Run `{SPEECH_TOOL_INSTALL}`, then retry the file.")
	}
}

impl std::error::Error for WhisperMissingError {}

/// The two programs a transcription runs.
#[derive(Debug, PartialEq)]
pub(crate) struct Tools {
	pub whisper: PathBuf,
	pub ffmpeg: PathBuf,
}

/// The first executable named `name` on `path_env` or in the `extra` folders (the Homebrew
/// prefixes in production; tests pass none).
pub fn find_in(name: &str, path_env: Option<&str>, extra: &[&str]) -> Option<PathBuf> {
	let delimiter = if cfg!(windows) { ';' } else { ':' };
	let exe = format!("{name}.exe");
	let names: &[&str] = if cfg!(windows) { &[&exe, name] } else { &[name] };
	let dirs = path_env.unwrap_or("").split(delimiter).filter(|dir| !dir.is_empty()).chain(extra.iter().copied());
	for dir in dirs {
		for n in names {
			let candidate = join(dir, n);
			if is_executable_file(&candidate) {
				return Some(candidate);
			}
		}
	}
	None
}

/// Both programs, or a WhisperMissingError naming what's missing.
pub(crate) fn locate_tools(path_env: Option<&str>, extra: &[&str]) -> Result<Tools, WhisperMissingError> {
	let whisper = find_in("whisper-cli", path_env, extra).or_else(|| find_in("whisper-cpp", path_env, extra));
	let ffmpeg = find_in("ffmpeg", path_env, extra);
	match (whisper, ffmpeg) {
		(Some(whisper), Some(ffmpeg)) => Ok(Tools { whisper, ffmpeg }),
		(whisper, ffmpeg) => Err(WhisperMissingError {
			missing: [whisper.is_none().then_some("whisper-cpp"), ffmpeg.is_none().then_some("ffmpeg")].into_iter().flatten().collect(),
		}),
	}
}

/// `fs.accessSync(p, X_OK)` then `statSync(p).isFile()`.
fn is_executable_file(candidate: &Path) -> bool {
	std::fs::metadata(candidate).is_ok_and(|meta| meta.is_file() && can_execute(&meta))
}

#[cfg(unix)]
fn can_execute(meta: &std::fs::Metadata) -> bool {
	std::os::unix::fs::PermissionsExt::mode(&meta.permissions()) & 0o111 != 0
}

#[cfg(not(unix))]
fn can_execute(_meta: &std::fs::Metadata) -> bool {
	true
}

/// `path.join(dir, name)` on POSIX: slashes collapsed, `.` dropped, `..` resolved.
#[cfg(unix)]
fn join(dir: &str, name: &str) -> PathBuf {
	let joined = format!("{dir}/{name}");
	let absolute = joined.starts_with('/');
	let mut parts: Vec<&str> = Vec::new();
	for part in joined.split('/') {
		match part {
			"" | "." => {}
			".." => match parts.last() {
				Some(&last) if last != ".." => {
					parts.pop();
				}
				_ if absolute => {}
				_ => parts.push(".."),
			},
			other => parts.push(other),
		}
	}
	let body = parts.join("/");
	PathBuf::from(if absolute {
		format!("/{body}")
	} else if body.is_empty() {
		".".to_owned()
	} else {
		body
	})
}

/// `path.join(dir, name)` on Windows.
#[cfg(windows)]
fn join(dir: &str, name: &str) -> PathBuf {
	Path::new(dir).join(name)
}

#[cfg(all(test, unix))]
mod tests {
	use std::os::unix::fs::PermissionsExt;

	use super::*;
	use crate::test_support::Scratch;

	fn dir(scratch: &Scratch, tag: &str) -> PathBuf {
		let dir = scratch.0.join(tag);
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	fn script(dir: &Path, name: &str, mode: u32) -> PathBuf {
		let file = dir.join(name);
		gs_base::fsx::write_text_atomic(&file, "#!/bin/sh\n").unwrap();
		std::fs::set_permissions(&file, std::fs::Permissions::from_mode(mode)).unwrap();
		file
	}

	fn as_path(dir: &Path) -> String {
		dir.to_str().unwrap().to_owned()
	}

	#[test]
	fn join_matches_path_join() {
		assert_eq!(join("/a/b/", "x"), Path::new("/a/b/x"));
		assert_eq!(join("/a//b/../c/./d", "x"), Path::new("/a/c/d/x"));
		assert_eq!(join("/..", "x"), Path::new("/x"));
		assert_eq!(join("rel", "x"), Path::new("rel/x"));
		assert_eq!(join(".", "x"), Path::new("x"));
		assert_eq!(join("../up", "x"), Path::new("../up/x"));
		assert_eq!(join("a/../../up", "x"), Path::new("../up/x"));
	}

	#[test]
	fn an_executable_file_on_path_is_found_and_the_first_dir_wins() {
		let scratch = Scratch::new("programs");
		let (first, second) = (dir(&scratch, "first"), dir(&scratch, "second"));
		let exe = script(&first, "whisper-cli", 0o755);
		script(&second, "whisper-cli", 0o755);
		let path = format!("{}::{}", first.display(), second.display());
		assert_eq!(find_in("whisper-cli", Some(&path), &[]), Some(exe));
		assert_eq!(find_in("definitely-not-a-program-xyz", Some(&path), &[]), None);
	}

	#[test]
	fn files_that_cannot_run_are_skipped() {
		let scratch = Scratch::new("programs");
		let (plain, folder, good) = (dir(&scratch, "plain"), dir(&scratch, "folder"), dir(&scratch, "good"));
		script(&plain, "ffmpeg", 0o644);
		std::fs::create_dir(folder.join("ffmpeg")).unwrap();
		let exe = script(&good, "ffmpeg", 0o700);
		let path = format!("{}:{}:{}", plain.display(), folder.display(), good.display());
		assert_eq!(find_in("ffmpeg", Some(&path), &[]), Some(exe));
		assert_eq!(find_in("ffmpeg", Some(&format!("{}:{}", plain.display(), folder.display())), &[]), None);
	}

	#[test]
	fn a_symlink_to_an_executable_counts_and_the_extra_dirs_come_after_path() {
		let scratch = Scratch::new("programs");
		let (target, links, extra) = (dir(&scratch, "target"), dir(&scratch, "links"), dir(&scratch, "extra"));
		let exe = script(&target, "real", 0o755);
		std::os::unix::fs::symlink(&exe, links.join("ffmpeg")).unwrap();
		script(&extra, "ffmpeg", 0o755);
		let extra_dir = as_path(&extra);
		assert_eq!(find_in("ffmpeg", Some(&as_path(&links)), &[&extra_dir]), Some(links.join("ffmpeg")));
		assert_eq!(find_in("ffmpeg", None, &[&extra_dir]), Some(extra.join("ffmpeg")));
		assert_eq!(find_in("ffmpeg", Some(""), &[]), None);
	}

	#[test]
	fn missing_programs_are_named_in_order() {
		let scratch = Scratch::new("programs");
		let (both, only_ffmpeg, only_cpp, empty) = (dir(&scratch, "both"), dir(&scratch, "ffmpeg"), dir(&scratch, "cpp"), dir(&scratch, "empty"));
		script(&both, "whisper-cli", 0o755);
		script(&both, "ffmpeg", 0o755);
		script(&only_ffmpeg, "ffmpeg", 0o755);
		script(&only_cpp, "whisper-cpp", 0o755);
		let missing = |d: &Path| locate_tools(Some(&as_path(d)), &[]).unwrap_err().missing;
		assert_eq!(missing(&empty), ["whisper-cpp", "ffmpeg"]);
		assert_eq!(missing(&only_ffmpeg), ["whisper-cpp"]);
		assert_eq!(missing(&only_cpp), ["ffmpeg"]);
		let found = locate_tools(Some(&as_path(&both)), &[]).unwrap();
		assert_eq!(found, Tools { whisper: both.join("whisper-cli"), ffmpeg: both.join("ffmpeg") });
		let cpp_path = format!("{}:{}", as_path(&only_cpp), as_path(&only_ffmpeg));
		assert_eq!(locate_tools(Some(&cpp_path), &[]).unwrap().whisper, only_cpp.join("whisper-cpp"));
	}

	#[test]
	fn the_missing_error_carries_the_install_hint() {
		let err = WhisperMissingError { missing: vec!["ffmpeg"] };
		assert_eq!(err.to_string(), "Recordings need whisper.cpp and ffmpeg. Run `brew install whisper-cpp ffmpeg`, then retry the file.");
	}
}

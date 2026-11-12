//! One recording to its transcript (transcribeRecording in transcribe.ts).
//!
//! 1. ffmpeg converts the recording to 16 kHz mono WAV (whisper's input)
//! 2. whisper-cli writes the transcript (.txt)
//!
//! Programs are run without a shell and with fixed argument lists: file paths are arguments, never
//! part of a command line.

use std::ffi::OsString;
use std::fmt;
use std::path::{Path, PathBuf};

use gs_base::config::Paths;
use gs_base::{fsx, text};

use crate::exec::run_program;
use crate::model::ModelDownload;
use crate::programs::{HOMEBREW_BIN_DIRS, WhisperMissingError, locate_tools};

#[derive(Debug, PartialEq)]
pub enum TranscribeError {
	/// ffmpeg or whisper-cli is not installed (the file shows the install hint).
	WhisperMissing(WhisperMissingError),
	Failed(String),
}

impl fmt::Display for TranscribeError {
	fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
		match self {
			TranscribeError::WhisperMissing(err) => err.fmt(f),
			TranscribeError::Failed(message) => f.write_str(message),
		}
	}
}

impl std::error::Error for TranscribeError {}

/// Transcribes one recording to plain text at `out_file` and returns the text. Dropping the future
/// stops the running program and removes the temp folder.
pub async fn transcribe_recording(download: &ModelDownload, paths: &Paths, recording: &Path, out_file: &Path) -> Result<String, TranscribeError> {
	let path_env = std::env::var_os("PATH").map(|p| p.to_string_lossy().into_owned());
	transcribe_with(download, paths, path_env.as_deref(), &HOMEBREW_BIN_DIRS, recording, out_file).await
}

/// `transcribe_recording` with the program search given, so tests can keep the real ones out.
pub(crate) async fn transcribe_with(download: &ModelDownload, paths: &Paths, path_env: Option<&str>, extra_dirs: &[&str], recording: &Path, out_file: &Path) -> Result<String, TranscribeError> {
	use TranscribeError::{Failed, WhisperMissing};
	let tools = locate_tools(path_env, extra_dirs).map_err(WhisperMissing)?;
	let model = download.ensure_whisper_model(paths).await.map_err(Failed)?;
	let work = WorkDir::create(&paths.tmp).map_err(Failed)?;
	let wav = work.0.join("audio.wav");
	let ffmpeg_args = [os("-y"), os("-loglevel"), os("error"), os("-i"), recording.into(), os("-ar"), os("16000"), os("-ac"), os("1"), os("-c:a"), os("pcm_s16le"), wav.clone().into()];
	run_program(&tools.ffmpeg, &ffmpeg_args).await.map_err(Failed)?;
	let base = work.0.join("transcript");
	let whisper_args = [os("-m"), model.into(), os("-f"), wav.into(), os("-otxt"), os("-of"), base.clone().into(), os("-np")];
	run_program(&tools.whisper, &whisper_args).await.map_err(Failed)?;
	let transcript = PathBuf::from(format!("{}.txt", base.display()));
	let raw = fsx::read_text(&transcript).map_err(|err| Failed(fsx::node_error_message(&err, "open", &transcript)))?;
	let caption = text::trim(&raw.replace("\r\n", "\n").replace('\r', "\n")).to_owned();
	if let Some(dir) = out_file.parent() {
		std::fs::create_dir_all(dir).map_err(|err| Failed(fsx::node_error_message(&err, "mkdir", dir)))?;
	}
	fsx::write_text_atomic(out_file, &format!("{caption}\n")).map_err(|err| Failed(fsx::node_error_message(&err, "open", out_file)))?;
	Ok(caption)
}

fn os(s: &str) -> OsString {
	OsString::from(s)
}

/// A temp folder for one run, removed when the run ends or is dropped.
struct WorkDir(PathBuf);

impl WorkDir {
	/// `fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-transcribe-"))`.
	fn create(tmp: &Path) -> Result<WorkDir, String> {
		fsx::make_temp_dir(tmp, "godspeed-transcribe-").map(WorkDir)
	}
}

impl Drop for WorkDir {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.0);
	}
}

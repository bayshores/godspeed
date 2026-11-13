//! A space file as text for the notes pipeline: plain reads, PDF text, Word, PowerPoint and EPUB text,
//! caption cleanup. No model here. Also which files count as readable at all.

use std::collections::HashMap;
use std::fmt;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use std::time::SystemTime;

use gs_base::re::Re;
use gs_base::text::{from_utf8_lossy, trim};
use gs_core::contracts::space::{extension_of, is_office_file, is_recording_file, is_supported_space_file, is_transcript_file, plain_text_extensions};
use gs_pdf::worker::Pdf;
use parking_lot::Mutex;

use crate::epub::epub_text;
use crate::ioerr::read_file;
use crate::office::office_text;

/// How much of a file with no extension is checked for being text.
const TEXT_SNIFF_BYTES: usize = 8192;

/// Why a file has no text. A recording is not a failure: the caller sends it to the transcriber.
#[derive(Debug, PartialEq)]
pub enum FileTextError {
	NeedsTranscript,
	Failed(String),
}

impl fmt::Display for FileTextError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			FileTextError::NeedsTranscript => f.write_str("Recordings are transcribed by the transcriber"),
			FileTextError::Failed(message) => f.write_str(message),
		}
	}
}

/// Strips a WebVTT / SRT transcript down to its spoken text: no header, no cue numbers, no
/// timestamps, no styling tags; consecutive duplicate lines (rolling captions) collapse.
pub fn transcript_to_text(raw: &str) -> String {
	static TAG: LazyLock<Re> = LazyLock::new(|| Re::new(r"<[^>]+>", "g"));
	let mut out: Vec<String> = Vec::new();
	for line in raw.replace("\r\n", "\n").replace('\r', "\n").split('\n') {
		let t = trim(line);
		if t.is_empty() || t == "WEBVTT" || t.starts_with("WEBVTT ") || t.starts_with("NOTE") || t.starts_with("STYLE") {
			continue;
		}
		// An SRT cue number, then a timing line.
		if t.bytes().all(|b| b.is_ascii_digit()) || t.contains("-->") {
			continue;
		}
		let text = TAG.replace(t, "");
		let text = trim(&text);
		if text.is_empty() || out.last().is_some_and(|last| last == text) {
			continue;
		}
		out.push(text.to_owned());
	}
	out.join("\n")
}

/// The file's text for the notes pipeline. Unreadable files fail with a message; recordings with
/// `NeedsTranscript`, for the caller to route through the transcriber first.
pub async fn file_to_text(pdf: &Pdf, file: &Path) -> Result<String, FileTextError> {
	let name = file.to_string_lossy();
	let ext = extension_of(&name);
	let failed = FileTextError::Failed;
	// No extension: only ever added after looks_like_text said it is text.
	if ext.is_empty() || plain_text_extensions().any(|e| e == ext) {
		return read_file(file).map(|bytes| from_utf8_lossy(&bytes)).map_err(failed);
	}
	if is_transcript_file(&name) {
		return read_file(file).map(|bytes| transcript_to_text(&from_utf8_lossy(&bytes))).map_err(failed);
	}
	// Page-headed ("--- Page N ---"): the headings keep the extractor oriented in long readings.
	if ext == ".pdf" {
		return pdf.text(file).await.map_err(failed);
	}
	if is_office_file(&name) {
		return office_text(file).map_err(failed);
	}
	if ext == ".epub" {
		return epub_text(file).map_err(failed);
	}
	if is_recording_file(&name) {
		return Err(FileTextError::NeedsTranscript);
	}
	Err(failed(format!("Unsupported file type: {ext}")))
}

/// True when these bytes (a file's start) read as UTF-8 text: no NUL byte and nothing that isn't
/// UTF-8 (a character cut off at the end is fine). Empty is not text: an empty file has nothing
/// to learn from.
pub fn looks_like_text(bytes: &[u8]) -> bool {
	let head = &bytes[..bytes.len().min(TEXT_SNIFF_BYTES)];
	if head.is_empty() || head.contains(&0) {
		return false;
	}
	match std::str::from_utf8(head) {
		Ok(_) => true,
		// A character cut off at the end is fine; anything else that isn't UTF-8 is not.
		Err(e) => e.error_len().is_none(),
	}
}

/// `looks_like_text` per file on disk, kept while its size and time stay the same: the folder
/// scan runs every minute, and opening a synced Drive file can download it.
#[derive(Default)]
pub struct TextChecks {
	known: Mutex<HashMap<PathBuf, (SystemTime, u64, bool)>>,
}

impl TextChecks {
	/// None when the file couldn't be checked (a read error, Drive offline): that says nothing
	/// about it being text.
	pub fn file_looks_like_text(&self, file: &Path) -> Option<bool> {
		let meta = std::fs::metadata(file).ok()?;
		let stamp = (meta.modified().ok()?, meta.len());
		if let Some(&(time, size, text)) = self.known.lock().get(file)
			&& (time, size) == stamp
		{
			return Some(text);
		}
		let mut head = Vec::new();
		std::fs::File::open(file).ok()?.take(TEXT_SNIFF_BYTES as u64).read_to_end(&mut head).ok()?;
		let text = looks_like_text(&head);
		self.known.lock().insert(file.to_owned(), (stamp.0, stamp.1, text));
		Some(text)
	}
}

/// Can this file become space material? By its extension, or, with none, by its bytes being
/// text (`is_text`; None when they couldn't be read).
pub fn is_readable_space_file(name: &str, is_text: impl FnOnce() -> Option<bool>) -> Option<bool> {
	if is_supported_space_file(name) {
		return Some(true);
	}
	if extension_of(name).is_empty() { is_text() } else { Some(false) }
}

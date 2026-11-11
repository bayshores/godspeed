//! The attachment rules the server applies; the composer's previews and picker live in the
//! browser.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::text;
use gs_json::{Json, json};

/// One file as the composer sends it.
#[derive(Clone, Debug, PartialEq)]
pub struct ChatAttachment {
	pub name: String,
	pub mime_type: String,
	/// The file's bytes, base64.
	pub data: String,
}

pub const MAX_ATTACHMENTS: usize = 5;
/// The long side of a stored picture, in pixels.
pub const MAX_IMAGE_SIDE: u32 = 1568;

const MB: u64 = 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 20 * MB;
const MAX_PDF_BYTES: u64 = 30 * MB;
/// A PNG this small after resizing is likely a screenshot: PNG keeps its text sharp.
const SCREENSHOT_PNG_MAX_BYTES: u64 = MB + MB / 2;

const PDF_TYPE: &str = "application/pdf";
const IMAGE_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const HEIC_TYPES: [&str; 2] = ["image/heic", "image/heif"];

pub const HEIC_REFUSAL: &str = "Can't use HEIC photos yet. Export as JPG.";
pub const TOO_MANY_REFUSAL: &str = "You can add up to 5 files to one message.";

/// A file's type: the browser's, or read from its extension when the browser gives none.
fn attachment_type(name: &str, mime: &str) -> String {
	if !mime.is_empty() {
		return mime.to_owned();
	}
	let ext = match name.rsplit_once('.') {
		Some((_, ext)) if !ext.is_empty() && ext.bytes().all(|b| b.is_ascii_alphanumeric()) => ext.to_ascii_lowercase(),
		_ => return String::new(),
	};
	match ext.as_str() {
		"png" => "image/png",
		"jpg" | "jpeg" => "image/jpeg",
		"gif" => "image/gif",
		"webp" => "image/webp",
		"pdf" => PDF_TYPE,
		"heic" => "image/heic",
		"heif" => "image/heif",
		_ => "",
	}
	.to_owned()
}

pub fn is_pdf_type(mime: &str) -> bool {
	mime == PDF_TYPE
}

/// Why a file can't be added, or None when it can.
pub fn attachment_refusal(name: &str, mime: &str, size: u64) -> Option<String> {
	let kind = attachment_type(name, mime);
	if HEIC_TYPES.contains(&kind.as_str()) {
		return Some(HEIC_REFUSAL.to_owned());
	}
	if kind == PDF_TYPE {
		return (size > MAX_PDF_BYTES).then(|| format!("{name} is too big. PDFs can be up to 30 MB."));
	}
	if IMAGE_TYPES.contains(&kind.as_str()) {
		return (size > MAX_IMAGE_BYTES).then(|| format!("{name} is too big. Pictures can be up to 20 MB."));
	}
	Some(format!("Can't add {name}. Use a PNG, JPG, GIF, WebP or PDF."))
}

/// Decoded size of a base64 string, without decoding it.
pub fn base64_bytes(data: &str) -> u64 {
	let padding = if data.ends_with("==") {
		2
	} else if data.ends_with('=') {
		1
	} else {
		0
	};
	(text::len16(data) as u64 * 3 / 4).saturating_sub(padding)
}

/// Keep a resized picture as PNG (transparency, or a small screenshot); everything else is
/// stored as JPEG.
pub fn keeps_png(transparent: bool, source_png: bool, png_bytes: u64) -> bool {
	transparent || (source_png && png_bytes <= SCREENSHOT_PNG_MAX_BYTES)
}

/// A saved PDF's file name: a content hash keeps it unique (and a resend idempotent), the
/// cleaned name keeps it recognizable.
pub fn pdf_file_name(name: &str, hash: &str) -> String {
	static EXTENSION: LazyLock<Re> = LazyLock::new(|| Re::new(r"\.pdf$", "i"));
	static ODD: LazyLock<Re> = LazyLock::new(|| Re::new(r"[^A-Za-z0-9._ -]+", "g"));
	static LEADING: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[.\s]+", ""));
	let cleaned = LEADING.replace(&ODD.replace(&EXTENSION.replace(name, ""), "_"), "");
	let stem = text::trim(&text::slice16(&cleaned, 0, Some(80))).to_owned();
	let stem = if stem.is_empty() { "document" } else { &stem };
	format!("{}-{stem}.pdf", text::slice16(hash, 0, Some(12)))
}

const PDF_NOTE_HEAD: &str = "[Attached PDF] ";
const PDF_NOTE_PATH: &str = "Path: ";
const PDF_NOTE_TAIL: &str = "Read it with the pdf tool when you need its content.";

/// The text part that stands for a saved PDF: the teacher reads its name and path, the view turns
/// it back into a chip (`pdf_note_of`).
pub fn pdf_note(name: &str, file_path: &str) -> Json {
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	json!({ "type": "text", "text": format!("{PDF_NOTE_HEAD}{}\n{PDF_NOTE_PATH}{file_path}\n{PDF_NOTE_TAIL}", SPACES.replace(name, " ")) })
}

/// The name and path a `pdf_note` text holds, or None for any other text.
pub fn pdf_note_of(note: &str) -> Option<(String, String)> {
	let lines: Vec<&str> = note.split('\n').collect();
	match lines[..] {
		[head, path, PDF_NOTE_TAIL] => Some((head.strip_prefix(PDF_NOTE_HEAD)?.to_owned(), path.strip_prefix(PDF_NOTE_PATH)?.to_owned())),
		_ => None,
	}
}

/// A message's content as text: a string as is, parts joined by newlines with `[image]` for
/// pictures.
pub fn content_text(content: &Json) -> String {
	match content {
		Json::Str(s) => s.clone(),
		Json::Arr(parts) => parts.iter().map(|p| if p["type"].as_str() == Some("text") { p["text"].as_str().unwrap_or("").to_owned() } else { "[image]".to_owned() }).collect::<Vec<_>>().join("\n"),
		_ => String::new(),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn refusals_follow_type_and_size() {
		assert_eq!(attachment_refusal("a.HEIC", "", 1).as_deref(), Some(HEIC_REFUSAL));
		assert_eq!(attachment_refusal("a.pdf", "", MAX_PDF_BYTES), None);
		assert_eq!(attachment_refusal("a.pdf", "", MAX_PDF_BYTES + 1).as_deref(), Some("a.pdf is too big. PDFs can be up to 30 MB."));
		assert_eq!(attachment_refusal("p", "image/png", MAX_IMAGE_BYTES + 1).as_deref(), Some("p is too big. Pictures can be up to 20 MB."));
		assert_eq!(attachment_refusal("x.txt", "", 1).as_deref(), Some("Can't add x.txt. Use a PNG, JPG, GIF, WebP or PDF."));
		assert_eq!(attachment_refusal("x.tar.gz", "", 1).as_deref(), Some("Can't add x.tar.gz. Use a PNG, JPG, GIF, WebP or PDF."));
		assert_eq!(attachment_refusal("x.", "", 1).as_deref(), Some("Can't add x.. Use a PNG, JPG, GIF, WebP or PDF."));
		assert_eq!(attachment_refusal("photo.jpeg", "", 5), None);
	}

	#[test]
	fn base64_sizes_drop_the_padding() {
		assert_eq!(base64_bytes("QUJD"), 3);
		assert_eq!(base64_bytes("QUI="), 2);
		assert_eq!(base64_bytes("QQ=="), 1);
	}

	#[test]
	fn png_is_kept_for_transparency_and_small_screenshots() {
		assert!(keeps_png(true, false, u64::MAX));
		assert!(keeps_png(false, true, SCREENSHOT_PNG_MAX_BYTES));
		assert!(!keeps_png(false, true, SCREENSHOT_PNG_MAX_BYTES + 1));
		assert!(!keeps_png(false, false, 1));
	}

	#[test]
	fn pdf_names_are_cleaned_and_hashed() {
		assert_eq!(pdf_file_name("../My Notes (v2).PDF", "0123456789abcdef"), "0123456789ab-_My Notes _v2_.pdf");
		assert_eq!(pdf_file_name("...pdf", "ab"), "ab-document.pdf");
		assert_eq!(pdf_file_name(&"x".repeat(100), "h"), format!("h-{}.pdf", "x".repeat(80)));
	}

	#[test]
	fn pdf_notes_round_trip() {
		let note = pdf_note("my   file.pdf", "/tmp/a.pdf");
		let text = note["text"].as_str().unwrap();
		assert_eq!(pdf_note_of(text), Some(("my file.pdf".to_owned(), "/tmp/a.pdf".to_owned())));
		assert_eq!(pdf_note_of("[Attached PDF] x\nPath: y"), None);
		assert_eq!(content_text(&json!([{ "type": "text", "text": "a" }, { "type": "image" }])), "a\n[image]");
	}
}

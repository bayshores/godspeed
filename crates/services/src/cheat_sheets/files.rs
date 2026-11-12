//! A message's files beside the sheet: kept when the message is sent, read back for the agent.

use std::path::Path;

use gs_base::hash::sha256_hex;
use gs_core::messages::attachments::{ChatAttachment, pdf_file_name, pdf_note, pdf_note_of};
use gs_json::{Json, json};

use super::{Outcome, Stop};
use crate::App;
use crate::turns::attachments::{AttachmentError, store_attachments};

/// The type a kept picture is served and sent with, by its extension.
pub(super) fn picture_type(extension: &str) -> Option<&'static str> {
	match extension {
		"png" => Some("image/png"),
		"jpg" => Some("image/jpeg"),
		_ => None,
	}
}

/// The part of a name after its last dot (all of it when there is none).
pub(super) fn extension(file: &str) -> &str {
	file.rsplit('.').next().unwrap_or(file)
}

pub(super) fn is_pdf_name(file: &str) -> bool {
	file.len() >= 4 && file.is_char_boundary(file.len() - 4) && file[file.len() - 4..].eq_ignore_ascii_case(".pdf")
}

/// A message's files as the agent reads them: pictures inline, PDFs as a note naming their path.
/// Files that are gone are left out.
pub(super) fn files_for_agent(app: &App, space_id: &str, deadline_id: &str, files: &[Json]) -> Vec<Json> {
	files
		.iter()
		.filter_map(|f| {
			let file = f["file"].as_str().filter(|file| !file.is_empty())?;
			let (path, bytes) = app.stores.cheat_sheets.read_cheat_sheet_file(space_id, deadline_id, file)?;
			if is_pdf_name(file) {
				return Some(pdf_note(f["name"].as_str().unwrap_or(""), &path.to_string_lossy()));
			}
			let mime_type = picture_type(extension(file)).unwrap_or("image/png");
			Some(json!({ "type": "image", "data": gs_base::base64::encode(&bytes), "mimeType": mime_type }))
		})
		.collect()
}

/// `name` without a trailing ".word".
fn without_extension(name: &str) -> &str {
	match name.rsplit_once('.') {
		Some((stem, ext)) if !ext.is_empty() && ext.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_') => stem,
		_ => name,
	}
}

/// Keeps a message's files beside the sheet: pictures resized as the lessons keep them, PDFs as
/// sent. Returns `{ name, file }` for each.
pub(super) fn keep_files(app: &App, space_id: &str, deadline_id: &str, attachments: &[ChatAttachment]) -> Outcome<Vec<Json>> {
	let mut save = |file: &str, bytes: &[u8]| app.stores.cheat_sheets.save_cheat_sheet_file(space_id, deadline_id, file, bytes).map(|p| p.to_string_lossy().into_owned());
	let parts = store_attachments(attachments, &mut save).map_err(|err| match err {
		AttachmentError::Input(input) => Stop::Refuse(400, input.0),
		AttachmentError::Save(message) => Stop::Throw(message),
	})?;
	let mut kept = Vec::with_capacity(parts.len());
	for (part, attachment) in parts.iter().zip(attachments) {
		let name = &attachment.name;
		if part["type"].as_str() == Some("text") {
			let path = pdf_note_of(part["text"].as_str().unwrap_or("")).map(|(_, path)| path).unwrap_or_default();
			let file = Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
			kept.push(json!({ "name": name, "file": file }));
			continue;
		}
		let bytes = gs_base::base64::decode(part["data"].as_str().unwrap_or(""));
		// Named like a kept PDF (content hash, cleaned name), with the picture's own type.
		let named = pdf_file_name(without_extension(name), &sha256_hex(&bytes));
		let end = if part["mimeType"].as_str() == Some("image/png") { ".png" } else { ".jpg" };
		let file = format!("{}{end}", named.strip_suffix(".pdf").unwrap_or(&named));
		save(&file, &bytes)?;
		kept.push(json!({ "name": name, "file": file }));
	}
	Ok(kept)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn names_and_types() {
		assert_eq!(without_extension("photo.final.JPG"), "photo.final");
		assert_eq!(without_extension("notes"), "notes");
		assert_eq!(without_extension("a.b c"), "a.b c");
		assert_eq!(picture_type(extension("abc-x.png")), Some("image/png"));
		assert_eq!(picture_type(extension("abc-x.jpg")), Some("image/jpeg"));
		assert_eq!(picture_type(extension("abc-x.JPG")), None);
		assert!(is_pdf_name("A.PDF") && !is_pdf_name("a.pdf.png") && !is_pdf_name("pdf"));
	}
}

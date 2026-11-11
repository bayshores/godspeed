//! A message's files as the parts the agent reads (attachments.ts): each picture upright, resized
//! and re-encoded inline (gs_media), each PDF saved by `save_pdf` (beside the lesson, or the cheat
//! sheet) with a note naming its path. A file that is not what it claims is a 400.

use gs_base::base64;
use gs_base::hash::sha256_hex;
use gs_core::messages::attachments::{ChatAttachment, is_pdf_type, pdf_file_name, pdf_note};
use gs_core::messages::input_events::ChatInputError;
use gs_json::{Json, json};

/// Why the files could not be stored.
#[derive(Debug, PartialEq)]
pub enum AttachmentError {
	/// A file that is not what it claims: the honest 400.
	Input(ChatInputError),
	/// `save_pdf` failed (a throw: the route's 500).
	Save(String),
}

/// `save_pdf(file_name, bytes)`: saves a PDF and returns its path.
pub type SavePdf<'a> = dyn FnMut(&str, &[u8]) -> Result<String, String> + 'a;

/// Stores the files in order. A PDF listed before a bad file is already saved when the error
/// comes back, as in the TS.
pub fn store_attachments(attachments: &[ChatAttachment], save_pdf: &mut SavePdf) -> Result<Vec<Json>, AttachmentError> {
	let mut parts = Vec::with_capacity(attachments.len());
	for attachment in attachments {
		let bytes = base64::decode(&attachment.data);
		let part = if is_pdf_type(&attachment.mime_type) { pdf_part(&attachment.name, &bytes, save_pdf)? } else { image_part(&attachment.name, &bytes)? };
		parts.push(part);
	}
	Ok(parts)
}

fn pdf_part(name: &str, bytes: &[u8], save_pdf: &mut SavePdf) -> Result<Json, AttachmentError> {
	if !bytes.starts_with(b"%PDF-") {
		return Err(AttachmentError::Input(ChatInputError(format!("{name} is not a PDF."))));
	}
	let path = save_pdf(&pdf_file_name(name, &sha256_hex(bytes)), bytes).map_err(AttachmentError::Save)?;
	Ok(pdf_note(name, &path))
}

fn image_part(name: &str, bytes: &[u8]) -> Result<Json, AttachmentError> {
	let image = gs_media::attach::normalize_image(name, bytes).map_err(|message| AttachmentError::Input(ChatInputError(message)))?;
	Ok(json!({ "type": "image", "data": base64::encode(&image.bytes), "mimeType": image.mime_type }))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn file(name: &str, mime_type: &str, data: &str) -> ChatAttachment {
		ChatAttachment { name: name.to_owned(), mime_type: mime_type.to_owned(), data: data.to_owned() }
	}

	#[test]
	fn pdfs_are_saved_by_content_and_bad_files_refused_in_order() {
		let mut saved: Vec<String> = Vec::new();
		let mut save = |name: &str, bytes: &[u8]| {
			assert!(bytes.starts_with(b"%PDF-"));
			saved.push(name.to_owned());
			Ok(format!("/lessons/{name}"))
		};
		let pdf = base64::encode(b"%PDF-1.4 tiny");
		let parts = store_attachments(&[file("Notes.pdf", "application/pdf", &pdf)], &mut save).unwrap();
		let hash = sha256_hex(b"%PDF-1.4 tiny");
		assert_eq!(parts[0]["text"].as_str().unwrap(), format!("[Attached PDF] Notes.pdf\nPath: /lessons/{}-Notes.pdf\nRead it with the pdf tool when you need its content.", &hash[..12]));
		let fake = base64::encode(b"not a pdf");
		let err = store_attachments(&[file("a.pdf", "application/pdf", &pdf), file("b.pdf", "application/pdf", &fake)], &mut save).unwrap_err();
		assert_eq!(err, AttachmentError::Input(ChatInputError("b.pdf is not a PDF.".to_owned())));
		let err = store_attachments(&[file("c.png", "image/png", &fake)], &mut save).unwrap_err();
		assert_eq!(err, AttachmentError::Input(ChatInputError("Can't read c.png.".to_owned())));
		assert_eq!(saved.len(), 2);
	}

	#[test]
	fn a_failed_save_is_not_a_bad_input() {
		let mut save = |_: &str, _: &[u8]| Err("EACCES".to_owned());
		let pdf = base64::encode(b"%PDF-x");
		assert_eq!(store_attachments(&[file("a.pdf", "application/pdf", &pdf)], &mut save).unwrap_err(), AttachmentError::Save("EACCES".to_owned()));
	}
}

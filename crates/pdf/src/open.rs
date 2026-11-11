//! Opening a PDF and its pages the way pdf-ops.ts and headless.ts do, with pdf.js's error texts.

use std::io;
use std::path::Path;

use gs_base::config::resolve;
use gs_base::fsx::node_error_message;
use pdfium_render::prelude::{PdfDocument, PdfPage, PdfPageRenderRotation, PdfPoints, Pdfium, PdfiumError, PdfiumInternalError};

pub(crate) const INVALID: &str = "Invalid PDF structure.";

/// pdf-ops.ts reads with `fs.promises.readFile`.
pub(crate) fn open<'a>(pdfium: &'a Pdfium, file: &Path) -> Result<PdfDocument<'a>, String> {
	let bytes = std::fs::read(file).map_err(|e| {
		let syscall = if e.kind() == io::ErrorKind::IsADirectory { "read" } else { "open" };
		node_error_message(&e, syscall, file)
	})?;
	parse(pdfium, bytes)
}

/// headless.ts reads with `fs.readFileSync(path.resolve(file))`, whose folder error names no path.
pub(crate) fn open_resolved<'a>(pdfium: &'a Pdfium, file: &Path) -> Result<PdfDocument<'a>, String> {
	let file = resolve(file);
	let bytes = std::fs::read(&file).map_err(|e| match e.kind() {
		io::ErrorKind::IsADirectory => "EISDIR: illegal operation on a directory, read".to_owned(),
		_ => node_error_message(&e, "open", &file),
	})?;
	parse(pdfium, bytes)
}

fn parse(pdfium: &Pdfium, bytes: Vec<u8>) -> Result<PdfDocument<'_>, String> {
	if bytes.is_empty() {
		return Err("The PDF file is empty, i.e. its size is zero bytes.".to_owned());
	}
	pdfium.load_pdf_from_byte_vec(bytes, None).map_err(|e| match e {
		PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PasswordError) => "No password given".to_owned(),
		_ => INVALID.to_owned(),
	})
}

/// Page `number` counted from 1; pdf.js's `getPage` text for one the document lacks.
pub(crate) fn page<'a>(doc: &PdfDocument<'a>, number: u32) -> Result<PdfPage<'a>, String> {
	if number == 0 || number > page_count(doc) {
		return Err("Invalid page request.".to_owned());
	}
	doc.pages().get((number - 1) as i32).map_err(|_| INVALID.to_owned())
}

pub(crate) fn page_count(doc: &PdfDocument) -> u32 {
	u32::try_from(doc.pages().len()).unwrap_or(0)
}

/// The page's width and height in points as pdf.js figures them: the page box in the numbers
/// the PDF wrote, swapped for a sideways page. pdfium keeps single precision, so each corner goes
/// through the shortest decimal that names it (595.28, not 595.2800293) before the subtraction.
pub(crate) fn page_size(page: &PdfPage) -> (f64, f64) {
	let decimal = |points: PdfPoints| points.value.to_string().parse().unwrap_or_else(|_| f64::from(points.value));
	let Ok(view) = page.boundaries().bounding() else { return (decimal(page.width()), decimal(page.height())) };
	let (width, height) = (decimal(view.bounds.right()) - decimal(view.bounds.left()), decimal(view.bounds.top()) - decimal(view.bounds.bottom()));
	match page.rotation() {
		Ok(PdfPageRenderRotation::Degrees90 | PdfPageRenderRotation::Degrees270) => (height, width),
		_ => (width, height),
	}
}

//! Alone in its test program, because the first library that loads serves the whole process.

use gs_pdf::Pdf;

#[tokio::test]
async fn a_missing_library_fails_each_job_with_a_text() {
	let empty = std::env::temp_dir().join("gs-pdf-no-library");
	std::fs::create_dir_all(&empty).unwrap();
	let pdf = Pdf::new(&empty);
	let error = pdf.pdf_probe(&empty.join("any.pdf")).await.unwrap_err();
	assert!(error.starts_with("The PDF reader could not load "), "{error}");
	assert!(pdf.pdf_shape(&empty.join("any.pdf")).await.unwrap_err().starts_with("The PDF reader could not load "));
}

#[tokio::test]
async fn creating_a_handle_loads_nothing() {
	let _ = Pdf::new(std::path::Path::new("/nowhere"));
}

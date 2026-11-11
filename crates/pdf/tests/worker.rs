//! The pdfium thread: handles clone across tasks and share one reader.

mod common;

use common::{fixture, pdf};

#[tokio::test]
async fn clones_work_across_tasks() {
	let Some(pdf) = pdf() else { return };
	let tasks: Vec<_> = (0..8)
		.map(|_| {
			let pdf = pdf.clone();
			tokio::spawn(async move { pdf.pdf_shape(&fixture("sample-3page.pdf")).await })
		})
		.collect();
	for task in tasks {
		assert_eq!(task.await.unwrap().unwrap().page_count, 3);
	}
}

#[tokio::test]
async fn a_failed_job_does_not_stop_the_next_one() {
	let Some(pdf) = pdf() else { return };
	assert!(pdf.pdf_probe(&fixture("truncated.pdf")).await.is_err());
	assert!(pdf.pdf_probe(&fixture("two-lines.pdf")).await.is_ok());
}

#[tokio::test]
async fn a_second_handle_reuses_the_loaded_library() {
	let Some(first) = pdf() else { return };
	first.pdf_probe(&fixture("two-lines.pdf")).await.unwrap();
	let second = gs_pdf::Pdf::new(std::path::Path::new("/nowhere"));
	second.pdf_probe(&fixture("two-lines.pdf")).await.unwrap();
}

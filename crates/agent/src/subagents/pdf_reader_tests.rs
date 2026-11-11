use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_engine::turn::faux::Scripted;
use gs_json::{Json, json};
use gs_pdf::test_support::shared_pdf;
use parking_lot::Mutex;

use super::*;
use crate::subagents::test_support::{FakeHeadless, calls, helper_options, reply_seeing, result_texts, says};

/// pdf/tests/fixtures/lines.pdf: synthetic pages of numbered lines.
fn lines_pdf() -> String {
	Path::new(env!("CARGO_MANIFEST_DIR")).join("../pdf/tests/fixtures/lines.pdf").to_string_lossy().into_owned()
}

/// A folder of its own under the system temp folder, removed on drop.
struct Scratch(PathBuf);

impl Scratch {
	fn new(name: &str) -> Scratch {
		let dir = std::env::temp_dir().join(format!("gs-pdf-reader-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		Scratch(dir)
	}
	fn path(&self, name: &str) -> String {
		self.0.join(name).to_string_lossy().into_owned()
	}
}

impl Drop for Scratch {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.0);
	}
}

fn no_demo() -> Result<crate::subagents::headless::DemoRunResult, String> {
	Err("unused".to_owned())
}

#[tokio::test]
async fn unreadable_sources_fail_before_any_model_call() {
	let scratch = Scratch::new("bad");
	std::fs::create_dir(scratch.path("folder.pdf")).unwrap();
	gs_base::fsx::write_text_atomic(Path::new(&scratch.path("empty.pdf")), "").unwrap();
	let script = Scripted::new();
	let (opts, _) = helper_options(&script, FakeHeadless::new(no_demo()));
	let pdf = Pdf::new(Path::new("/nonexistent"));
	let folder = run_pdf_reader_agent(&scratch.path("folder.pdf"), "Anything?", &pdf, &opts).await;
	assert_eq!(folder, json!({ "path": scratch.path("folder.pdf"), "question": "Anything?", "brief": "PDF failed: not a regular file", "pagesRead": [], "pagesConsulted": [] }));
	assert_eq!(run_pdf_reader_agent(&scratch.path("empty.pdf"), "", &pdf, &opts).await["brief"], Json::from("PDF failed: file is empty"));
	let missing = scratch.path("missing.pdf");
	assert_eq!(run_pdf_reader_agent(&missing, "", &pdf, &opts).await["brief"], Json::from(format!("PDF failed: ENOENT: no such file or directory, stat '{missing}'")));

	let Some(pdf) = shared_pdf() else { return };
	gs_base::fsx::write_text_atomic(Path::new(&scratch.path("garbage.pdf")), "This is not a PDF at all.\n").unwrap();
	assert_eq!(run_pdf_reader_agent(&scratch.path("garbage.pdf"), "", &pdf, &opts).await["brief"], Json::from("PDF failed: Invalid PDF structure."));
}

#[tokio::test]
async fn the_gate_sends_an_unread_finish_back_once() {
	let Some(pdf) = shared_pdf() else { return };
	let script = Scripted::new();
	let seen = Arc::new(Mutex::new(Vec::new()));
	script.reply(calls(&[("pdf_info", json!({}))]));
	reply_seeing(&script, says("Nothing to see."), &seen);
	reply_seeing(&script, calls(&[("pdf_extract", json!({ "pages": "1" })), ("pdf_render", json!({ "pages": "2-3", "dpi": 72 })), ("pdf_render", json!({ "pages": "x" }))]), &seen);
	reply_seeing(&script, says(" It lists lines (p. 1). "), &seen);
	let (opts, lines) = helper_options(&script, FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "What is on it?", &pdf, &opts).await;
	assert_eq!(result["brief"], Json::from("It lists lines (p. 1)."));
	assert_eq!(result["pagesRead"], json!([1, 2, 3]));
	assert_eq!(result["pagesConsulted"], json!([1, 2, 3]));
	let seen = seen.lock();
	assert!(result_texts(&seen[0])[0].starts_with(&format!("File: {}\nPages: ", lines_pdf())));
	assert_eq!(seen[1].last().unwrap()["content"], Json::from(UNREAD_FINISH_MESSAGE));
	// The request after the reads: the pdf_info result first, then this batch's.
	let texts = &result_texts(&seen[2])[1..];
	assert!(texts[0].starts_with("--- Page 1 ---\n"));
	assert_eq!(texts[1], "Rendered 2 page(s) at 72 DPI — the images follow below. Read them carefully (equations, diagrams, layout).");
	assert_eq!(texts[2], "ERROR: no pages rendered (spec matched nothing?)");
	let images = seen[2].last().unwrap();
	assert_eq!(images["content"][0]["text"], Json::from("The rendered page(s), in order (p2, p3):"));
	assert_eq!(images["content"].as_arr().unwrap().len(), 3);
	assert_eq!(lines.lock()[..3], ["pdf_info: triaging", "pdf_extract: 1", "pdf_render: 2-3 @72dpi"]);
}

#[tokio::test]
async fn searches_consult_without_reading() {
	let Some(pdf) = shared_pdf() else { return };
	let script = Scripted::new();
	let seen = Arc::new(Mutex::new(Vec::new()));
	script.reply(calls(&[("pdf_search", json!({ "query": "zzzzz" })), ("pdf_search", json!({ "query": "(" })), ("pdf_nope", json!({})), ("pdf_search", json!({ "query": 1, "literal": "yes", "context_lines": 0 }))]));
	reply_seeing(&script, says("Found it."), &seen);
	let (opts, lines) = helper_options(&script, FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "", &pdf, &opts).await;
	let texts = result_texts(&seen.lock()[0]);
	assert_eq!(texts[0], "No hits.");
	assert!(texts[1].starts_with("ERROR: Invalid regex: Invalid regular expression: /(/i: "), "{}", texts[1]);
	assert_eq!(texts[2], "ERROR: unknown tool \"pdf_nope\"");
	assert!(texts[3].starts_with("=== Page 1, line "), "{}", texts[3]);
	assert_eq!(result["brief"], Json::from("Found it."));
	assert_eq!(result["pagesRead"], json!([]));
	assert!(!result["pagesConsulted"].as_arr().unwrap().is_empty());
	assert_eq!(lines.lock()[0], "pdf_search: \"zzzzz\"");
	assert_eq!(lines.lock()[2], "pdf_search: \"1\"");
}

#[tokio::test]
async fn the_iteration_limit_and_crashes_fail() {
	let Some(pdf) = shared_pdf() else { return };
	let script = Scripted::new();
	for _ in 0..MAX_ITERATIONS {
		script.reply(calls(&[("pdf_info", json!({}))]));
	}
	let (opts, _) = helper_options(&script, FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "", &pdf, &opts).await;
	assert_eq!(result["brief"], Json::from("PDF failed: iteration limit (14) reached without a brief."));

	let script = Scripted::new();
	script.reply(calls(&[("pdf_extract", json!({ "pages": "1" }))]));
	script.run(|_| Box::pin(async { Err("overloaded".to_owned()) }));
	let (opts, _) = helper_options(&script, FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "", &pdf, &opts).await;
	assert_eq!(result["brief"], Json::from("PDF failed: the reader crashed: overloaded"));
	assert_eq!(result["pagesRead"], json!([1]), "pages read before the crash stay");
}

#[test]
fn render_specs_take_at_most_six_pages() {
	assert_eq!(render_batch("all"), vec![1, 2, 3, 4, 5, 6]);
	assert_eq!(render_batch(" ALL "), vec![1, 2, 3, 4, 5, 6]);
	assert_eq!(render_batch("1-8"), vec![1, 2, 3, 4, 5, 6]);
	assert_eq!(render_batch("3,3, 3-4,4"), vec![3, 4]);
	assert_eq!(render_batch("x"), Vec::<i64>::new());
	assert_eq!(render_batch("0"), Vec::<i64>::new());
	assert_eq!(render_batch("-3"), vec![1, 2, 3]);
	assert_eq!(render_batch("2-"), vec![2]);
	assert_eq!(render_batch("0-2"), vec![1, 2]);
	assert_eq!(render_batch("5-1"), Vec::<i64>::new());
	assert_eq!(render_batch("1-2-9"), vec![1, 2]);
	assert_eq!(render_batch("9,1,2,3,4,5,6,7"), vec![1, 2, 3, 4, 5, 9]);
	assert_eq!(render_batch("2.9"), vec![2]);
}

#[test]
fn arguments_read_like_javascript() {
	assert_eq!(arg_text(&Json::Null, "all"), "all");
	assert_eq!(arg_text(&json!(7), "all"), "7");
	assert_eq!(arg_text(&json!([1, null, "a"]), ""), "1,,a");
	assert_eq!(arg_text(&json!({ "a": 1 }), ""), "[object Object]");
	assert_eq!(num_or(&json!("3"), 3.0), 3.0);
	assert_eq!(num_or(&json!(1.5), 3.0), 1.5);
}

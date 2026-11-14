use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_engine::turn::faux::Scripted;
use gs_json::{Json, json};
use gs_pdf::test_support::shared_pdf;
use parking_lot::Mutex;

use super::*;
use crate::subagents::test_support::{FakeHeadless, calls, job_agent_options, reply_seeing, result_texts, says};

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
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(no_demo()));
	let pdf = Pdf::new(Path::new("/nonexistent"));
	let folder = run_pdf_reader_agent(&scratch.path("folder.pdf"), "Anything?", &pdf, None, &opts).await;
	assert_eq!(folder, json!({ "path": scratch.path("folder.pdf"), "question": "Anything?", "brief": "PDF failed: not a regular file", "pagesRead": [], "pagesConsulted": [] }));
	assert_eq!(run_pdf_reader_agent(&scratch.path("empty.pdf"), "", &pdf, None, &opts).await["brief"], Json::from("PDF failed: file is empty"));
	let missing = scratch.path("missing.pdf");
	assert_eq!(run_pdf_reader_agent(&missing, "", &pdf, None, &opts).await["brief"], Json::from(format!("PDF failed: ENOENT: no such file or directory, stat '{missing}'")));

	let Some(pdf) = shared_pdf() else { return };
	gs_base::fsx::write_text_atomic(Path::new(&scratch.path("garbage.pdf")), "This is not a PDF at all.\n").unwrap();
	assert_eq!(run_pdf_reader_agent(&scratch.path("garbage.pdf"), "", &pdf, None, &opts).await["brief"], Json::from("PDF failed: Invalid PDF structure."));
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
	let (opts, lines) = job_agent_options(&script, FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "What is on it?", &pdf, None, &opts).await;
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
	let (opts, lines) = job_agent_options(&script, FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "", &pdf, None, &opts).await;
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
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "", &pdf, None, &opts).await;
	assert_eq!(result["brief"], Json::from("PDF failed: iteration limit (14) reached without a brief."));

	let script = Scripted::new();
	script.reply(calls(&[("pdf_extract", json!({ "pages": "1" }))]));
	script.run(|_| Box::pin(async { Err("overloaded".to_owned()) }));
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "", &pdf, None, &opts).await;
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

/// A keeper that already holds page 1 and records what it is asked to keep.
fn keeper(saved: &Arc<Mutex<Vec<(u32, String)>>>) -> Keeper<'static> {
	let saved = saved.clone();
	Keeper {
		pages: BTreeMap::from([(1, "Kept one: $x^2$".to_owned())]),
		keep: Box::new(move |page, markdown| {
			saved.lock().push((page, markdown.to_owned()));
			Ok(())
		}),
	}
}

/// What the model was shown in each request: the prompt, the tool names and the tool results.
type Shown = Arc<Mutex<Vec<(String, Vec<String>, Vec<String>)>>>;

fn reply_showing(script: &Arc<Scripted>, reply: Json, shown: &Shown) {
	let shown = shown.clone();
	script.run(move |request| {
		let system = &request.messages[0];
		let tools = system["toolsAdded"].as_arr().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_owned()).collect();
		shown.lock().push((system["content"].as_str().unwrap().to_owned(), tools, result_texts(&request.messages)));
		Box::pin(async move { Ok(reply) })
	});
}

#[tokio::test]
async fn a_rendered_page_is_kept_and_served_from_then_on() {
	let Some(pdf) = shared_pdf() else { return };
	let script = Scripted::new();
	let shown: Shown = Arc::default();
	reply_showing(&script, calls(&[("pdf_info", json!({})), ("pdf_extract", json!({ "pages": "1-2" }))]), &shown);
	reply_showing(&script, calls(&[("pdf_render", json!({ "pages": "2" }))]), &shown);
	reply_showing(&script, calls(&[("save_page", json!({ "page": 2, "markdown": "  $$\\frac{a}{b}$$\nTwo, kept.  " }))]), &shown);
	reply_showing(&script, calls(&[("pdf_extract", json!({ "pages": "2" })), ("pdf_info", json!({}))]), &shown);
	reply_showing(&script, says("Two (p. 2)."), &shown);
	let saved = Arc::default();
	let (opts, lines) = job_agent_options(&script, FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "", &pdf, Some(keeper(&saved)), &opts).await;
	assert_eq!(result["brief"], Json::from("Two (p. 2)."));
	let shown = shown.lock();
	let (prompt, tools, _) = &shown[0];
	assert!(prompt.ends_with(KEEP_INSTRUCTIONS));
	assert_eq!(tools, &["pdf_info", "pdf_extract", "pdf_render", "pdf_search", "save_page"]);
	let first = &shown[1].2;
	let info: Vec<&str> = first[0].lines().filter(|l| l.starts_with("p1:") || l.starts_with("p2:")).collect();
	assert!(info[0].ends_with(" kept") && !info[1].ends_with(" kept"), "{info:?}");
	assert!(first[1].starts_with("--- Page 1 ---\nKept one: $x^2$\n--- Page 2 ---\n"), "{}", first[1]);
	assert_eq!(shown[3].2.last().unwrap(), "Saved page 2. Later readings and search get this text for it.");
	assert_eq!(*saved.lock(), [(2, "$$\\frac{a}{b}$$\nTwo, kept.".to_owned())]);
	let last = &shown[4].2;
	assert_eq!(last[last.len() - 2], "--- Page 2 ---\n$$\\frac{a}{b}$$\nTwo, kept.");
	assert!(last[last.len() - 1].lines().any(|l| l.starts_with("p2:") && l.ends_with(" kept")));
	assert!(lines.lock().contains(&"save_page: 2".to_owned()));
}

#[tokio::test]
async fn save_page_refuses_what_it_cannot_keep() {
	let Some(pdf) = shared_pdf() else { return };
	let count = pdf.pdf_shape(Path::new(&lines_pdf())).await.unwrap().page_count;
	let script = Scripted::new();
	let shown: Shown = Arc::default();
	let save = |page: Json, markdown: &str| ("save_page", json!({ "page": page, "markdown": markdown }));
	script.reply(calls(&[("pdf_render", json!({ "pages": "1-3" }))]));
	reply_showing(
		&script,
		calls(&[
			save(json!(count + 1), "Text."),
			save(json!(0), "Text."),
			save(json!(1.5), "Text."),
			save(json!(1), "  "),
			save(json!(1), &"x".repeat(6001)),
			save(json!(1), "$\u{c}rac{a}{b}$"),
			save(json!(1), "$\theta$"),
			save(json!(1), "Line\r\nnext"),
			save(json!(1), "$a \neq b$"),
			save(json!(1), "Text.\n--- Page 4 ---\nMore."),
			save(json!(1), "--- Slide 2 ---"),
			save(json!(5), "Text."),
			save(json!("1"), "One."),
			save(json!(2), "Two."),
			save(json!(3), "Three."),
		]),
		&shown,
	);
	reply_showing(&script, calls(&[save(json!(3), "Four.")]), &shown);
	reply_showing(&script, says("Done (p. 1)."), &shown);
	let saved = Arc::default();
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(no_demo()));
	run_pdf_reader_agent(&lines_pdf(), "", &pdf, Some(keeper(&saved)), &opts).await;
	let shown = shown.lock();
	let texts = &shown[1].2[1..];
	let range = format!("ERROR: page must be a whole number from 1 to {count}.");
	assert_eq!(texts[..3], [range.clone(), range.clone(), range]);
	assert_eq!(texts[3], "ERROR: markdown is empty.");
	assert_eq!(texts[4], "ERROR: markdown is 6001 characters long; the most is 6000.");
	for text in &texts[5..9] {
		assert_eq!(text, &format!("ERROR: {CONTROL_REFUSAL}"));
	}
	assert!(CONTROL_REFUSAL.contains(r"(\\frac)"));
	assert_eq!(texts[9..11], ["ERROR: markdown may not hold a line like \"--- Page 3 ---\".", "ERROR: markdown may not hold a line like \"--- Page 3 ---\"."]);
	assert_eq!(texts[11], "ERROR: page 5 was not rendered in this job. Render it with pdf_render and read it first.");
	assert!(texts[12..].iter().all(|t| t.starts_with("Saved page ")), "{texts:?}");
	assert_eq!(shown[2].2.last().unwrap(), "ERROR: this job already saved 3 pages, the most one job may save.");
	assert_eq!(saved.lock().iter().map(|(page, _)| *page).collect::<Vec<_>>(), [1, 2, 3]);
}

#[tokio::test]
async fn save_page_is_offered_only_with_a_keeper() {
	let Some(pdf) = shared_pdf() else { return };
	let script = Scripted::new();
	let shown: Shown = Arc::default();
	reply_showing(&script, calls(&[("pdf_render", json!({ "pages": "1" }))]), &shown);
	reply_showing(&script, calls(&[("save_page", json!({ "page": 1, "markdown": "One." }))]), &shown);
	reply_showing(&script, says("One (p. 1)."), &shown);
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(no_demo()));
	run_pdf_reader_agent(&lines_pdf(), "", &pdf, None, &opts).await;
	let shown = shown.lock();
	assert_eq!(shown[0].0, INSTRUCTIONS);
	assert!(!shown[0].1.contains(&"save_page".to_owned()));
	assert_eq!(shown[2].2[1], "ERROR: unknown tool \"save_page\"");
}

#[tokio::test]
async fn a_failed_keep_is_an_error_and_nothing_counts() {
	let Some(pdf) = shared_pdf() else { return };
	let script = Scripted::new();
	let shown: Shown = Arc::default();
	reply_showing(&script, calls(&[("pdf_render", json!({ "pages": "2" }))]), &shown);
	reply_showing(&script, calls(&[("save_page", json!({ "page": 2, "markdown": "Two." })), ("pdf_extract", json!({ "pages": "2" }))]), &shown);
	reply_showing(&script, says("Two (p. 2)."), &shown);
	let failing = Keeper { pages: BTreeMap::new(), keep: Box::new(|_, _| Err("the file changed".to_owned())) };
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(no_demo()));
	run_pdf_reader_agent(&lines_pdf(), "", &pdf, Some(failing), &opts).await;
	let texts = &shown.lock()[2].2;
	assert_eq!(texts[1], "ERROR: the file changed");
	assert!(!texts[2].contains("Two."), "{}", texts[2]);
}

#[test]
fn a_backslash_json_broke_is_refused() {
	let broken = [
		("\\theta as a tab", "$\theta$"),
		("\\frac as a form feed", "$\u{c}rac{a}{b}$"),
		("\\beta as a backspace", "$\u{8}eta$"),
		("\\vec as a vertical tab", "$\u{b}ec{v}$"),
		("\\rho as a carriage return", "$\rho$"),
		("\\neq in inline math", "So $a \neq b$ here."),
		("\\nu alone in inline math", "Take $\nu$."),
		("\\notin in inline math", "$x \notin A$"),
		("\\nabla opening display math", "$$\nabla f = 0$$"),
		("\\neq on a later display line", "$$\n\\sum_i x_i \neq 0\n$$"),
		("\\nu in a subscript", "$$\nx_{\nu} = 1\n$$"),
		("\\ne after a space", "$$\na \ne b\n$$"),
		("\\nexists", "$$\nexists x$$"),
	];
	for (what, markdown) in broken {
		assert_eq!(page_text_refusal(markdown).as_deref(), Some(CONTROL_REFUSAL), "{what}");
	}
}

#[test]
fn clean_math_on_many_lines_is_kept() {
	let clean = [
		"$$\nu = e^x \\\\\ne^{i\\pi} + 1 = 0\n$$",
		"$$\n\\begin{aligned}\nx &= 1 \\\\\nexp(x) &= e\n\\end{aligned}\n$$",
		"It costs $5 and\n$10, and $a \\neq b$ holds.",
		"Euler wrote\n$e^{i\\pi} = -1$, e.g.\neq-signs are rare.",
		"$$\n\\nabla f = 0\n$$",
	];
	for markdown in clean {
		assert_eq!(page_text_refusal(markdown), None, "{markdown}");
	}
}

#[tokio::test]
async fn a_page_is_saved_only_after_its_picture_is_shown() {
	let Some(pdf) = shared_pdf() else { return };
	let script = Scripted::new();
	let shown: Shown = Arc::default();
	reply_showing(&script, calls(&[("pdf_render", json!({ "pages": "2" })), ("save_page", json!({ "page": 2, "markdown": "Two." }))]), &shown);
	reply_showing(&script, calls(&[("save_page", json!({ "page": 2, "markdown": "Two." }))]), &shown);
	reply_showing(&script, says("Two (p. 2)."), &shown);
	let saved = Arc::default();
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(no_demo()));
	run_pdf_reader_agent(&lines_pdf(), "", &pdf, Some(keeper(&saved)), &opts).await;
	let shown = shown.lock();
	assert_eq!(shown[1].2[1], "ERROR: page 2 was rendered in this same reply, so you have not seen it yet. Look at its picture first, then save it in a later reply.");
	assert_eq!(shown[2].2.last().unwrap(), "Saved page 2. Later readings and search get this text for it.");
	assert_eq!(*saved.lock(), [(2, "Two.".to_owned())]);
}

/// A one-page PDF holding `lines` in Helvetica.
fn text_pdf(lines: &[String]) -> Vec<u8> {
	let shown: String = lines.iter().map(|line| format!("({line}) Tj 0 -14 Td ")).collect();
	let stream = format!("BT /F1 11 Tf 72 740 Td {shown}ET");
	let objects = [
		"<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_owned(),
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>".to_owned(),
		format!("<< /Length {} >>\nstream\n{stream}\nendstream", stream.len()),
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
	];
	let mut pdf = String::from("%PDF-1.4\n");
	let mut offsets = Vec::new();
	for (i, body) in objects.iter().enumerate() {
		offsets.push(pdf.len());
		pdf += &format!("{} 0 obj\n{body}\nendobj\n", i + 1);
	}
	let xref = pdf.len();
	pdf += &format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1);
	for offset in offsets {
		pdf += &format!("{offset:010} 00000 n \n");
	}
	pdf += &format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1);
	pdf.into_bytes()
}

#[tokio::test]
async fn a_save_much_shorter_than_its_page_is_refused() {
	let Some(pdf) = shared_pdf() else { return };
	let scratch = Scratch::new("whole");
	let path = scratch.path("long.pdf");
	let lines: Vec<String> = (1..=12).map(|n| format!("Line {n} of this page says something plain about sets.")).collect();
	gs_base::fsx::write_atomic(Path::new(&path), &text_pdf(&lines), None).unwrap();
	let script = Scripted::new();
	let shown: Shown = Arc::default();
	let half = lines[..6].join("\n");
	reply_showing(&script, calls(&[("pdf_render", json!({ "pages": "1" }))]), &shown);
	reply_showing(&script, calls(&[("save_page", json!({ "page": 1, "markdown": "Only the formula: $A \\cup B$." })), ("save_page", json!({ "page": 1, "markdown": half }))]), &shown);
	reply_showing(&script, says("Sets (p. 1)."), &shown);
	let saved = Arc::default();
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(no_demo()));
	run_pdf_reader_agent(&path, "", &pdf, Some(keeper(&saved)), &opts).await;
	let shown = shown.lock();
	let texts = &shown[2].2[1..];
	assert_eq!(texts[0], "ERROR: markdown is 29 characters, but the page's own text is 638. Save the whole page, every sentence and formula on it.");
	assert_eq!(texts[1], "Saved page 1. Later readings and search get this text for it.");
	assert_eq!(saved.lock().len(), 1);
}

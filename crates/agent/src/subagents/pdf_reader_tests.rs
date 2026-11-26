use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_json::{Json, json};
use gs_pdf::test_support::shared_pdf;
use gs_runtime::Usage;
use gs_runtime::fake::{FakeAgent, FakeStep};
use parking_lot::Mutex;

use super::*;
use crate::subagents::test_support::{FakeHeadless, job_agent_options, result_texts, results, says, tool};

/// One model call's tokens: each scripted step starts with one.
fn call() -> FakeStep {
	FakeStep::Usage(Usage { input: 500, cached: 400, output: 30 })
}

/// Several calls the agent makes in one step.
fn calls(list: &[(&str, Json)]) -> FakeStep {
	FakeStep::Calls(list.iter().map(|(name, args)| ((*name).to_owned(), args.clone())).collect())
}

/// What godspeed sent the agent each turn, as text.
fn sends(agent: &FakeAgent) -> Vec<String> {
	agent.sent().iter().filter(|m| m["type"].as_str() == Some("send")).map(|m| m["content"][0]["text"].str_or_empty().to_owned()).collect()
}

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
	let (opts, agent, _) = job_agent_options(Vec::new(), FakeHeadless::new(no_demo()));
	let pdf = Pdf::new(Path::new("/nonexistent"));
	let folder = run_pdf_reader_agent(&scratch.path("folder.pdf"), "Anything?", &pdf, None, &opts).await;
	assert_eq!(folder, json!({ "path": scratch.path("folder.pdf"), "question": "Anything?", "brief": "PDF failed: not a regular file", "pagesRead": [], "pagesConsulted": [] }));
	assert_eq!(run_pdf_reader_agent(&scratch.path("empty.pdf"), "", &pdf, None, &opts).await["brief"], Json::from("PDF failed: file is empty"));
	let missing = scratch.path("missing.pdf");
	assert_eq!(run_pdf_reader_agent(&missing, "", &pdf, None, &opts).await["brief"], Json::from(format!("PDF failed: ENOENT: no such file or directory, stat '{missing}'")));
	assert!(agent.sent().is_empty(), "no session opened");

	let Some(pdf) = shared_pdf() else { return };
	gs_base::fsx::write_text_atomic(Path::new(&scratch.path("garbage.pdf")), "This is not a PDF at all.\n").unwrap();
	assert_eq!(run_pdf_reader_agent(&scratch.path("garbage.pdf"), "", &pdf, None, &opts).await["brief"], Json::from("PDF failed: Invalid PDF structure."));
}

#[tokio::test]
async fn a_protected_place_fails_before_any_model_call() {
	let scratch = Scratch::new("protected");
	let (opts, _, _) = job_agent_options(Vec::new(), FakeHeadless::new(no_demo()));
	let pdf = Pdf::new(Path::new("/nonexistent"));
	let env_file = scratch.path(".env.pdf");
	assert_eq!(run_pdf_reader_agent(&env_file, "", &pdf, None, &opts).await["brief"], Json::from(format!("PDF failed: Access denied: {env_file} is a protected location.")));
	assert_eq!(run_pdf_reader_agent("~/.ssh/key.pdf", "", &pdf, None, &opts).await["brief"], Json::from("PDF failed: Access denied: ~/.ssh/key.pdf is a protected location."));
}

#[tokio::test]
async fn the_gate_sends_an_unread_finish_back_once_and_pictures_come_with_the_render() {
	let Some(pdf) = shared_pdf() else { return };
	let first = vec![call(), tool("pdf_info", json!({})), call(), says("Nothing to see.")];
	let second = vec![call(), calls(&[("pdf_extract", json!({ "pages": "1" })), ("pdf_render", json!({ "pages": "2-3", "dpi": 72 })), ("pdf_render", json!({ "pages": "x" }))]), call(), says(" It lists lines (p. 1). ")];
	let (opts, agent, lines) = job_agent_options(vec![first, second], FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "What is on it?", &pdf, None, &opts).await;
	assert_eq!(result["brief"], Json::from("It lists lines (p. 1)."));
	assert_eq!(result["pagesRead"], json!([1, 2, 3]));
	assert_eq!(result["pagesConsulted"], json!([1, 2, 3]));
	assert_eq!(sends(&agent)[1], UNREAD_FINISH_MESSAGE, "one more turn for an unread finish");
	let texts = result_texts(&agent);
	assert!(texts[0].starts_with(&format!("File: {}\nPages: ", lines_pdf())));
	assert!(texts[1].starts_with("--- Page 1 ---\n"));
	assert_eq!(texts[2], "Rendered 2 page(s) at 72 DPI — the images follow below. Read them carefully (equations, diagrams, layout).");
	assert_eq!(texts[3], "ERROR: no pages rendered (spec matched nothing?)");
	let render = &results(&agent)[2];
	assert_eq!(render["content"].items().iter().map(|part| part["type"].str_or_empty()).collect::<Vec<_>>(), ["text", "image", "image"], "the pictures come in the render's own result");
	assert_eq!(render["content"][1]["mimeType"].as_str(), Some("image/png"));
	assert_eq!(results(&agent)[3]["isError"], Json::Bool(true));
	assert_eq!(lines.lock()[..3], ["pdf_info: triaging", "pdf_extract: 1", "pdf_render: 2-3 @72dpi"]);
}

#[tokio::test]
async fn searches_consult_without_reading() {
	let Some(pdf) = shared_pdf() else { return };
	let searches = calls(&[("pdf_search", json!({ "query": "zzzzz" })), ("pdf_search", json!({ "query": "(" })), ("pdf_nope", json!({})), ("pdf_search", json!({ "query": 1, "context_lines": 0 }))]);
	let (opts, agent, lines) = job_agent_options(vec![vec![call(), searches, call(), says("Found it.")]], FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "", &pdf, None, &opts).await;
	let texts = result_texts(&agent);
	assert_eq!(texts[0], "No hits.");
	assert!(texts[1].starts_with("ERROR: Invalid regex: Invalid regular expression: /(/i: "), "{}", texts[1]);
	assert_eq!(texts[2], "Tool pdf_nope not found");
	assert!(texts[3].starts_with("=== Page 1, line "), "{}", texts[3]);
	assert_eq!(result["brief"], Json::from("Found it."));
	assert_eq!(result["pagesRead"], json!([]));
	assert!(!result["pagesConsulted"].as_arr().unwrap().is_empty());
	assert_eq!(lines.lock()[0], "pdf_search: \"zzzzz\"");
	assert_eq!(lines.lock()[2], "pdf_search: \"1\"");
}

#[tokio::test]
async fn the_model_call_cap_and_crashes_fail() {
	let Some(pdf) = shared_pdf() else { return };
	let busy: Vec<FakeStep> = (0..=MAX_ITERATIONS).flat_map(|_| [call(), tool("pdf_info", json!({}))]).collect();
	let (opts, _, _) = job_agent_options(vec![busy], FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "", &pdf, None, &opts).await;
	assert_eq!(result["brief"], Json::from("PDF failed: iteration limit (14) reached without a brief."));

	let (opts, _, _) = job_agent_options(vec![vec![call(), tool("pdf_extract", json!({ "pages": "1" })), FakeStep::Fail("overloaded".to_owned())]], FakeHeadless::new(no_demo()));
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
fn keeper(saved: &Arc<Mutex<Vec<(u32, String)>>>) -> Keeper {
	let saved = saved.clone();
	Keeper {
		file_id: "f_1a2b3c4d5e6f".to_owned(),
		pages: BTreeMap::from([(1, "Kept one: $x^2$".to_owned())]),
		keep: Box::new(move |page, markdown| {
			saved.lock().push((page, markdown.to_owned()));
			Ok(())
		}),
	}
}

#[tokio::test]
async fn a_rendered_page_is_kept_and_served_from_then_on() {
	let Some(pdf) = shared_pdf() else { return };
	let turn = vec![
		call(),
		calls(&[("pdf_info", json!({})), ("pdf_extract", json!({ "pages": "1-2" }))]),
		call(),
		tool("pdf_render", json!({ "pages": "2" })),
		call(),
		tool("save_page", json!({ "page": 2, "markdown": "  $$\\frac{a}{b}$$\nTwo, kept.  " })),
		call(),
		calls(&[("pdf_extract", json!({ "pages": "2" })), ("pdf_info", json!({}))]),
		call(),
		says("Two (p. 2)."),
	];
	let saved = Arc::default();
	let (opts, agent, lines) = job_agent_options(vec![turn], FakeHeadless::new(no_demo()));
	let result = run_pdf_reader_agent(&lines_pdf(), "", &pdf, Some(keeper(&saved)), &opts).await;
	assert_eq!(result["brief"], Json::from("Two [[f_1a2b3c4d5e6f/p. 2/lines.pdf]]."), "a space file's pages are cited as their marks");
	let open = &agent.sent()[0];
	assert!(open["systemPrompt"].str_or_empty().ends_with(KEEP_INSTRUCTIONS));
	let tools: Vec<&str> = open["tools"].items().iter().filter_map(|t| t["name"].as_str()).collect();
	assert_eq!(tools, ["pdf_info", "pdf_extract", "pdf_render", "pdf_search", "save_page"]);
	let texts = result_texts(&agent);
	let info: Vec<&str> = texts[0].lines().filter(|l| l.starts_with("p1:") || l.starts_with("p2:")).collect();
	assert!(info[0].ends_with(" kept") && !info[1].ends_with(" kept"), "{info:?}");
	assert!(texts[1].starts_with("--- Page 1 ---\nKept one: $x^2$\n--- Page 2 ---\n"), "{}", texts[1]);
	assert_eq!(texts[3], "Saved page 2. Later readings and search get this text for it.");
	assert_eq!(*saved.lock(), [(2, "$$\\frac{a}{b}$$\nTwo, kept.".to_owned())]);
	assert_eq!(texts[4], "--- Page 2 ---\n$$\\frac{a}{b}$$\nTwo, kept.");
	assert!(texts[5].lines().any(|l| l.starts_with("p2:") && l.ends_with(" kept")));
	assert!(lines.lock().contains(&"save_page: 2".to_owned()));
}

#[tokio::test]
async fn save_page_refuses_what_it_cannot_keep() {
	let Some(pdf) = shared_pdf() else { return };
	let count = pdf.pdf_shape(Path::new(&lines_pdf())).await.unwrap().page_count;
	let save = |page: Json, markdown: &str| ("save_page", json!({ "page": page, "markdown": markdown }));
	let turn = vec![
		call(),
		tool("pdf_render", json!({ "pages": "1-3" })),
		call(),
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
		call(),
		tool("save_page", json!({ "page": 3, "markdown": "Four." })),
		call(),
		says("Done (p. 1)."),
	];
	let saved = Arc::default();
	let (opts, agent, _) = job_agent_options(vec![turn], FakeHeadless::new(no_demo()));
	run_pdf_reader_agent(&lines_pdf(), "", &pdf, Some(keeper(&saved)), &opts).await;
	let texts = &result_texts(&agent)[1..];
	assert_eq!(texts[0], format!("ERROR: page must be a whole number from 1 to {count}."));
	for text in &texts[1..3] {
		assert!(text.starts_with("Validation failed for tool \"save_page\""), "the schema refuses page 0 and 1.5: {text}");
	}
	assert_eq!(texts[3], "ERROR: markdown is empty.");
	assert_eq!(texts[4], "ERROR: markdown is 6001 characters long; the most is 6000.");
	for text in &texts[5..9] {
		assert_eq!(text, &format!("ERROR: {CONTROL_REFUSAL}"));
	}
	assert!(CONTROL_REFUSAL.contains(r"(\\frac)"));
	assert_eq!(texts[9..11], ["ERROR: markdown may not hold a line like \"--- Page 3 ---\".", "ERROR: markdown may not hold a line like \"--- Page 3 ---\"."]);
	assert_eq!(texts[11], "ERROR: page 5 was not rendered in this job. Render it with pdf_render and read it first.");
	assert!(texts[12..15].iter().all(|t| t.starts_with("Saved page ")), "{texts:?}");
	assert_eq!(texts[15], "ERROR: this job already saved 3 pages, the most one job may save.");
	assert_eq!(saved.lock().iter().map(|(page, _)| *page).collect::<Vec<_>>(), [1, 2, 3]);
}

#[tokio::test]
async fn save_page_is_offered_only_with_a_keeper() {
	let Some(pdf) = shared_pdf() else { return };
	let turn = vec![call(), tool("pdf_render", json!({ "pages": "1" })), call(), tool("save_page", json!({ "page": 1, "markdown": "One." })), call(), says("One (p. 1).")];
	let (opts, agent, _) = job_agent_options(vec![turn], FakeHeadless::new(no_demo()));
	run_pdf_reader_agent(&lines_pdf(), "", &pdf, None, &opts).await;
	let open = &agent.sent()[0];
	assert_eq!(open["systemPrompt"].as_str(), Some(INSTRUCTIONS));
	assert!(!open["tools"].items().iter().any(|t| t["name"].as_str() == Some("save_page")));
	assert_eq!(result_texts(&agent)[1], "Tool save_page not found");
}

#[tokio::test]
async fn a_failed_keep_is_an_error_and_nothing_counts() {
	let Some(pdf) = shared_pdf() else { return };
	let turn = vec![call(), tool("pdf_render", json!({ "pages": "2" })), call(), calls(&[("save_page", json!({ "page": 2, "markdown": "Two." })), ("pdf_extract", json!({ "pages": "2" }))]), call(), says("Two (p. 2).")];
	let failing = Keeper { file_id: "f_1a2b3c4d5e6f".to_owned(), pages: BTreeMap::new(), keep: Box::new(|_, _| Err("the file changed".to_owned())) };
	let (opts, agent, _) = job_agent_options(vec![turn], FakeHeadless::new(no_demo()));
	run_pdf_reader_agent(&lines_pdf(), "", &pdf, Some(failing), &opts).await;
	let texts = result_texts(&agent);
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
	let turn = vec![
		call(),
		calls(&[("pdf_render", json!({ "pages": "2" })), ("save_page", json!({ "page": 2, "markdown": "Two." }))]),
		call(),
		tool("save_page", json!({ "page": 2, "markdown": "Two." })),
		call(),
		says("Two (p. 2)."),
	];
	let saved = Arc::default();
	let (opts, agent, _) = job_agent_options(vec![turn], FakeHeadless::new(no_demo()));
	run_pdf_reader_agent(&lines_pdf(), "", &pdf, Some(keeper(&saved)), &opts).await;
	let texts = result_texts(&agent);
	assert_eq!(texts[1], "ERROR: page 2 was rendered in this same reply, so you have not seen it yet. Look at its picture first, then save it in a later reply.");
	assert_eq!(texts[2], "Saved page 2. Later readings and search get this text for it.");
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
	let half = lines[..6].join("\n");
	let turn = vec![
		call(),
		tool("pdf_render", json!({ "pages": "1" })),
		call(),
		calls(&[("save_page", json!({ "page": 1, "markdown": "Only the formula: $A \\cup B$." })), ("save_page", json!({ "page": 1, "markdown": half }))]),
		call(),
		says("Sets (p. 1)."),
	];
	let saved = Arc::default();
	let (opts, agent, _) = job_agent_options(vec![turn], FakeHeadless::new(no_demo()));
	run_pdf_reader_agent(&path, "", &pdf, Some(keeper(&saved)), &opts).await;
	let texts = &result_texts(&agent)[1..];
	assert_eq!(texts[0], "ERROR: markdown is 29 characters, but the page's own text is 638. Save the whole page, every sentence and formula on it.");
	assert_eq!(texts[1], "Saved page 1. Later readings and search get this text for it.");
	assert_eq!(saved.lock().len(), 1);
}

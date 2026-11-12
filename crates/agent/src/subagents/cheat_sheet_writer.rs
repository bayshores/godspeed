//! One message of a cheat sheet's
//! chat as one short request on the single-submit seam, so the connected agent gets it as one
//! labelled work item. The agent may look things up in the space's files, makes or changes the
//! PDF with its own tools in the sheet's working folder, and answers with one sheet_reply call:
//! its words, and the new PDF's path and any rules the learner set when there are some.
//!
//! Only the model talks here; what the app sends and keeps, and how a PDF is checked and taken,
//! is the cheat-sheets service.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_core::records::teaching_areas::RULE_MAX_CHARS;
use gs_core::study::cheat_sheet::MAX_PAGES;
use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux::Engine;
use gs_engine::turn::tool::Tool;
use gs_json::{Json, Obj, json};
use parking_lot::Mutex;

use super::pi_run::RunError;
use crate::extraction::submit_agent::{SubmitAgentOptions, run_submit_agent};

const CHEAT_SHEET_INSTRUCTIONS: &str = r#"You help a learner with their cheat sheet: the notes they may bring into one exam, a real PDF you make in a working folder. Each request is one message from the learner about it, with the exam, its topics, their mistakes, the sheet's rules and the chat so far. Reply with one sheet_reply call.

- A question ("what does pool mean?"): answer it in plain words in text and leave the sheet alone. If the sheet's wording caused the confusion, also fix the sheet.
- A change, or something on the sheet that is wrong or would confuse a beginner: edit the source in the working folder, compile it, check it (below) and send the PDF as pdf_path, with a short note in text of what changed.
- When the learner says something that should hold for every later change ("A4, both sides", "no slang"), put it in new_rules, one short line each. Follow every one of the sheet's rules.
- Write for a beginner who barely studied: plain words, no slang, no notation the space doesn't use. Methods that work for any problem of a kind, never one practice problem's details. A mistake becomes the rule it broke. Where one part depends on another, say where to look ("see card 4").
- Where the sheet's rules don't settle the space's rules for this exam (paper size, sides, what's allowed), find them with search_space_files and read_passage. Never break them.
- Keep the source in the working folder (LaTeX works well: sheet.tex with latexmk, tectonic or pdflatex). A change edits it; don't start over. One PDF page per side. Black on white unless asked. No em-dashes.
- Before sending a PDF, check it: count the pages and check their size (pdfinfo); render each page to an image (pdftoppm -r 60 -png) and look at every one; nothing runs off a page, overlaps or is too small to read; every formula and method agrees with the space's material. Fix what you find first."#;

fn reply_schema() -> Json {
	json!({
		"type": "object",
		"required": ["text"],
		"properties": {
			"text": { "type": "string", "minLength": 1, "description": "Your answer to the learner, in markdown with $LaTeX$ math. When you changed the sheet, say what changed in a line or two." },
			"pdf_path": { "type": "string", "minLength": 1, "description": format!("Only when you made or changed the sheet: the new PDF, inside the working folder (absolute, or relative to it). 1 to {MAX_PAGES} pages.") },
			"new_rules": {
				"type": "array",
				"items": { "type": "string", "minLength": 1, "maxLength": RULE_MAX_CHARS },
				"description": "Requirements the learner just set that should hold for every later change of this sheet, one short line each.",
			},
		},
	})
}

/// A PDF godspeed checked and read.
#[derive(Debug, Clone, PartialEq)]
pub struct TakenPdf {
	pub bytes: Vec<u8>,
	/// The sheet's pages (core `SheetPage` records).
	pub pages: Vec<Json>,
	/// Its real path, in the working folder.
	pub file: String,
}

/// Checks and reads the PDF at a path: it, or why it cannot be used.
pub type TakePdf = Box<dyn Fn(String) -> BoxFuture<'static, Result<TakenPdf, String>> + Send + Sync>;

pub struct SheetRequest {
	/// "CSE 21 Midterm": the work item's label.
	pub title: String,
	/// The request (core `cheat_sheet_request_text`), with the learner's pictures.
	pub prompt: Json,
	pub lookups: Vec<Arc<dyn Tool>>,
	pub take_pdf: TakePdf,
	pub engine: Engine,
	pub signal: Abort,
}

/// The agent's answer to one message.
#[derive(Debug, Clone, PartialEq)]
pub struct SheetReply {
	pub text: String,
	pub pdf: Option<TakenPdf>,
	pub rules: Vec<String>,
}

/// Answers one message about the sheet; fails when the agent never sends a usable reply.
pub async fn reply_on_sheet(bridge: &Bridge, input: SheetRequest) -> Result<SheetReply, RunError> {
	let pdf: Arc<Mutex<Option<TakenPdf>>> = Arc::default();
	let mut opts = SubmitAgentOptions::new(
		"sheet_reply",
		"Answer the learner: your words, and the new PDF's path when you made or changed the sheet.",
		reply_schema(),
		CHEAT_SHEET_INSTRUCTIONS.to_owned(),
		input.prompt,
		"the agent never answered",
	);
	opts.fill = Some(Box::new(|raw: Json| {
		let mut out = Obj::new();
		out.insert("text", raw["text"].clone());
		if raw["pdf_path"].truthy() {
			out.insert("path", raw["pdf_path"].clone());
		}
		out.insert("rules", if raw["new_rules"].is_null() { json!([]) } else { raw["new_rules"].clone() });
		Json::Obj(out)
	}));
	// The PDF is read here, once, so what was checked is what is kept.
	opts.validate = Some(Box::new({
		let (pdf, take_pdf) = (pdf.clone(), input.take_pdf);
		move |value: &Json| {
			let taking = value["path"].as_str().map(|path| take_pdf(path.to_owned()));
			let pdf = pdf.clone();
			Box::pin(async move {
				*pdf.lock() = None;
				match taking?.await {
					Ok(taken) => {
						*pdf.lock() = Some(taken);
						None
					}
					Err(problem) => Some(problem),
				}
			})
		}
	}));
	opts.lookups = input.lookups;
	opts.max_turns = Some(10);
	opts.task_label = Some(format!("Cheat sheet: {}", input.title));
	opts.engine = Some(input.engine);
	opts.abort = Some(input.signal);
	let reply = run_submit_agent(bridge, opts).await?;
	let rules = reply["rules"].as_arr().into_iter().flatten().filter_map(|r| r.as_str().map(str::to_owned)).collect();
	let pdf = pdf.lock().take();
	Ok(SheetReply { text: reply["text"].as_str().unwrap_or_default().to_owned(), pdf, rules })
}

#[cfg(test)]
mod tests {
	use gs_engine::turn::faux::Scripted;

	use super::*;
	use crate::subagents::test_support::{bridge, calls, faux_engine, reply_seeing, result_texts};

	fn request(script: &Arc<Scripted>) -> SheetRequest {
		SheetRequest {
			title: "Space Midterm".to_owned(),
			prompt: Json::from("Make it A4."),
			lookups: Vec::new(),
			take_pdf: Box::new(|path: String| {
				Box::pin(async move { if path == "bad.pdf" { Err("The PDF has 9 pages; a cheat sheet has 1 to 4.".to_owned()) } else { Ok(TakenPdf { bytes: b"%PDF".to_vec(), pages: vec![json!({ "w": 1, "h": 1 })], file: format!("/work/{path}") }) } })
			}),
			engine: faux_engine(script),
			signal: Abort::new(),
		}
	}

	#[tokio::test]
	async fn a_refused_pdf_goes_back_and_the_retry_is_kept() {
		let script = Scripted::new();
		let seen = Arc::new(Mutex::new(Vec::new()));
		script.reply(calls(&[("sheet_reply", json!({ "text": "Done.", "pdf_path": "bad.pdf" }))]));
		reply_seeing(&script, calls(&[("sheet_reply", json!({ "text": "Fixed.", "pdf_path": "sheet.pdf", "new_rules": ["A4, both sides"] }))]), &seen);
		let reply = reply_on_sheet(&bridge(), request(&script)).await.unwrap();
		assert_eq!(reply.text, "Fixed.");
		assert_eq!(reply.rules, vec!["A4, both sides"]);
		assert_eq!(reply.pdf.unwrap().file, "/work/sheet.pdf");
		assert!(result_texts(&seen.lock()[0])[0].contains("The PDF has 9 pages; a cheat sheet has 1 to 4."));
	}

	#[tokio::test]
	async fn an_answer_without_a_pdf_and_no_answer_at_all() {
		let script = Scripted::new();
		script.reply(calls(&[("sheet_reply", json!({ "text": "Pool means max." }))]));
		let reply = reply_on_sheet(&bridge(), request(&script)).await.unwrap();
		assert_eq!(reply, SheetReply { text: "Pool means max.".to_owned(), pdf: None, rules: Vec::new() });

		let script = Scripted::new();
		script.reply(gs_engine::turn::messages::faux_assistant_message(vec![gs_engine::turn::messages::text_block("hi")], "stop"));
		assert_eq!(reply_on_sheet(&bridge(), request(&script)).await, Err(RunError::Failed("the agent never answered".to_owned())));
	}

	#[test]
	fn the_reply_schema_is_typebox_shaped() {
		let schema = gs_json::stringify(&reply_schema());
		assert!(schema.starts_with(r#"{"type":"object","required":["text"],"properties":{"text":{"type":"string","minLength":1,"description":"#));
		assert!(schema.contains(r#""new_rules":{"type":"array","items":{"type":"string","minLength":1,"maxLength":200},"description":"#));
		assert!(schema.contains("1 to 4 pages."));
	}
}

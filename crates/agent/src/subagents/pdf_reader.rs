//! Ported from src/backend/agent/subagents/pdf-reader.ts: the pdf job's agent. It reads a PDF on
//! the teacher's behalf. The loop is hand-rolled like the visual maker's, because rendered pages
//! are shown to this agent's eyes, never delivered onward.
//!
//! The prompt is the pdf-reader reading doctrine: triage with pdf_info first, then by size: short
//! PDFs read every page, medium ones render the flagged pages, long ones search before reading
//! anything at length. The final text is the brief, with (p. N) citations.

use std::collections::BTreeSet;
use std::path::Path;

use gs_base::fsx::node_error_message;
use gs_base::ids;
use gs_base::num::to_fixed;
use gs_base::re::Re;
use gs_base::text::{len16, slice16, trim, trim_start};
use gs_engine::turn::messages::tool_calls;
use gs_json::{Json, js_number, json};
use gs_pdf::Pdf;

use super::pi_run::{HelperOptions, RunError};
use super::stream_once::{message_text, png_message, stream_once, tool_text, user_text};
use crate::fs_tools::fs_shared::resolve_source_path;

const INSTRUCTIONS: &str = r#"You are a PDF reading specialist. You work for a teacher agent inside a learning
application: given a PDF path and a question, read the document on the teacher's behalf and
produce a focused brief that the teacher can teach from, with page citations.

You operate in an isolated context. The task gives you the PDF path and the question — that is
everything you know.

Reading doctrine — always in this order:
1. TRIAGE FIRST: call pdf_info. It returns page count plus per-page signals (text_length,
   image_count, math_density). Never read or render anything before this.
2. Pick a strategy by document size:
   - SHORT (≤ 10 pages): extract the full text; render every page that has meaningful
     math_density or images (you read equations and diagrams visually, not as extracted text).
   - MEDIUM (11-40 pages): extract promising pages; render only flagged pages (math- or
     image-heavy, or where extraction looks thin).
   - LONG (> 40 pages): pdf_search for the question's key terms first; extract and render only
     the pages that hit. Never read a long document front-to-back.
3. When the extracted text of a page looks math- or diagram-heavy, or garbled, RENDER that
   page and read it visually before drawing conclusions from it.
4. Render DPI guidance: 100 for text-dominant pages, 150 the default, 200 for dense small
   print (math details, fine diagrams).

Tool outputs may be error strings (file unreadable, invalid regex, no hits). Adapt: narrow the
page spec, change the query, lower DPI. If the document genuinely cannot answer the question,
say so in the brief instead of inventing content.

Your FINAL assistant message is your entire deliverable — it must stand alone, in this format:
2-6 sentences (or short sections) answering the teacher's question from the document, each
claim cited as (p. N). End with a line "Pages consulted: N, N, …" listing every page you
extracted or rendered."#;

const MAX_ITERATIONS: usize = 14;
/// Pages per pdf_render call: one over-eager call must not flood the vision context.
const RENDER_BATCH_CAP: usize = 6;
/// The extract output ceiling: narrow the spec instead of dumping a book.
const EXTRACT_CAP: usize = 24_000;
/// Search hits shown per call.
const HIT_CAP: usize = 40;

/// Never deliver a brief that consulted nothing: an unread PDF's brief is made-up content.
const UNREAD_FINISH_MESSAGE: &str = "You finished without consulting any page of the PDF — your brief would be invention, not reading. Extract or render the relevant pages first, then write the brief from what you actually saw.";

/// The wire declarations: this loop runs the tools itself, so they carry no execute.
fn pdf_tools() -> Vec<Json> {
	vec![
		json!({
			"name": "pdf_info",
			"description": "Metadata + per-page triage signals for the PDF (page count, text length, image count, math density). ALWAYS call this first.",
			"parameters": { "type": "object", "properties": {} },
		}),
		json!({
			"name": "pdf_extract",
			"description": "Extract text from pages (spec: 'all', '1-5', '1,3,7', '3'). Use pdf_info first; narrow the spec for big documents.",
			"parameters": { "type": "object", "required": ["pages"], "properties": { "pages": { "type": "string", "description": "Page spec, e.g. 'all', '1-5', '1,3,7'" } } },
		}),
		json!({
			"name": "pdf_render",
			"description": "Render pages to images and show them to you for visual reading (equations, diagrams, layout). DPI: 100 text, 150 default, 200 dense small print. Max 6 pages per call.",
			"parameters": {
				"type": "object",
				"required": ["pages"],
				"properties": {
					"pages": { "type": "string", "description": "Page spec, e.g. '1-3' or '2,5,8'" },
					"dpi": { "type": "integer", "minimum": 72, "maximum": 300, "description": "Render DPI (100 text / 150 default / 200 dense)" },
				},
			},
		}),
		json!({
			"name": "pdf_search",
			"description": "Search the PDF's text by keyword or regex (case-insensitive); returns hits with context lines. Use for long documents before reading anything at length.",
			"parameters": {
				"type": "object",
				"required": ["query"],
				"properties": {
					"query": { "type": "string", "description": "Keyword or regex" },
					"context_lines": { "type": "integer", "minimum": 0, "maximum": 8, "description": "Context lines around each hit (default 3)" },
					"literal": { "type": "boolean", "description": "true = treat the query literally (no regex; default false)" },
				},
			},
		}),
	]
}

/// Reads the PDF at `path` (resolved like the file tools: `~` and relative mean home) for
/// `question`. Never fails: a failure is a brief starting "PDF failed:".
pub async fn run_pdf_reader_agent(path: &str, question: &str, pdf: &Pdf, opts: &HelperOptions) -> Json {
	let pdf_path = resolve_source_path(Some(path));
	let shown = pdf_path.to_string_lossy().into_owned();
	let mut reader = Reader { pdf, path: &pdf_path, messages: Vec::new(), consulted: BTreeSet::new(), read: BTreeSet::new() };
	// A source that cannot open fails before any model call.
	if let Err(reason) = probe_readable(pdf, &pdf_path).await {
		return reader.result(&shown, question, &format!("PDF failed: {reason}"));
	}
	let engine = opts.engine();
	let abort = opts.abort();
	let session_id = ids::uuid();
	let name = pdf_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
	opts.bridge.label_conversation(&session_id, &format!("PDF reading: {name}"));
	let asked = if question.is_empty() { "(no question — give a structural overview)" } else { question };
	let prompt = [&format!("PDF path: {shown}"), &format!("Question (what the teacher needs from this document): {asked}"), "", "Read the document per your doctrine, then produce your final brief in the required format."].join("\n");
	reader.messages.push(user_text(&prompt));

	let outcome = reader.run(&engine, &session_id, &abort, opts).await;
	opts.bridge.forget_conversation(&session_id);
	let brief = match outcome {
		Ok(Some(brief)) => brief,
		Err(e) => format!("PDF failed: the reader crashed: {e}"),
		// Iteration limit: any finish text here is the unconsulted brief the gate bounced.
		Ok(None) => format!("PDF failed: iteration limit ({MAX_ITERATIONS}) reached without a brief."),
	};
	reader.result(&shown, question, &brief)
}

struct Reader<'a> {
	pdf: &'a Pdf,
	path: &'a Path,
	messages: Vec<Json>,
	/// Every page the reader extracted, rendered or found in a search (the citation set).
	consulted: BTreeSet<i64>,
	/// Pages whose extract or render reached the loop; a search hit consults but does not read.
	read: BTreeSet<i64>,
}

impl Reader<'_> {
	fn result(&self, path: &str, question: &str, brief: &str) -> Json {
		json!({ "path": path, "question": question, "brief": brief, "pagesRead": self.read.iter().copied().collect::<Vec<_>>(), "pagesConsulted": self.consulted.iter().copied().collect::<Vec<_>>() })
	}

	/// The loop: the brief, or None at the iteration limit.
	async fn run(&mut self, engine: &gs_engine::turn::faux::Engine, session_id: &str, abort: &gs_engine::turn::abort::Abort, opts: &HelperOptions) -> Result<Option<String>, RunError> {
		let tools = pdf_tools();
		let mut nudged = false;
		for _ in 0..MAX_ITERATIONS {
			let result = stream_once(engine, INSTRUCTIONS, &self.messages, &tools, session_id, abort, &mut |u| opts.usage(u)).await?;
			self.messages.push(result.clone());
			let calls = tool_calls(&result);
			if calls.is_empty() {
				let final_text = trim(&message_text(&result)).to_owned();
				// The gate counts consulted pages, not read ones: a search-only brief is honest.
				if self.consulted.is_empty() && !nudged {
					nudged = true;
					self.messages.push(user_text(UNREAD_FINISH_MESSAGE));
					continue;
				}
				return Ok(Some(if final_text.is_empty() { "(no brief text)".to_owned() } else { final_text }));
			}
			let mut results = Vec::new();
			// Rendered pages of this batch, shown after the tool results.
			let mut rendered: Vec<(i64, Vec<u8>)> = Vec::new();
			for call in &calls {
				let text = match self.call(call, &mut rendered, opts).await {
					Ok(text) => text,
					Err(e) => format!("ERROR: {e}"),
				};
				let is_error = text.starts_with("ERROR:");
				results.push(tool_text(&call["id"], &call["name"], &text, is_error));
			}
			self.messages.extend(results);
			if !rendered.is_empty() {
				let pages: Vec<String> = rendered.iter().map(|(page, _)| format!("p{page}")).collect();
				let pngs: Vec<&[u8]> = rendered.iter().map(|(_, png)| png.as_slice()).collect();
				self.messages.push(png_message(&format!("The rendered page(s), in order ({}):", pages.join(", ")), &pngs));
			}
		}
		Ok(None)
	}

	/// Runs one tool call: its text, or the error it threw.
	async fn call(&mut self, call: &Json, rendered: &mut Vec<(i64, Vec<u8>)>, opts: &HelperOptions) -> Result<String, String> {
		let args = &call["arguments"];
		let name = call["name"].as_str().unwrap_or_default();
		match name {
			"pdf_info" => {
				opts.activity("pdf_info: triaging");
				pdf_info_text(self.pdf, self.path).await
			}
			"pdf_extract" => {
				let spec = arg_text(&args["pages"], "all");
				opts.activity(&format!("pdf_extract: {spec}"));
				let text = pdf_extract_text(self.pdf, self.path, &spec).await?;
				// The pages the model got back: "all" and ranges are clamped to the document, and a
				// cut result loses its last pages.
				static HEADING: std::sync::LazyLock<Re> = std::sync::LazyLock::new(|| Re::new(r"^--- Page (\d+) ---$", "gm"));
				for page in HEADING.captures_iter(&text).iter().filter_map(|c| c.get(1)?.parse::<i64>().ok()) {
					self.consulted.insert(page);
					self.read.insert(page);
				}
				Ok(text)
			}
			"pdf_search" => {
				let query = arg_text(&args["query"], "");
				let context_lines = num_or(&args["context_lines"], 3.0);
				let literal = args["literal"].truthy();
				opts.activity(&format!("pdf_search: \"{query}\""));
				// Hits join the citation set: their context lines are consultation.
				let hits = self.pdf.pdf_search(self.path, &query, Some(context_lines), literal).await?;
				self.consulted.extend(hits.iter().map(|h| i64::from(h.page)));
				if hits.is_empty() {
					return Ok("No hits.".to_owned());
				}
				let shown: Vec<String> = hits.iter().take(HIT_CAP).map(|h| format!("=== Page {}, line {} ===\n{}", h.page, h.line, h.context)).collect();
				let more = if hits.len() > HIT_CAP { format!("\n\n[{} more hits — narrow the query.]", hits.len() - HIT_CAP) } else { String::new() };
				Ok(shown.join("\n") + &more)
			}
			"pdf_render" => {
				let spec = arg_text(&args["pages"], "1");
				let dpi = num_or(&args["dpi"], 150.0);
				let wanted = render_batch(&spec);
				opts.activity(&format!("pdf_render: {spec} @{}dpi", js_number(dpi)));
				let pages = opts.headless.render_pdf_pages(self.path, &wanted, Some(dpi)).await?;
				for p in &pages {
					self.consulted.insert(i64::from(p.page));
					self.read.insert(i64::from(p.page));
				}
				if pages.is_empty() {
					return Ok("ERROR: no pages rendered (spec matched nothing?)".to_owned());
				}
				let count = pages.len();
				rendered.extend(pages.into_iter().map(|p| (i64::from(p.page), p.png)));
				Ok(format!("Rendered {count} page(s) at {} DPI — the images follow below. Read them carefully (equations, diagrams, layout).", js_number(dpi)))
			}
			_ => Ok(format!("ERROR: unknown tool \"{name}\"")),
		}
	}
}

/// pdf_info's text: the triage readout.
async fn pdf_info_text(pdf: &Pdf, path: &Path) -> Result<String, String> {
	let info = pdf.pdf_info(path).await?;
	let mut lines = vec![format!("File: {}", info.path), format!("Pages: {} (mean text length/page: {})", info.page_count, info.mean_text_length)];
	lines.extend(info.pages.iter().map(|p| format!("p{}: len={} img={} math={}", p.page, p.text_length, p.image_count, to_fixed(p.math_density, 2))));
	Ok(lines.join("\n"))
}

/// pdf_extract's text, cut at the cap with the narrow-the-spec notice.
async fn pdf_extract_text(pdf: &Pdf, path: &Path, pages: &str) -> Result<String, String> {
	let text = pdf.pdf_extract(path, pages).await?;
	if len16(&text) > EXTRACT_CAP {
		return Ok(format!("{}\n\n[Output truncated at {EXTRACT_CAP} chars — narrow the page spec and extract in smaller batches.]", slice16(&text, 0, Some(EXTRACT_CAP as i64))));
	}
	Ok(text)
}

/// A render spec's page numbers, at most `RENDER_BATCH_CAP` of them. Pages past the end are
/// skipped by the renderer.
fn render_batch(spec: &str) -> Vec<i64> {
	let cap = RENDER_BATCH_CAP as i64;
	let all = format!("1-{cap}");
	let parts: Vec<&str> = if trim(spec).to_lowercase() == "all" { vec![all.as_str()] } else { spec.split(',').collect() };
	let mut out = BTreeSet::new();
	for part in parts {
		let p = trim(part);
		if p.is_empty() {
			continue;
		}
		if p.contains('-') {
			let mut halves = p.splitn(3, '-');
			let (s, e) = (halves.next().unwrap_or(""), halves.next().unwrap_or(""));
			// `parseInt(x) || d`: NaN and 0 take the default.
			let start = parse_int(s).filter(|&n| n != 0).unwrap_or(1).max(1);
			let end = parse_int(e).filter(|&n| n != 0).unwrap_or(start).min(start + cap - 1);
			let mut page = start;
			while page <= end && out.len() < RENDER_BATCH_CAP {
				out.insert(page);
				page += 1;
			}
		} else if let Some(page) = parse_int(p).filter(|&n| n >= 1)
			&& out.len() < RENDER_BATCH_CAP
		{
			out.insert(page);
		}
	}
	out.into_iter().collect()
}

/// `parseInt(text, 10)`: the leading whole number, None for NaN.
fn parse_int(text: &str) -> Option<i64> {
	let text = trim_start(text);
	let (negative, digits) = match text.as_bytes().first() {
		Some(b'-') => (true, &text[1..]),
		Some(b'+') => (false, &text[1..]),
		_ => (false, text),
	};
	let end = digits.bytes().position(|b| !b.is_ascii_digit()).unwrap_or(digits.len());
	let n = digits[..end].parse::<i64>().ok()?;
	Some(if negative { -n } else { n })
}

/// `typeof v === "number" && Number.isFinite(v) ? v : fallback`.
fn num_or(v: &Json, fallback: f64) -> f64 {
	v.as_f64().filter(|n| n.is_finite()).unwrap_or(fallback)
}

/// `String(v ?? fallback)`.
fn arg_text(v: &Json, fallback: &str) -> String {
	match v {
		Json::Null => fallback.to_owned(),
		v => js_string(v),
	}
}

/// `String(v)` for a JSON value.
fn js_string(v: &Json) -> String {
	match v {
		Json::Null => "null".to_owned(),
		Json::Bool(b) => b.to_string(),
		Json::Num(n) => js_number(*n),
		Json::Str(s) => s.clone(),
		// Array.prototype.toString joins with commas and prints null as nothing.
		Json::Arr(items) => items.iter().map(|i| if i.is_null() { String::new() } else { js_string(i) }).collect::<Vec<_>>().join(","),
		Json::Obj(_) => "[object Object]".to_owned(),
	}
}

/// A cheap check that the file can be read; real parsing happens in the tools.
async fn probe_readable(pdf: &Pdf, path: &Path) -> Result<(), String> {
	// Node awaited an import, then fs.stat on its thread pool: the job steps aside for the turn
	// that started it, then checks off the thread. So a bad source's brief misses that turn's
	// steering and reaches the lesson at its next turn boundary.
	tokio::task::yield_now().await;
	let meta = tokio::fs::metadata(path).await.map_err(|e| node_error_message(&e, "stat", path))?;
	if !meta.is_file() {
		return Err("not a regular file".to_owned());
	}
	if meta.len() == 0 {
		return Err("file is empty".to_owned());
	}
	pdf.pdf_probe(path).await
}

#[cfg(test)]
#[path = "pdf_reader_tests.rs"]
mod tests;

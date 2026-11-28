//! The pdf job's agent. It reads a PDF on the teacher's behalf with its own PDF tools; a rendered
//! page comes back to it as a picture in the render's result, shown to this agent alone and never
//! delivered onward.
//!
//! The prompt is the pdf-reader reading doctrine: triage with pdf_info first, then by size: short
//! PDFs read every page, medium ones render the flagged pages, long ones search before reading
//! anything at length. The final text is the brief, with (p. N) citations.
//!
//! A space PDF's pages can be kept: a page the reader rendered for its formulas is written out once
//! as Markdown with LaTeX (save_page), and godspeed serves that text for the page from then on.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use futures_util::future::BoxFuture;
use gs_base::fsx::node_error_message;
use gs_base::num::to_fixed;
use gs_base::re::Re;
use gs_base::text::{len16, slice16, trim};
use gs_core::messages::citations::page_marks;
use gs_core::session::schema::{boolean, no_arguments, object, string};
use gs_core::spaces::kept_pages::with_kept_pages;
use gs_engine::turn::messages::text_block;
use gs_engine::turn::tool::{Tool, ToolContext};
use gs_json::js_text::js_string;
use gs_json::{Json, js_number, json};
use gs_pdf::{Pdf, ops};
use gs_runtime::Part;
use parking_lot::Mutex;

use super::headless::HeadlessApi;
use super::job_agent::Priority;
use super::pi_run::{JobAgentOptions, OnActivity, SubagentRunOptions, report_activity, run_subagent};
use crate::fs_tools::fs_shared::resolve_source_path;
use crate::fs_tools::protected::Protected;

const INSTRUCTIONS: &str = r#"You are a PDF reading specialist working for a teacher agent in a learning app: given a PDF
path and a question, read the document for the teacher and produce a focused brief to teach from,
with page citations.

Isolated context. Task gives the PDF path and question: all you know.

Reading doctrine, always in this order:
1. TRIAGE FIRST: call pdf_info. Returns page count plus per-page signals (text_length,
   image_count, math_density). Read or render nothing before this.
2. Strategy by size:
   - SHORT (≤ 10 pages): extract full text; render every page with meaningful math_density or
     images (read equations and diagrams visually, not as extracted text).
   - MEDIUM (11-40 pages): extract promising pages; render only flagged pages (math- or
     image-heavy, or thin extraction).
   - LONG (> 40 pages): pdf_search the question's key terms first; extract and render only hit
     pages. Never read a long document front-to-back.
3. Page's extracted text looks math- or diagram-heavy, or garbled: RENDER it, read visually
   before concluding from it.
4. Render DPI: 100 text-dominant pages, 150 default, 200 dense small print (math details,
   fine diagrams).

Tool outputs may be error strings (file unreadable, invalid regex, no hits). Adapt: narrow page
spec, change query, lower DPI. Document genuinely can't answer: say so in the brief, never
invent content.

FINAL assistant message is your whole deliverable, standing alone, in this format: 2-6 sentences
(or short sections) answering the teacher's question from the document, each claim cited as
(p. N). End with a line "Pages consulted: N, N, …" listing every page you extracted or rendered."#;

/// Added to the prompt when the PDF is a space file whose pages can be kept.
const KEEP_INSTRUCTIONS: &str = "\n\nRendered a page for its formulas and later lessons will need it: save the whole page once with save_page: its sentences as written, formulas in $...$ or $$...$$, no bold, nothing reordered (quoted words are matched against the page). Page marked kept in pdf_info is saved already: extract it, don't render it.";

/// Pages one job may keep, and the longest kept page in UTF-16 units.
const SAVE_CAP: usize = 3;
const KEPT_PAGE_MAX: usize = 6000;
/// A save shorter than this share of a page's own text, on a page with more than
/// `WHOLE_PAGE_FLOOR` characters of it, is part of the page; a scan has next to no text.
const WHOLE_PAGE_SHARE: f64 = 0.4;
const WHOLE_PAGE_FLOOR: usize = 400;
/// JSON turns an unescaped \neq, \theta, \frac, \beta or \right into a control character and the rest.
const CONTROL_REFUSAL: &str = r"markdown looks broken by JSON: it reads \n, \t, \f, \b and \r as a newline, tab, form feed, backspace and carriage return, so \neq, \theta, \frac, \beta and \right arrive broken. Write each backslash twice in the JSON string (\\frac) and save again.";
/// What follows the `\n` of the common `\n…` commands. The one-letter ones (\ne, \nu, \ni) count
/// only after a space or an opening mark, because a display line may well start with e, u or i.
const N_COMMAND_TAILS: [&str; 18] = ["eq", "e", "abla", "u", "ot", "eg", "i", "otin", "mid", "leq", "geq", "subseteq", "exists", "less", "gtr", "parallel", "earrow", "warrow"];

/// Model calls allowed.
const MAX_ITERATIONS: usize = 14;
/// Pages per pdf_render call: one over-eager call must not flood the vision context.
const RENDER_BATCH_CAP: usize = 6;
/// The extract output ceiling: narrow the spec instead of dumping a book.
const EXTRACT_CAP: usize = 24_000;
/// Search hits shown per call.
const HIT_CAP: usize = 40;

/// Never deliver a brief that consulted nothing: an unread PDF's brief is made-up content.
const UNREAD_FINISH_MESSAGE: &str = "You finished without consulting any page of the PDF — your brief would be invention, not reading. Extract or render the relevant pages first, then write the brief from what you actually saw.";

/// Keeps one page's Markdown.
pub type KeepPage = Box<dyn Fn(u32, &str) -> Result<(), String> + Send + Sync>;

/// A space PDF's kept pages and the way to keep one more. With it the reader offers save_page,
/// and the brief cites the file's pages as their marks.
pub struct Keeper {
	pub file_id: String,
	pub pages: BTreeMap<u32, String>,
	pub keep: KeepPage,
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
	Info,
	Extract,
	Render,
	Search,
	Save,
}

/// What the reader's tools share.
struct Reader {
	pdf: Pdf,
	path: PathBuf,
	headless: Arc<dyn HeadlessApi>,
	on_activity: Option<OnActivity>,
	keep: Option<KeepPage>,
	/// Model calls finished so far: a page rendered during the one under way is not seen yet.
	calls: AtomicUsize,
	read: Mutex<Reading>,
}

#[derive(Default)]
struct Reading {
	/// Every page the reader extracted, rendered or found in a search (the citation set).
	consulted: BTreeSet<i64>,
	/// Pages whose extract or render reached the agent; a search hit consults but does not read.
	read: BTreeSet<i64>,
	/// Pages rendered in this job, with the model call they were rendered in: only these may be
	/// saved, once a later model call has seen them.
	rendered: BTreeMap<i64, usize>,
	/// The kept pages, when the PDF is a space file.
	kept: Option<BTreeMap<u32, String>>,
	/// Pages saved in this job.
	saved: usize,
}

struct PdfTool {
	kind: Kind,
	name: &'static str,
	description: &'static str,
	parameters: Json,
	reader: Arc<Reader>,
}

fn pdf_tools(reader: &Arc<Reader>, keeping: bool) -> Vec<Arc<dyn Tool>> {
	let tool = |kind, name, description, parameters| -> Arc<dyn Tool> { Arc::new(PdfTool { kind, name, description, parameters, reader: reader.clone() }) };
	let mut tools = vec![
		tool(Kind::Info, "pdf_info", "Metadata + per-page triage signals for the PDF (page count, text length, image count, math density). ALWAYS call this first.", no_arguments()),
		tool(
			Kind::Extract,
			"pdf_extract",
			"Extract text from pages (spec: 'all', '1-5', '1,3,7', '3'). Use pdf_info first; narrow the spec for big documents.",
			object(&["pages"], vec![("pages", string("Page spec, e.g. 'all', '1-5', '1,3,7'"))]),
		),
		tool(
			Kind::Render,
			"pdf_render",
			"Render pages to images and show them to you for visual reading (equations, diagrams, layout). DPI: 100 text, 150 default, 200 dense small print. Max 6 pages per call.",
			object(
				&["pages"],
				vec![
					("pages", string("Page spec, e.g. '1-3' or '2,5,8'")),
					("dpi", json!({ "type": "integer", "minimum": 72, "maximum": 300, "description": "Render DPI (100 text / 150 default / 200 dense)" })),
				],
			),
		),
		tool(
			Kind::Search,
			"pdf_search",
			"Search the PDF's text by keyword or regex (case-insensitive); returns hits with context lines. Use for long documents before reading anything at length.",
			object(
				&["query"],
				vec![
					("query", string("Keyword or regex")),
					("context_lines", json!({ "type": "integer", "minimum": 0, "maximum": 8, "description": "Context lines around each hit (default 3)" })),
					("literal", boolean("true = treat the query literally (no regex; default false)")),
				],
			),
		),
	];
	if keeping {
		tools.push(tool(
			Kind::Save,
			"save_page",
			"Keep a whole page you rendered in this job as Markdown with LaTeX. At most 3 pages a job, 6000 characters each.",
			object(&["page", "markdown"], vec![("page", json!({ "type": "integer", "minimum": 1 })), ("markdown", json!({ "type": "string" }))]),
		));
	}
	tools
}

/// A tool's result: its text, an error when it starts "ERROR:", and the rendered pages' pictures.
fn reply(text: &str, pngs: &[Vec<u8>]) -> Json {
	let mut content = vec![text_block(text)];
	content.extend(pngs.iter().map(|png| json!({ "type": "image", "data": gs_base::base64::encode(png), "mimeType": "image/png" })));
	json!({ "content": content, "isError": text.starts_with("ERROR:") })
}

impl Tool for PdfTool {
	fn name(&self) -> &str {
		self.name
	}
	fn description(&self) -> &str {
		self.description
	}
	fn parameters(&self) -> &Json {
		&self.parameters
	}
	fn execute(&self, args: Json, _ctx: ToolContext) -> BoxFuture<'_, Result<Json, String>> {
		Box::pin(async move {
			let (text, pngs) = match self.reader.call(self.kind, &args).await {
				Ok(answer) => answer,
				Err(e) => (format!("ERROR: {e}"), Vec::new()),
			};
			Ok(reply(&text, &pngs))
		})
	}
}

/// Reads the PDF at `path` (resolved like the file tools: `~` and relative mean home) for
/// `question`. Never fails: a failure is a brief starting "PDF failed:".
pub async fn run_pdf_reader_agent(path: &str, question: &str, pdf: &Pdf, keeper: Option<Keeper>, opts: &JobAgentOptions) -> Json {
	let pdf_path = resolve_source_path(Some(path));
	let shown = pdf_path.to_string_lossy().into_owned();
	let keeping = keeper.is_some();
	let (file_id, kept, keep) = keeper.map_or((None, None, None), |k| (Some(k.file_id), Some(k.pages), Some(k.keep)));
	let reader = Arc::new(Reader {
		pdf: pdf.clone(),
		path: pdf_path.clone(),
		headless: opts.headless.clone(),
		on_activity: opts.on_activity.clone(),
		keep,
		calls: AtomicUsize::new(0),
		read: Mutex::new(Reading { kept, ..Reading::default() }),
	});
	// A protected place or a source that cannot open fails before the job starts.
	if let Err(reason) = Protected::current().refuse(path, &pdf_path) {
		return reader.result(&shown, question, &format!("PDF failed: {reason}"));
	}
	if let Err(reason) = probe_readable(pdf, &pdf_path).await {
		return reader.result(&shown, question, &format!("PDF failed: {reason}"));
	}
	let name = pdf_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
	let asked = if question.is_empty() { "(no question — give a structural overview)" } else { question };
	let prompt = [&format!("PDF path: {shown}"), &format!("Question (what the teacher needs from this document): {asked}"), "", "Read the document per your doctrine, then produce your final brief in the required format."].join("\n");
	let instructions = if keeping { format!("{INSTRUCTIONS}{KEEP_INSTRUCTIONS}") } else { INSTRUCTIONS.to_owned() };
	let mut run = SubagentRunOptions::new(format!("PDF reading: {name}"), &instructions, Json::from(prompt), MAX_ITERATIONS);
	run.abort_signal = opts.abort_signal.clone();
	run.priority = Priority::Waited;
	run.approve = opts.approve.clone();
	run.on_usage = Some(Arc::new({
		let (reader, on_usage) = (reader.clone(), opts.on_usage.clone());
		move |usage: &Json, model: &str| {
			reader.calls.fetch_add(1, Ordering::SeqCst);
			if let Some(on_usage) = &on_usage {
				on_usage(usage, model);
			}
		}
	}));
	// The gate counts consulted pages, not read ones: a search-only brief is honest.
	run.follow_up = Some(Box::new({
		let reader = reader.clone();
		move |_: &str| reader.read.lock().consulted.is_empty().then(|| vec![Part::Text(UNREAD_FINISH_MESSAGE.to_owned())])
	}));
	let brief = match run_subagent(opts.agent.as_ref(), pdf_tools(&reader, keeping), run).await {
		Ok(finished) if finished.capped => format!("PDF failed: iteration limit ({MAX_ITERATIONS}) reached without a brief."),
		Ok(finished) => match trim(&finished.text) {
			"" => "(no brief text)".to_owned(),
			brief => file_id.map_or_else(|| brief.to_owned(), |file_id| page_marks(brief, &file_id, &name)),
		},
		Err(e) => format!("PDF failed: the reader crashed: {e}"),
	};
	reader.result(&shown, question, &brief)
}

impl Reader {
	fn result(&self, path: &str, question: &str, brief: &str) -> Json {
		let read = self.read.lock();
		json!({ "path": path, "question": question, "brief": brief, "pagesRead": read.read.iter().copied().collect::<Vec<_>>(), "pagesConsulted": read.consulted.iter().copied().collect::<Vec<_>>() })
	}

	fn kept(&self) -> Option<BTreeMap<u32, String>> {
		self.read.lock().kept.clone()
	}

	/// Runs one tool call: its text and the pictures it shows, or the error it threw.
	async fn call(&self, kind: Kind, args: &Json) -> Result<(String, Vec<Vec<u8>>), String> {
		let path = self.path.as_path();
		let text = match kind {
			Kind::Info => {
				report_activity(&self.on_activity, "pdf_info: triaging");
				pdf_info_text(&self.pdf, path, self.kept().as_ref()).await?
			}
			Kind::Extract => {
				let spec = arg_text(&args["pages"], "all");
				report_activity(&self.on_activity, &format!("pdf_extract: {spec}"));
				let text = pdf_extract_text(&self.pdf, path, &spec, self.kept().as_ref()).await?;
				// The pages the model got back: "all" and ranges are clamped to the document, and a
				// cut result loses its last pages.
				static HEADING: std::sync::LazyLock<Re> = std::sync::LazyLock::new(|| Re::new(r"^--- Page (\d+) ---$", "gm"));
				let mut read = self.read.lock();
				for page in HEADING.captures_iter(&text).iter().filter_map(|c| c.get(1)?.parse::<i64>().ok()) {
					read.consulted.insert(page);
					read.read.insert(page);
				}
				text
			}
			Kind::Search => {
				let query = arg_text(&args["query"], "");
				let context_lines = num_or(&args["context_lines"], 3.0);
				let literal = args["literal"].truthy();
				report_activity(&self.on_activity, &format!("pdf_search: \"{query}\""));
				// Hits join the citation set: their context lines are consultation.
				let hits = self.pdf.pdf_search(path, &query, Some(context_lines), literal).await?;
				self.read.lock().consulted.extend(hits.iter().map(|h| i64::from(h.page)));
				if hits.is_empty() {
					return Ok(("No hits.".to_owned(), Vec::new()));
				}
				let shown: Vec<String> = hits.iter().take(HIT_CAP).map(|h| format!("=== Page {}, line {} ===\n{}", h.page, h.line, h.context)).collect();
				let more = if hits.len() > HIT_CAP { format!("\n\n[{} more hits — narrow the query.]", hits.len() - HIT_CAP) } else { String::new() };
				shown.join("\n") + &more
			}
			Kind::Render => return self.render(args).await,
			Kind::Save => self.save_page(args).await?,
		};
		Ok((text, Vec::new()))
	}

	/// pdf_render: the pages' pictures, shown to the agent with the result.
	async fn render(&self, args: &Json) -> Result<(String, Vec<Vec<u8>>), String> {
		let spec = arg_text(&args["pages"], "1");
		let dpi = num_or(&args["dpi"], 150.0);
		let wanted = render_batch(&spec);
		report_activity(&self.on_activity, &format!("pdf_render: {spec} @{}dpi", js_number(dpi)));
		let pages = self.headless.render_pdf_pages(&self.path, &wanted, Some(dpi)).await?;
		if pages.is_empty() {
			return Ok(("ERROR: no pages rendered (spec matched nothing?)".to_owned(), Vec::new()));
		}
		let call = self.calls.load(Ordering::SeqCst);
		let mut read = self.read.lock();
		for p in &pages {
			let page = i64::from(p.page);
			read.consulted.insert(page);
			read.read.insert(page);
			read.rendered.insert(page, call);
		}
		let text = format!("Rendered {} page(s) at {} DPI — the images follow below. Read them carefully (equations, diagrams, layout).", pages.len(), js_number(dpi));
		Ok((text, pages.into_iter().map(|p| p.png).collect()))
	}

	/// save_page: the page's Markdown kept for this version of the file, or why not.
	async fn save_page(&self, args: &Json) -> Result<String, String> {
		let Some(keep) = &self.keep else { unreachable!("save_page is offered only with a keeper") };
		let count = self.pdf.pdf_shape(&self.path).await?.page_count;
		let page = args["page"].as_f64().or_else(|| args["page"].as_str()?.trim().parse().ok()).filter(|n| n.fract() == 0.0 && (1.0..=f64::from(count)).contains(n));
		let Some(page) = page.map(|n| n as u32) else { return Ok(format!("ERROR: page must be a whole number from 1 to {count}.")) };
		let rendered = self.read.lock().rendered.get(&i64::from(page)).copied();
		match rendered {
			None => return Ok(format!("ERROR: page {page} was not rendered in this job. Render it with pdf_render and read it first.")),
			Some(call) if call == self.calls.load(Ordering::SeqCst) => {
				return Ok(format!("ERROR: page {page} was rendered in this same reply, so you have not seen it yet. Look at its picture first, then save it in a later reply."));
			}
			Some(_) => {}
		}
		if self.read.lock().saved >= SAVE_CAP {
			return Ok(format!("ERROR: this job already saved {SAVE_CAP} pages, the most one job may save."));
		}
		let markdown = trim(args["markdown"].str_or_empty());
		if let Some(refusal) = page_text_refusal(markdown) {
			return Ok(format!("ERROR: {refusal}"));
		}
		let own = self.pdf.pdf_extract(&self.path, &page.to_string()).await?;
		let own_length = len16(own.split_once('\n').map_or("", |(_, text)| text));
		let length = len16(markdown);
		if own_length > WHOLE_PAGE_FLOOR && (length as f64) < own_length as f64 * WHOLE_PAGE_SHARE {
			return Ok(format!("ERROR: markdown is {length} characters, but the page's own text is {own_length}. Save the whole page, every sentence and formula on it."));
		}
		keep(page, markdown)?;
		{
			let mut read = self.read.lock();
			read.kept.get_or_insert_default().insert(page, markdown.to_owned());
			read.saved += 1;
		}
		report_activity(&self.on_activity, &format!("save_page: {page}"));
		Ok(format!("Saved page {page}. Later readings and search get this text for it."))
	}
}

/// Why a page's Markdown cannot be kept, or None. It is stored as text and never run, but it must
/// read as one page: no page heads of its own and no control characters.
fn page_text_refusal(markdown: &str) -> Option<String> {
	static HEAD: std::sync::LazyLock<Re> = std::sync::LazyLock::new(|| Re::new(r"^--- (Page|Slide|Section) \d+ ---$", "m"));
	if markdown.is_empty() {
		return Some("markdown is empty.".to_owned());
	}
	let length = len16(markdown);
	if length > KEPT_PAGE_MAX {
		return Some(format!("markdown is {length} characters long; the most is {KEPT_PAGE_MAX}."));
	}
	if markdown.chars().any(|c| c.is_control() && c != '\n') || math_spans(markdown).into_iter().any(|(math, inline)| has_broken_n_command(math, inline)) {
		return Some(CONTROL_REFUSAL.to_owned());
	}
	if HEAD.test(markdown) {
		return Some("markdown may not hold a line like \"--- Page 3 ---\".".to_owned());
	}
	None
}

/// Whether a math span shows an unescaped `\n…` command that JSON split into a newline and the
/// rest: inline math is one line, and in display math a line starts with what follows the `\n`.
fn has_broken_n_command(math: &str, inline: bool) -> bool {
	if inline {
		return math.contains('\n');
	}
	math.match_indices('\n').any(|(at, _)| {
		let (before, after) = (&math[..at], &math[at + 1..]);
		N_COMMAND_TAILS.iter().any(|tail| {
			let ends = after.strip_prefix(tail).is_some_and(|rest| !rest.starts_with(|c: char| c.is_ascii_alphabetic()));
			ends && (tail.len() > 1 || before.ends_with([' ', '{', '(', '[', '^', '_', ',']))
		})
	})
}

/// The math in Markdown, each span's inside and whether it is inline: `$$…$$`, and `$…$` that
/// opens on a non-space and closes after one, not before a digit (so "$5 and $10" is no math).
/// `\$` is a dollar sign.
fn math_spans(text: &str) -> Vec<(&str, bool)> {
	let bytes = text.as_bytes();
	let mut spans = Vec::new();
	let mut at = 0;
	while at < bytes.len() {
		match bytes[at] {
			b'\\' => at += 2,
			b'$' if bytes.get(at + 1) == Some(&b'$') => {
				let Some(len) = text[at + 2..].find("$$") else { break };
				spans.push((&text[at + 2..at + 2 + len], false));
				at += len + 4;
			}
			b'$' => {
				let opens = bytes.get(at + 1).is_some_and(|b| !matches!(b, b' ' | b'\t'));
				let close = text[at + 1..].find('$').map(|len| at + 1 + len);
				let closes = close.is_some_and(|c| !bytes[c - 1].is_ascii_whitespace() && !bytes.get(c + 1).is_some_and(|b| b.is_ascii_digit() || *b == b'$'));
				match close {
					Some(c) if opens && closes => {
						spans.push((&text[at + 1..c], true));
						at = c + 1;
					}
					_ => at += 1,
				}
			}
			_ => at += 1,
		}
	}
	spans
}

/// pdf_info's text: the triage readout, with "kept" on each kept page.
async fn pdf_info_text(pdf: &Pdf, path: &Path, kept: Option<&BTreeMap<u32, String>>) -> Result<String, String> {
	let info = pdf.pdf_info(path).await?;
	let mut lines = vec![format!("File: {}", info.path), format!("Pages: {} (mean text length/page: {})", info.page_count, info.mean_text_length)];
	lines.extend(info.pages.iter().map(|p| {
		let mark = if kept.is_some_and(|k| k.contains_key(&p.page)) { " kept" } else { "" };
		format!("p{}: len={} img={} math={}{mark}", p.page, p.text_length, p.image_count, to_fixed(p.math_density, 2))
	}));
	Ok(lines.join("\n"))
}

/// pdf_extract's text, kept pages in place of their extracted text, cut at the cap with the
/// narrow-the-spec notice.
async fn pdf_extract_text(pdf: &Pdf, path: &Path, pages: &str, kept: Option<&BTreeMap<u32, String>>) -> Result<String, String> {
	let text = pdf.pdf_extract(path, pages).await?;
	let text = match kept {
		Some(kept) => with_kept_pages(&text, kept),
		None => text,
	};
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

/// `parseInt(text, 10)` as a whole number: None for NaN and for numbers too big to count pages.
fn parse_int(text: &str) -> Option<i64> {
	let n = ops::parse_int(text);
	(n.abs() < i64::MAX as f64).then_some(n as i64)
}

/// `typeof v === "number" && Number.isFinite(v) ? v : fallback`.
fn num_or(v: &Json, fallback: f64) -> f64 {
	v.as_f64().filter(|n| n.is_finite()).unwrap_or(fallback)
}

/// `String(v ?? fallback)`.
fn arg_text(v: &Json, fallback: &str) -> String {
	match v {
		Json::Null => fallback.to_owned(),
		v => js_string(Some(v)),
	}
}

/// A cheap check that the file can be read; real parsing happens in the tools.
async fn probe_readable(pdf: &Pdf, path: &Path) -> Result<(), String> {
	// Yields first, so the check goes on in the background after the turn that started it (see
	// job_host's run_job).
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

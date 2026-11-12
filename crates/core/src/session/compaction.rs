//! The context-fitting mechanic, using the cutoff selection of the Pi coding-agent 1.4.0.
//!
//! Full history stays in the record. A compaction marker carries a summary plus the cut
//! (`firstKeptMessageId`); the model-facing projection is the summary followed by every message
//! from the cut onward. Tokens are estimated as Pi does: anchor on the provider-reported usage of
//! the last assistant message and estimate by characters / 4 only what came after it.
//!
//! Two steps, so a turn never waits on a summary: past the threshold godspeed shortens the record
//! itself at once (`local_summary`), and once the lesson has been quiet the session's model writes
//! the real summary in its place.
//!
//! `activeCompactionOf` and `keptIndexFor` live in `messages::compaction_marks`.

use gs_base::{clock, text};
use gs_json::{Json, Obj, stringify};

use gs_json::js_text::{field_text, js_string, or_empty};
use super::plan::{PlanStatuses, derive_plan_statuses_lh, derived_node_status};
use crate::contracts::chat::COMPACTED_HISTORY_HEADER;
use crate::messages::attachments::content_text;
use crate::messages::compaction_marks::{active_compaction_of, kept_index_for};
use crate::messages::message_id::new_message_id;
use crate::records::settings::factory_settings;

/// Kept-recent tail budget: about 20k tokens of verbatim recent transcript always ride after the
/// summary, as cheap insurance against summary loss.
pub const KEEP_RECENT_TOKENS: f64 = 20_000.0;

/// Subtracted from the model's context window when the window, not the learner's threshold, is
/// the binding limit.
const COMPACTION_RESERVE_TOKENS: f64 = 16_384.0;

/// Tool results are cut to this many characters in the summarizer's input; the kept tail carries
/// them whole.
const SUMMARY_TOOL_RESULT_TRUNCATE: usize = 2_000;

/// A fixed allowance per image, not a measurement of real vision tokens.
const ESTIMATED_IMAGE_CHARS: f64 = 4_800.0;

/// The point a lesson gets summarized: min(setting, window - reserve). An unknown window means
/// the setting alone.
pub fn effective_threshold_tokens(setting_tokens: Option<f64>, context_window_tokens: Option<f64>) -> f64 {
	let setting = setting_tokens.unwrap_or_else(|| factory_settings()["compaction"]["thresholdTokens"].as_f64().unwrap_or_default());
	match context_window_tokens {
		None => setting,
		Some(window) => setting.min((window - COMPACTION_RESERVE_TOKENS).max(1.0)),
	}
}

fn number(v: &Json, key: &str) -> f64 {
	v[key].as_f64().unwrap_or(0.0)
}

/// Context tokens from a provider-reported usage block: the most honest measure of what the last
/// request carried.
pub fn calculate_context_tokens(usage: &Json) -> f64 {
	let total = number(usage, "totalTokens");
	if total != 0.0 { total } else { number(usage, "input") + number(usage, "output") + number(usage, "cacheRead") + number(usage, "cacheWrite") }
}

fn len_of(v: &Json) -> f64 {
	match v {
		Json::Str(s) => text::len16(s) as f64,
		Json::Arr(items) => items.len() as f64,
		_ => 0.0,
	}
}

/// Characters of a content value: a string whole, or the text and image allowance of its blocks.
fn text_chars_of_content(content: &Json) -> f64 {
	match content {
		Json::Str(s) => text::len16(s) as f64,
		Json::Arr(blocks) => blocks
			.iter()
			.map(|block| match block {
				Json::Str(s) => text::len16(s) as f64,
				_ if block["type"].as_str() == Some("image") => ESTIMATED_IMAGE_CHARS,
				_ if block["type"].as_str() == Some("text") => len_of(&block["text"]),
				_ => 0.0,
			})
			.sum(),
		_ => 0.0,
	}
}

/// Pi's heuristic: text, thinking and tool-call name and arguments for assistants; content text
/// plus a fixed image allowance for other roles. Never the stringified whole message, whose
/// record scaffolding would inflate the count about threefold.
pub fn estimate_message_tokens(message: &Json) -> f64 {
	let mut chars = 0.0;
	if message["role"].as_str() == Some("assistant") {
		for block in message["content"].as_arr().into_iter().flatten() {
			match block["type"].as_str() {
				Some("text") => chars += len_of(&block["text"]),
				Some("thinking") => chars += len_of(&block["thinking"]),
				Some("toolCall") => {
					let arguments = if block["arguments"].is_null() { "{}".to_owned() } else { stringify(&block["arguments"]) };
					chars += len_of(&block["name"]) + text::len16(&arguments) as f64;
				}
				_ => {}
			}
		}
	} else {
		chars += text_chars_of_content(&message["content"]) + text_chars_of_content(&message["attachments"]);
		if message["role"].as_str() == Some("system") {
			for section in message["sections"].as_obj().into_iter().flat_map(|s| s.values()) {
				chars += len_of(section);
			}
			if message["toolsAdded"].truthy() {
				chars += text::len16(&stringify(&message["toolsAdded"])) as f64;
			}
		}
	}
	(chars / 4.0).ceil()
}

/// The newest assistant message carrying valid provider-reported usage: aborted and error
/// messages and all-zero usage say nothing about the wire. The scan stops at the newest
/// compaction marker, because usage captured before a compaction described the pre-cut context.
fn last_assistant_usage_index(messages: &[Json]) -> Option<usize> {
	for (i, m) in messages.iter().enumerate().rev() {
		if m["role"].as_str() == Some("custom") && m["customType"].as_str() == Some("compaction") {
			return None;
		}
		if m["role"].as_str() != Some("assistant") || matches!(m["stopReason"].as_str(), Some("aborted" | "error")) {
			continue;
		}
		if calculate_context_tokens(&m["usage"]) == 0.0 {
			continue;
		}
		return Some(i);
	}
	None
}

/// What the trigger compares against the threshold.
pub struct ContextTokenEstimate {
	pub tokens: f64,
	/// Provider-reported tokens from the usage anchor (0 when unanchored).
	pub usage_tokens: f64,
	/// Estimated tokens after the anchor (or everything, when unanchored).
	pub trailing_tokens: f64,
	pub last_usage_index: Option<usize>,
}

/// The trigger estimator: anchor on the last assistant usage the provider reported and estimate
/// only what was appended after it. History the provider already counted is never re-estimated.
pub fn estimate_context_tokens(messages: &[Json]) -> ContextTokenEstimate {
	let Some(anchor) = last_assistant_usage_index(messages) else {
		let trailing = estimate_tokens(messages);
		return ContextTokenEstimate { tokens: trailing, usage_tokens: 0.0, trailing_tokens: trailing, last_usage_index: None };
	};
	let usage_tokens = calculate_context_tokens(&messages[anchor]["usage"]);
	let trailing = estimate_tokens(&messages[anchor + 1..]);
	ContextTokenEstimate { tokens: usage_tokens + trailing, usage_tokens, trailing_tokens: trailing, last_usage_index: Some(anchor) }
}

/// The plain heuristic over a whole message list.
pub fn estimate_tokens(messages: &[Json]) -> f64 {
	messages.iter().map(estimate_message_tokens).sum()
}

/// Whether a message can be a cut candidate. Compaction markers are boundaries and UI-only markers
/// have no context.
fn has_context(message: &Json) -> bool {
	!(message["role"].as_str() == Some("custom") && matches!(message["customType"].as_str(), Some("compaction" | "plan-block" | "problem-dismissed")))
}

/// The cut rule of Pi's findCutPoint: walk backwards to the budget, then take the nearest valid cut at or
/// after that message. Returns the first kept record index; a zero-progress cut drops nothing.
pub fn compaction_cut_index(messages: &[Json], keep_recent_tokens: f64) -> usize {
	let start = active_compaction_of(messages).and_then(|previous| kept_index_for(messages, previous)).unwrap_or(0);
	let points: Vec<usize> = (start..messages.len())
		.filter(|&i| has_context(&messages[i]) && matches!(messages[i]["role"].as_str(), Some("user" | "assistant" | "custom")))
		.collect();
	let Some(&first) = points.first() else { return start };
	let mut cut = first;
	let mut accumulated = 0.0;
	for i in (start..messages.len()).rev() {
		let tokens = if has_context(&messages[i]) { estimate_message_tokens(&messages[i]) } else { 0.0 };
		if tokens == 0.0 {
			continue;
		}
		accumulated += tokens;
		if accumulated >= keep_recent_tokens {
			cut = points.iter().copied().find(|&p| p >= i).unwrap_or_else(|| points[points.len() - 1]);
			break;
		}
	}
	// Metadata next to the cut stays with it, but the walk never crosses a previous compaction.
	while cut > start {
		let before = &messages[cut - 1];
		let is_compaction = before["role"].as_str() == Some("custom") && before["customType"].as_str() == Some("compaction");
		if is_compaction || has_context(before) {
			break;
		}
		cut -= 1;
	}
	cut
}

/// The compaction marker: content is the full model-facing text (header, then the summary). It
/// rides the record at the compaction moment, while the cut it names sits deep in history.
/// `details` is `{firstKeptMessageId, tokensBefore, model?, at, local?}`; `local` marks godspeed's
/// own shortening, waiting for the model's summary to replace it.
pub fn new_compaction_marker(summary: &str, details: &Json) -> Json {
	let mut out = Obj::new();
	out.insert("id", new_message_id());
	out.insert("role", "custom");
	out.insert("customType", "compaction");
	out.insert("content", format!("{COMPACTED_HISTORY_HEADER}\n\n{}", text::trim(summary)));
	out.insert("display", true);
	out.insert("details", details.clone());
	out.insert("timestamp", clock::now_ms() as f64);
	Json::Obj(out)
}

/// A message span as labeled text for the summarizer.
pub fn serialize_for_summary(messages: &[Json]) -> String {
	summary_lines(messages).join("\n\n")
}

/// serialize_for_summary's entries, one per message.
fn summary_lines(messages: &[Json]) -> Vec<String> {
	let mut lines: Vec<String> = Vec::new();
	for m in messages {
		match m["role"].as_str() {
			Some("user") => lines.push(format!("[LEARNER] {}", content_text(&m["content"]))),
			Some("assistant") => {
				let mut blocks: Vec<String> = Vec::new();
				for b in m["content"].as_arr().into_iter().flatten() {
					match b["type"].as_str() {
						Some("text") => blocks.push(or_empty(b.get("text"))),
						// Thinking blocks are the model's scratch; its conclusions land in text.
						Some("toolCall") => {
							let arguments = b.get("arguments").map_or_else(|| "undefined".to_owned(), stringify);
							blocks.push(format!("(tool call {}: {arguments})", field_text(b, "name")));
						}
						_ => {}
					}
				}
				if !blocks.is_empty() {
					lines.push(format!("[TUTOR] {}", blocks.join("\n")));
				}
			}
			Some("toolResult") => {
				let result = content_text(&m["content"]);
				let shown = if text::len16(&result) > SUMMARY_TOOL_RESULT_TRUNCATE {
					format!("{}\u{2026}[truncated]", text::slice16(&result, 0, Some(SUMMARY_TOOL_RESULT_TRUNCATE as i64)))
				} else {
					result
				};
				let failed = if m["isError"].truthy() { " (error)" } else { "" };
				lines.push(format!("[RESULT for {}{failed}] {shown}", field_text(m, "toolName")));
			}
			Some("custom") => {
				if m["customType"].as_str() == Some("plan-block") {
					continue;
				}
				let mut parts = vec![or_empty(m.get("content"))];
				if m["attachments"].truthy() {
					parts.push(content_text(&m["attachments"]));
				}
				lines.push(format!("[SYSTEM NOTE] {}", parts.join("\n")));
			}
			_ => {}
		}
	}
	lines
}

/// A message in godspeed's own shortening is cut to this many characters.
const LOCAL_LINE_CHARS: usize = 600;
/// godspeed's own shortening stays under this (about 6k tokens).
const LOCAL_SUMMARY_CHARS: usize = 24_000;

/// godspeed's own shortening of a span, written at once and without a model: the plan, the
/// summary before it, then each message cut short, the oldest dropped first when they don't all
/// fit.
pub fn local_summary(span: &[Json], prior_summary: Option<&str>, plan_tree_text: Option<&str>) -> String {
	let mut head = vec!["godspeed shortened the earlier part of this session itself; a written summary comes later. Long messages are cut short.".to_owned()];
	if let Some(plan) = plan_tree_text.filter(|t| !t.is_empty()) {
		head.push(format!("## The plan dependency tree\n{plan}"));
	}
	if let Some(prior) = prior_summary.filter(|t| !t.is_empty()) {
		head.push(format!("## Before that\n{}", cut(prior, LOCAL_SUMMARY_CHARS / 3)));
	}
	let lines: Vec<String> = summary_lines(span).iter().map(|line| cut(line, LOCAL_LINE_CHARS)).collect();
	let mut room = LOCAL_SUMMARY_CHARS as i64 - text::len16(&head.join("\n\n")) as i64;
	let mut first_kept = lines.len();
	while first_kept > 0 && room - text::len16(&lines[first_kept - 1]) as i64 > 0 {
		first_kept -= 1;
		room -= text::len16(&lines[first_kept]) as i64 + 2;
	}
	let mut out = head;
	out.push("## Earlier messages".to_owned());
	if first_kept > 0 {
		out.push(format!("({first_kept} older messages left out)"));
	}
	out.extend(lines.into_iter().skip(first_kept));
	out.join("\n\n")
}

fn cut(line: &str, chars: usize) -> String {
	if text::len16(line) > chars { format!("{}\u{2026}", text::slice16(line, 0, Some(chars as i64))) } else { line.to_owned() }
}

/// The messages a compaction marker stands for, and the previous marker's text.
pub struct CompactionSpan<'a> {
	pub span: &'a [Json],
	pub prior_summary: Option<String>,
}

/// From the previous marker's kept boundary (or the start) to this marker's own. None when the
/// marker or its boundary is not in `messages`.
pub fn compaction_span<'a>(messages: &'a [Json], marker: &Json) -> Option<CompactionSpan<'a>> {
	let at = messages.iter().position(|m| m["id"] == marker["id"])?;
	let kept = messages.iter().position(|m| m["id"] == marker["details"]["firstKeptMessageId"])?;
	let previous = active_compaction_of(&messages[..at]);
	let start = previous.map_or(0, |p| messages.iter().position(|m| m["id"] == p["details"]["firstKeptMessageId"]).unwrap_or(0));
	// A boundary before the previous one leaves an empty span, as `slice` does.
	let span = if start <= kept { &messages[start..kept] } else { &[] };
	Some(CompactionSpan { span, prior_summary: previous.map(|p| js_string(p.get("content"))) })
}

/// The plan dependency tree as text, verbatim through compaction: structure from the tree,
/// statuses derived from the transcript. An empty tree has no section.
pub fn plan_tree_to_text(tree: Option<&Json>, messages: &[Json]) -> Option<String> {
	let tree = tree?;
	let nodes: &[Json] = tree["nodes"].as_arr().map_or(&[], Vec::as_slice);
	if nodes.is_empty() {
		return None;
	}
	let statuses: PlanStatuses = derive_plan_statuses_lh(tree, messages);
	let mut lines: Vec<String> = Vec::new();
	for node in nodes {
		let id = node["id"].as_str().unwrap_or_default();
		let summary = if node["summary"].truthy() { format!(" \u{2014} {}", js_string(Some(&node["summary"]))) } else { String::new() };
		lines.push(format!("- [{}] {} ({}){summary}", derived_node_status(&statuses, id), field_text(node, "title"), field_text(node, "id")));
	}
	// Two nodes sharing an id resolve to the later one, as a Map built from the list does.
	let by_id = |id: &Json| id.as_str().and_then(|id| nodes.iter().rfind(|n| n["id"].as_str() == Some(id)));
	for edge in tree["edges"].as_arr().into_iter().flatten() {
		if let (Some(from), Some(to)) = (by_id(&edge["from"]), by_id(&edge["to"])) {
			lines.push(format!("- {} \u{2192} {} ({} \u{2192} {})", field_text(from, "title"), field_text(to, "title"), field_text(from, "id"), field_text(to, "id")));
		}
	}
	Some(lines.join("\n"))
}

/// The Talk chat's summary: what the learner asked for and what was done, so a later "yes, add
/// them too" still makes sense.
fn talk_compaction_prompt(span_text: &str) -> String {
	format!(
		"You are compacting the earlier part of the learner's Talk chat with their teacher in a learning app (outside lessons: setting up spaces, files and deadlines, quick questions). Write the summary your future self will read INSTEAD of that transcript. The transcript labels the learner as [LEARNER], you as [TUTOR], tool traffic as [RESULT \u{2026}]/[SYSTEM NOTE].

Write the summary with EXACTLY these sections, in this order:

## Done
What the learner asked for and what you did about it: spaces created or changed, folders linked, files added or switched, deadlines added, moved or removed. Keep every space id, file id, deadline id, name, date and path exact.

## Learned about the learner
Facts they told you that matter later (their spaces, schedule, preferences).

## Open
Anything still waiting: a question you asked them, a promise you made, a request not finished.

Rules: no filler, no speculation beyond the transcript. Keep it short.

TRANSCRIPT TO SUMMARIZE:

{span_text}"
	)
}

/// The summarizer prompt, written for the session's own model as its future self: the summary
/// replaces everything before the cut. Required shape, in order of stress: the learner's
/// understanding and how it evolved, the teaching arc, the plan tree verbatim, the current moment.
/// `kind` is the session kind ("teach", "practice", "probe" or "talk"); Talk has its own shape.
pub fn build_compaction_prompt(span_text: &str, plan_tree_text: Option<&str>, kind: &str) -> String {
	if kind == "talk" {
		return talk_compaction_prompt(span_text);
	}
	let plan_section = plan_tree_text.unwrap_or("No plan tree exists in this session (nothing was persisted).");
	format!(
		"You are compacting the earlier part of a tutoring session \u{2014} writing the summary your future self will read INSTEAD of that transcript. Everything before the cut is replaced by what you write; everything after stays verbatim. The learner's transcript below labels the learner as [LEARNER], the tutoring agent as [TUTOR], tool traffic as [RESULT \u{2026}]/[SYSTEM NOTE].

Write the summary with EXACTLY these sections, in this order:

## The learner's understanding
The most detailed picture you can give of what this learner knows and how that EVOLVED across the session: what they answered and how well (quiz outcomes, correct reasoning, mistakes), their stated or displayed confidence, misconceptions that surfaced, which were corrected and which still stand. This section carries the most weight \u{2014} future teaching decisions hang on it.

## The teaching arc
How the session progressed: what was covered and in what order, which explanations landed and which didn't, how the learner responded, where the momentum went. Include probe-phase findings if present.

## The plan dependency tree
Reproduce the session's current plan tree verbatim from the structure below \u{2014} do not drop nodes, edges, or statuses.

{plan_section}

## The current moment
What is happening RIGHT NOW at the cut: any question or problem awaiting the learner's answer, any commitment the agent has made that a later turn must honor, and the immediate next step.

Rules: no praise, no filler, no speculation beyond the transcript. Every claim about the learner must be traceable to what they actually said or answered. Keep every identifier (proposition ids, node ids, file paths) exact.

TRANSCRIPT TO SUMMARIZE:

{span_text}"
	)
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn user(text: &str) -> Json {
		json!({ "role": "user", "id": "u", "content": text })
	}

	fn assistant(text: &str, usage: u32) -> Json {
		json!({ "role": "assistant", "content": [{ "type": "text", "text": text }, { "type": "toolCall", "name": "quiz", "arguments": { "a": 1 } }], "usage": { "input": usage } })
	}

	#[test]
	fn thresholds_and_usage() {
		assert_eq!(effective_threshold_tokens(None, None), 40_000.0);
		assert_eq!(effective_threshold_tokens(Some(90_000.0), Some(50_000.0)), 33_616.0);
		assert_eq!(effective_threshold_tokens(Some(5.0), Some(10.0)), 1.0);
		assert_eq!(calculate_context_tokens(&json!({ "totalTokens": 7, "input": 1 })), 7.0);
		assert_eq!(calculate_context_tokens(&json!({ "input": 1, "output": 2, "cacheRead": 3, "cacheWrite": 4 })), 10.0);
	}

	#[test]
	fn messages_cost_a_quarter_of_their_characters() {
		assert_eq!(estimate_message_tokens(&user("abcde")), 2.0);
		assert_eq!(estimate_message_tokens(&json!({ "role": "user", "content": [{ "type": "image" }, { "type": "text", "text": "ab" }] })), 1201.0);
		// "x"(1) + "quiz"(4) + {"a":1}(7)
		assert_eq!(estimate_message_tokens(&assistant("x", 0)), 3.0);
		assert_eq!(estimate_message_tokens(&json!({ "role": "system", "content": "ab", "sections": { "a": "cd", "b": "efg" }, "toolsAdded": ["t"] })), 3.0);
	}

	#[test]
	fn the_estimate_anchors_on_the_last_real_usage() {
		let messages = [user("hello"), assistant("a", 100), user("abcdefgh"), json!({ "role": "assistant", "stopReason": "error", "content": [], "usage": { "input": 999 } })];
		let estimate = estimate_context_tokens(&messages);
		assert_eq!((estimate.tokens, estimate.usage_tokens, estimate.trailing_tokens, estimate.last_usage_index), (102.0, 100.0, 2.0, Some(1)));
		let marker = json!({ "role": "custom", "customType": "compaction", "details": {} });
		assert_eq!(estimate_context_tokens(&[assistant("a", 100), marker]).last_usage_index, None);
		assert_eq!(estimate_tokens(&[user("abcd"), user("abcd")]), 2.0);
	}

	#[test]
	fn the_cut_keeps_the_recent_tail_and_its_metadata() {
		let big = "x".repeat(400);
		let note = json!({ "role": "custom", "customType": "plan-block", "content": "", "id": "pb" });
		let messages = [user(&big), assistant(&big, 0), note, user(&big), assistant(&big, 0)];
		// The metadata marker next to the cut stays with the kept tail.
		assert_eq!(compaction_cut_index(&messages, 150.0), 2);
		assert_eq!(compaction_cut_index(&messages, 250.0), 1);
		assert_eq!(compaction_cut_index(&messages, 1_000_000.0), 0);
		assert_eq!(compaction_cut_index(&[], 10.0), 0);
		let kept = json!({ "role": "custom", "customType": "compaction", "details": { "firstKeptMessageId": "u" } });
		assert_eq!(compaction_cut_index(&[user("a"), kept.clone(), user("b")], 1.0), 2);
	}

	#[test]
	fn the_local_summary_cuts_long_messages_and_drops_the_oldest() {
		let summary = local_summary(&[user(&"a".repeat(700)), user("b")], Some("prior"), Some("- [current] A (a)"));
		let want = format!("godspeed shortened the earlier part of this session itself; a written summary comes later. Long messages are cut short.\n\n## The plan dependency tree\n- [current] A (a)\n\n## Before that\nprior\n\n## Earlier messages\n\n[LEARNER] {}\u{2026}\n\n[LEARNER] b", "a".repeat(590));
		assert_eq!(summary, want);
		let many: Vec<Json> = (0..60).map(|_| user(&"w".repeat(600))).collect();
		assert!(local_summary(&many, None, None).contains("(21 older messages left out)"));
	}

	#[test]
	fn the_span_runs_from_the_previous_boundary() {
		let marker = |id: &str, kept: &str| json!({ "id": id, "role": "custom", "customType": "compaction", "content": format!("s{id}"), "details": { "firstKeptMessageId": kept } });
		let m = |id: &str| json!({ "id": id, "role": "user", "content": id });
		let messages = [m("a"), m("b"), marker("k1", "b"), m("c"), marker("k2", "c")];
		let span = compaction_span(&messages, &messages[4]).unwrap();
		assert_eq!((span.span.to_vec(), span.prior_summary), (messages[1..3].to_vec(), Some("sk1".to_owned())));
		assert!(compaction_span(&messages, &marker("k9", "a")).is_none());
	}

	#[test]
	fn the_marker_carries_header_and_summary() {
		let marker = new_compaction_marker("  summary \n", &json!({ "firstKeptMessageId": "m1", "tokensBefore": 5, "at": "t" }));
		assert_eq!(marker["content"].as_str().map(|c| c.ends_with("\n\nsummary")), Some(true));
		assert_eq!(marker.as_obj().unwrap().keys().map(String::as_str).collect::<Vec<_>>(), ["id", "role", "customType", "content", "display", "details", "timestamp"]);
	}

	#[test]
	fn the_summary_input_is_labeled_and_cut() {
		let long = "y".repeat(2_500);
		let messages = [
			user("hi"),
			assistant("sure", 0),
			json!({ "role": "toolResult", "toolName": "quiz", "isError": true, "content": long }),
			json!({ "role": "custom", "customType": "plan-block", "content": "p" }),
			json!({ "role": "custom", "customType": "x", "content": "note", "attachments": [{ "type": "text", "text": "att" }] }),
		];
		let text = serialize_for_summary(&messages);
		let parts: Vec<&str> = text.split("\n\n").collect();
		assert_eq!(parts[0], "[LEARNER] hi");
		assert_eq!(parts[1], "[TUTOR] sure\n(tool call quiz: {\"a\":1})");
		assert!(parts[2].starts_with("[RESULT for quiz (error)] yyy"));
		assert!(parts[2].ends_with("y\u{2026}[truncated]"));
		assert_eq!(parts[3], "[SYSTEM NOTE] note\natt");
		assert_eq!(parts.len(), 4);
	}

	#[test]
	fn the_plan_tree_renders_with_derived_statuses() {
		let tree = json!({ "nodes": [{ "id": "a", "title": "A", "summary": "first" }, { "id": "b", "title": "B" }], "edges": [{ "from": "a", "to": "b" }, { "from": "a", "to": "zz" }] });
		let call = json!({ "role": "assistant", "content": [{ "type": "toolCall", "name": "quiz", "arguments": { "nodeId": "a" } }] });
		assert_eq!(plan_tree_to_text(Some(&tree), &[call]).unwrap(), "- [current] A (a) \u{2014} first\n- [upcoming] B (b)\n- A \u{2192} B (a \u{2192} b)");
		assert_eq!(plan_tree_to_text(Some(&json!({ "nodes": [], "edges": [] })), &[]), None);
		assert_eq!(plan_tree_to_text(None, &[]), None);
	}

	#[test]
	fn prompts_embed_the_transcript_and_plan() {
		let teach = build_compaction_prompt("SPAN", Some("- plan"), "teach");
		assert!(teach.contains("## The plan dependency tree\nReproduce the session's current plan tree verbatim from the structure below \u{2014} do not drop nodes, edges, or statuses.\n\n- plan\n\n## The current moment"));
		assert!(teach.ends_with("TRANSCRIPT TO SUMMARIZE:\n\nSPAN"));
		assert!(build_compaction_prompt("S", None, "practice").contains("No plan tree exists in this session (nothing was persisted)."));
		assert!(build_compaction_prompt("S", None, "talk").starts_with("You are compacting the earlier part of the learner's Talk chat"));
	}
}

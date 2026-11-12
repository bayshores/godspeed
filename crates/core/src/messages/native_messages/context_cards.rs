//! The markers that tell the teacher where a session came from: the map picks, the study topics
//! and the space card. The model reads their text; the view reads `details`.

use gs_base::text;
use gs_json::{Json, json};

use super::marker;
use gs_json::js_text::js_string;
use crate::messages::message_id::new_message_id;

/// The session's map context, a separate marker before the learner's first message: each
/// picked proposition once with its id, then the reasoning chains among them. `picks` are
/// `{id, name, statement}` as the learner saw them.
pub fn new_graph_context_message(picks: &[Json], chains: &[String]) -> Json {
	// The brackets mark it as injected context, because markers reach the model as user messages.
	let mut lines = vec![
		"[Session context] — picked from the learner's knowledge map when starting this session:".to_owned(),
		String::new(),
		"Propositions (id — name: statement; the problem tool's target field uses these ids):".to_owned(),
	];
	for p in picks {
		lines.push(format!("- [{}] {}: {}", js_string(p.get("id")), js_string(p.get("name")), js_string(p.get("statement"))));
	}
	if !chains.is_empty() {
		lines.push(String::new());
		lines.push("Reasoning chains among them (premises → conclusion):".to_owned());
		lines.extend(chains.iter().map(|c| format!("- {c}")));
	}
	let details = json!({ "propositions": picks.to_vec(), "chains": chains.to_vec() });
	Json::Obj(marker(new_message_id(), "graph-context", lines.join("\n"), true, details))
}

/// A study session's topics, or a homework session's deadline and problems, for the model only.
/// `custom_type` is "study-context" or "homework-context".
pub fn new_study_context_message(text: &str, custom_type: &str) -> Json {
	Json::Obj(marker(new_message_id(), custom_type, text, false, Json::Null))
}

/// The model-facing space card text. `card` is `{spaceId, name, description, files, topics?}`.
/// It counts the files; read_space lists them (`space_files_text`).
pub fn space_card_text(card: &Json) -> String {
	let mut lines = vec!["[Space context] — this lesson belongs to one of the learner's spaces:".to_owned(), String::new(), format!("Space: {}", js_string(card.get("name")))];
	let description = text::trim(card["description"].as_str().unwrap_or(""));
	if !description.is_empty() {
		lines.extend(["".to_owned(), "About the space (the learner's own words):".to_owned(), description.to_owned()]);
	}
	if let Some(prep) = card.get("prep").filter(|p| p.truthy()) {
		let on = if prep["date"].truthy() { format!(" (on {})", js_string(prep.get("date"))) } else { String::new() };
		lines.extend(["".to_owned(), format!("This space is a prep. The learner is getting ready for: {}{on}", js_string(prep.get("goal")))]);
		if prep["about"].truthy() {
			lines.extend(["".to_owned(), "What it is like (from the prep sheet):".to_owned(), js_string(prep.get("about"))]);
		}
	}
	let readable = readable_files(card);
	if !readable.is_empty() {
		let study = readable.iter().filter(|f| f["kind"].as_str() == Some("study")).count();
		lines.push(String::new());
		lines.push(format!("Space files: {study} study material, {} space info. Find what's in them with search_space_files; read_space lists them with their paths.", readable.len() - study));
	}
	let topics = card["topics"].as_arr().filter(|t| !t.is_empty());
	if let Some(topics) = topics {
		lines.push(String::new());
		lines.push("Topics in the space's knowledge graph (facts in each):".to_owned());
		lines.push(topics.iter().map(|t| format!("{} ({})", js_string(t.get("name")), js_string(t.get("facts")))).collect::<Vec<_>>().join(", "));
	}
	lines.join("\n")
}

/// The files the teacher can read: a file without a path (not readable) is left out.
fn readable_files(card: &Json) -> Vec<&Json> {
	card["files"].as_arr().into_iter().flatten().filter(|f| !matches!(f.get("path"), Some(Json::Null))).collect()
}

/// The space's readable files, one line each with its path. Only read_space shows it: the card
/// just counts them, so lessons don't carry the list.
pub fn space_files_text(card: &Json) -> String {
	let readable = readable_files(card);
	if readable.is_empty() {
		return String::new();
	}
	let mut lines = vec!["Space files (study material = turned into the space's knowledge graph; space info = a syllabus, a schedule, logistics):".to_owned()];
	for f in readable {
		// Only a status other than "ready" is worth showing.
		let status = Some(&f["status"]).filter(|s| s.as_str() != Some("ready"));
		let parts: Vec<String> = [Some(&f["size"]), status].into_iter().flatten().filter(|v| v.truthy()).map(|v| js_string(Some(v))).collect();
		let about = if parts.is_empty() { String::new() } else { format!(" ({})", parts.join(", ")) };
		let kind = if f["kind"].as_str() == Some("study") { "study material" } else { "space info" };
		lines.push(format!("- [{kind}] {}{about} — {}", js_string(f.get("name")), js_string(f.get("path"))));
	}
	lines.join("\n")
}

pub fn new_space_context_message(card: &Json) -> Json {
	Json::Obj(marker(new_message_id(), "space-context", space_card_text(card), true, card.clone()))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_graph_card_lists_picks_then_chains() {
		let picks = [json!({ "id": "p1", "name": "Limits", "statement": "A limit is a value." })];
		let message = new_graph_context_message(&picks, &["a → b".to_owned()]);
		assert_eq!(
			message["content"].as_str().unwrap(),
			"[Session context] — picked from the learner's knowledge map when starting this session:\n\nPropositions (id — name: statement; the problem tool's target field uses these ids):\n- [p1] Limits: A limit is a value.\n\nReasoning chains among them (premises → conclusion):\n- a → b"
		);
		assert_eq!(message["details"], json!({ "propositions": picks.to_vec(), "chains": ["a → b"] }));
		assert_eq!(new_graph_context_message(&[], &[])["details"]["chains"], json!([]));
	}

	#[test]
	fn the_space_card_counts_readable_files_and_lists_topics() {
		let card = json!({
			"spaceId": "c1",
			"name": "Algebra 1",
			"description": "  my words \n",
			"files": [
				{ "name": "notes.pdf", "kind": "study", "path": "/a/notes.pdf", "size": "98 pages", "status": "ready" },
				{ "name": "syl.pdf", "kind": "info", "path": "/a/syl.pdf", "status": "reading" },
				{ "name": "gone.pdf", "kind": "info", "path": null },
			],
			"topics": [{ "name": "Sums", "facts": 4 }, { "name": "Logs", "facts": 2 }],
		});
		assert_eq!(
			space_card_text(&card),
			"[Space context] — this lesson belongs to one of the learner's spaces:\n\nSpace: Algebra 1\n\nAbout the space (the learner's own words):\nmy words\n\nSpace files: 1 study material, 1 space info. Find what's in them with search_space_files; read_space lists them with their paths.\n\nTopics in the space's knowledge graph (facts in each):\nSums (4), Logs (2)"
		);
		assert_eq!(
			space_files_text(&card),
			"Space files (study material = turned into the space's knowledge graph; space info = a syllabus, a schedule, logistics):\n- [study material] notes.pdf (98 pages) — /a/notes.pdf\n- [space info] syl.pdf (reading) — /a/syl.pdf"
		);
		let bare = json!({ "name": "X", "description": "", "files": [], "topics": [] });
		assert_eq!(space_card_text(&bare), "[Space context] — this lesson belongs to one of the learner's spaces:\n\nSpace: X");
		assert_eq!(space_files_text(&bare), "");
		assert_eq!(new_space_context_message(&bare)["details"], bare);
		assert_eq!(new_study_context_message("t", "homework-context")["display"], json!(false));
	}

	#[test]
	fn a_preps_card_says_what_the_learner_is_getting_ready_for() {
		let card = json!({ "name": "Acme test", "description": "", "files": [], "prep": { "goal": "Acme online test", "date": "2026-11-20", "about": "Four questions." } });
		assert_eq!(
			space_card_text(&card),
			"[Space context] — this lesson belongs to one of the learner's spaces:\n\nSpace: Acme test\n\nThis space is a prep. The learner is getting ready for: Acme online test (on 2026-11-20)\n\nWhat it is like (from the prep sheet):\nFour questions."
		);
		let unwritten = json!({ "name": "Acme test", "description": "", "files": [], "prep": { "goal": "Acme online test", "about": "" } });
		assert!(space_card_text(&unwritten).ends_with("\n\nThis space is a prep. The learner is getting ready for: Acme online test"));
	}
}

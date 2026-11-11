//! The markers that tell the teacher where a session came from: the map picks, the study topics
//! and the class card. The model reads their text; the view reads `details`.

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

/// The model-facing class card text. `card` is `{classId, name, description, files, topics?}`.
pub fn class_card_text(card: &Json) -> String {
	let mut lines = vec!["[Class context] — this lesson belongs to a course the learner is taking:".to_owned(), String::new(), format!("Class: {}", js_string(card.get("name")))];
	let description = text::trim(card["description"].as_str().unwrap_or(""));
	if !description.is_empty() {
		lines.extend(["".to_owned(), "About the class (the learner's own words):".to_owned(), description.to_owned()]);
	}
	let readable: Vec<&Json> = card["files"].as_arr().into_iter().flatten().filter(|f| !matches!(f.get("path"), Some(Json::Null))).collect();
	if !readable.is_empty() {
		lines.push(String::new());
		lines.push("Class files (study material = turned into the class's knowledge graph; course info = syllabus, assignments, logistics):".to_owned());
		for f in readable {
			// Only a status other than "ready" is worth showing.
			let status = Some(&f["status"]).filter(|s| s.as_str() != Some("ready"));
			let parts: Vec<String> = [Some(&f["size"]), status].into_iter().flatten().filter(|v| v.truthy()).map(|v| js_string(Some(v))).collect();
			let about = if parts.is_empty() { String::new() } else { format!(" ({})", parts.join(", ")) };
			let kind = if f["kind"].as_str() == Some("study") { "study material" } else { "course info" };
			lines.push(format!("- [{kind}] {}{about} — {}", js_string(f.get("name")), js_string(f.get("path"))));
		}
	}
	let topics = card["topics"].as_arr().filter(|t| !t.is_empty());
	if let Some(topics) = topics {
		lines.push(String::new());
		lines.push("Topics in the class's knowledge graph (facts in each):".to_owned());
		lines.push(topics.iter().map(|t| format!("{} ({})", js_string(t.get("name")), js_string(t.get("facts")))).collect::<Vec<_>>().join(", "));
	}
	lines.join("\n")
}

pub fn new_class_context_message(card: &Json) -> Json {
	Json::Obj(marker(new_message_id(), "class-context", class_card_text(card), true, card.clone()))
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
	fn the_class_card_lists_readable_files_and_topics() {
		let card = json!({
			"classId": "c1",
			"name": "CSE 21",
			"description": "  my words \n",
			"files": [
				{ "name": "notes.pdf", "kind": "study", "path": "/a/notes.pdf", "size": "98 pages", "status": "ready" },
				{ "name": "syl.pdf", "kind": "info", "path": "/a/syl.pdf", "status": "reading" },
				{ "name": "gone.pdf", "kind": "info", "path": null },
			],
			"topics": [{ "name": "Sums", "facts": 4 }, { "name": "Logs", "facts": 2 }],
		});
		assert_eq!(
			class_card_text(&card),
			"[Class context] — this lesson belongs to a course the learner is taking:\n\nClass: CSE 21\n\nAbout the class (the learner's own words):\nmy words\n\nClass files (study material = turned into the class's knowledge graph; course info = syllabus, assignments, logistics):\n- [study material] notes.pdf (98 pages) — /a/notes.pdf\n- [course info] syl.pdf (reading) — /a/syl.pdf\n\nTopics in the class's knowledge graph (facts in each):\nSums (4), Logs (2)"
		);
		let bare = json!({ "name": "X", "description": "", "files": [], "topics": [] });
		assert_eq!(class_card_text(&bare), "[Class context] — this lesson belongs to a course the learner is taking:\n\nClass: X");
		assert_eq!(new_class_context_message(&bare)["details"], bare);
		assert_eq!(new_study_context_message("t", "homework-context")["display"], json!(false));
	}
}

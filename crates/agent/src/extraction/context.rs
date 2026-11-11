//! What the extractor reads (extraction.ts): a lesson as its teacher prose, a notes file in
//! chunks, and the prompt's graph context (what this source already gave and related ideas).

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::text;
use gs_core::graph::coverage::message_view_lines;
use gs_core::graph::graph::DerivedGraph;
use gs_json::Json;

static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));

/// A message's id as a template literal writes it.
pub fn message_id(message: &Json) -> &str {
	message["id"].as_str().unwrap_or("undefined")
}

/// The extraction view: only learner-facing teacher prose (and graded questions), each line
/// labeled with its message id, exactly the lines the coverage fingerprints hash.
pub fn prose_view(messages: &[&Json], title: Option<&str>, failed: &HashSet<String>) -> String {
	let lines: Vec<String> = messages.iter().flat_map(|m| message_view_lines(m, message_id(m), Some(failed))).collect();
	let head = title.filter(|t| !t.is_empty()).map(|t| format!("# {t}\n\n")).unwrap_or_default();
	head + &lines.join("\n\n")
}

/// The raw source view of a notes chunk: the path, then the text verbatim.
pub fn notes_view(file_path: &str, text: &str, part: Option<(usize, usize)>) -> String {
	let part = part.filter(|(_, n)| *n > 1).map(|(i, n)| format!(" (part {i}/{n})")).unwrap_or_default();
	format!("SOURCE (the author's personal notes): {file_path}{part}\n\n{text}")
}

/// Notes text cut under the token budget (chars / 4), greedily by line; a line over the budget
/// rides alone and is never split.
pub fn chunk_notes(source: &str, budget: f64) -> Vec<String> {
	if text::trim(source).is_empty() {
		return Vec::new();
	}
	let mut out = Vec::new();
	let mut current = String::new();
	for line in source.split('\n') {
		let candidate = if current.is_empty() { line.to_owned() } else { format!("{current}\n{line}") };
		if !current.is_empty() && (text::len16(&candidate) as f64 / 4.0).ceil() > budget {
			out.push(std::mem::replace(&mut current, line.to_owned()));
		} else {
			current = candidate;
		}
	}
	if !text::trim(&current).is_empty() {
		out.push(current);
	}
	out
}

fn is_ours(line: &Json, source_id: &str) -> bool {
	line["provenance"].as_arr().into_iter().flatten().any(|pt| pt["chatId"].as_str() == Some(source_id))
}

fn node_line(n: &Json) -> String {
	format!("  {} | {} | {}", n["id"].str_or_empty(), n["name"].str_or_empty(), SPACES.replace(n["statement"].str_or_empty(), " "))
}

/// THE GRAPH SO FAR (this source's ideas and chains) and RELATED IDEAS (other sources' ideas the
/// search picked), ids verbatim. Empty when there is nothing to show.
pub fn graph_context(graph: &DerivedGraph, source_id: &str, related_ids: &[String]) -> String {
	let name_of: HashMap<&str, &str> = graph.nodes.iter().map(|n| (n["id"].str_or_empty(), n["name"].str_or_empty())).collect();
	let by_id: HashMap<&str, &Json> = graph.nodes.iter().map(|n| (n["id"].str_or_empty(), n)).collect();
	let ours: Vec<&Json> = graph.nodes.iter().filter(|n| is_ours(n, source_id)).collect();
	let our_chains: Vec<&Json> = graph.chains.iter().filter(|c| is_ours(c, source_id)).collect();
	let related: Vec<&Json> = related_ids.iter().filter_map(|id| by_id.get(id.as_str()).copied()).filter(|n| !is_ours(n, source_id)).collect();
	let name = |id: &'_ str| -> String { name_of.get(id).map_or(id, |n| *n).to_owned() };
	let mut lines: Vec<String> = Vec::new();
	if !ours.is_empty() || !our_chains.is_empty() {
		lines.push("THE GRAPH SO FAR \u{2014} everything already extracted from this source (reference these ids verbatim):".to_owned());
		lines.extend(ours.iter().map(|n| node_line(n)));
		if !our_chains.is_empty() {
			lines.push("DERIVATIONS ALREADY RECORDED (build on these; do not re-derive them):".to_owned());
			for c in our_chains {
				let premises: Vec<&str> = c["premises"].as_arr().into_iter().flatten().map(Json::str_or_empty).collect();
				let conclusion = c["conclusion"].str_or_empty();
				let names: Vec<String> = premises.iter().map(|p| name(p)).collect();
				lines.push(format!("  [{} \u{21d2} {conclusion}]  {} \u{21d2} {}", premises.join(" + "), names.join(" \u{2227} "), name(conclusion)));
			}
		}
	}
	if !related.is_empty() {
		lines.push("RELATED IDEAS \u{2014} already in the graph from other sources (reference these ids verbatim):".to_owned());
		lines.extend(related.iter().map(|n| node_line(n)));
	}
	lines.join("\n")
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn notes_chunk_by_line_under_the_budget() {
		assert!(chunk_notes(" \n\t", 10.0).is_empty());
		assert_eq!(chunk_notes("abcd\nefgh\nij", 2.0), vec!["abcd", "efgh\nij"]);
		assert_eq!(chunk_notes("a very long line\nb", 1.0), vec!["a very long line", "b"]);
		assert_eq!(chunk_notes("x\n\n  ", 100.0), vec!["x\n\n  "]);
		assert_eq!(notes_view("a.md", "t", Some((1, 1))), "SOURCE (the author's personal notes): a.md\n\nt");
		assert_eq!(notes_view("a.md", "t", Some((2, 3))), "SOURCE (the author's personal notes): a.md (part 2/3)\n\nt");
	}

	#[test]
	fn the_context_shows_this_source_then_related_ideas() {
		let node = |id: &str, chat: &str| json!({ "id": id, "name": format!("N{id}"), "statement": "a\n  b", "provenance": [{ "chatId": chat, "messageId": "" }] });
		let graph = DerivedGraph {
			nodes: vec![node("n1", "src"), node("n2", "src"), node("n3", "other")],
			chains: vec![json!({ "premises": ["n1", "nx"], "conclusion": "n2", "provenance": [{ "chatId": "src", "messageId": "" }] })],
		};
		let text = graph_context(&graph, "src", &["n3".into(), "n1".into(), "n9".into()]);
		assert_eq!(
			text,
			"THE GRAPH SO FAR \u{2014} everything already extracted from this source (reference these ids verbatim):\n  n1 | Nn1 | a b\n  n2 | Nn2 | a b\nDERIVATIONS ALREADY RECORDED (build on these; do not re-derive them):\n  [n1 + nx \u{21d2} n2]  Nn1 \u{2227} nx \u{21d2} Nn2\nRELATED IDEAS \u{2014} already in the graph from other sources (reference these ids verbatim):\n  n3 | Nn3 | a b"
		);
		assert_eq!(graph_context(&DerivedGraph { nodes: vec![], chains: vec![] }, "src", &[]), "");
	}

	#[test]
	fn the_prose_view_labels_passages() {
		let m = json!({ "id": "m1", "role": "assistant", "content": [{ "type": "text", "text": "Hi there" }] });
		assert_eq!(prose_view(&[&m], Some("T"), &HashSet::new()), "# T\n\nTEACHER [m1] Hi there");
		assert_eq!(prose_view(&[&m], Some(""), &HashSet::new()), "TEACHER [m1] Hi there");
	}
}

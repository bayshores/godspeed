//! The mermaid subset a plan is written in: a hand
//! parser with line-numbered problems the teacher can act on. Node ids are permanent lowercase
//! slugs, titles are free text, and `-->` (also `==>`, `-.->`) means "from is a prerequisite".

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::text::{trim, trim_end};
use gs_json::{Json, json};

pub struct ParsedPlan {
	pub nodes: Vec<Json>,
	pub edges: Vec<Json>,
}

static HEADER_RE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^(graph|flowchart)\s+(td|tb|lr|rl|bt)\s*$", "i"));
static SLUG_RE: LazyLock<Re> = LazyLock::new(|| Re::new(r"^[a-z0-9]+([_-][a-z0-9]+)*$", ""));
static ARROW_RE: LazyLock<Re> = LazyLock::new(|| Re::new(r"-->|==>|-\.->", ""));
static LINE_BREAK_RE: LazyLock<Re> = LazyLock::new(|| Re::new(r"\r?\n", ""));
// The id space is broad on purpose, so every bad id reaches the specific slug message.
static ENDPOINT_RE: LazyLock<Re> = LazyLock::new(|| Re::new(r#"^([^\s()\[\]]+)\s*(?:\[([^\[\]]*)\]|\(\s*"([^"]*)"\s*\)|\(([^()]*)\))?$"#, ""));

/// A line without its trailing `;` (mermaid's optional separator; titles may contain one).
fn clean(line: &str) -> &str {
	let trimmed = trim(line);
	trim_end(trimmed.strip_suffix(';').unwrap_or(trimmed))
}

struct Endpoint {
	id: String,
	label: String,
}

fn parse_endpoint(text: &str) -> Option<Endpoint> {
	let caps = ENDPOINT_RE.captures(trim(text))?;
	let id = caps.get(1).filter(|id| !id.is_empty())?;
	let raw = caps.get(2).or_else(|| caps.get(3)).or_else(|| caps.get(4)).unwrap_or_default();
	let mut label = trim(&raw).to_owned();
	// `id["title"]` is idiomatic mermaid, so the quote pair is not part of the title.
	let quoted = label.chars().count() >= 2 && ((label.starts_with('"') && label.ends_with('"')) || (label.starts_with('\'') && label.ends_with('\'')));
	if quoted {
		let inner = &label[1..label.len() - 1];
		label = trim(inner).to_owned();
	}
	Some(Endpoint { id, label })
}

/// Collects every problem, never just the first.
pub fn parse_mermaid_plan(mermaid: &str) -> Result<ParsedPlan, Vec<String>> {
	let lines: Vec<String> = LINE_BREAK_RE.split(mermaid).into_iter().flatten().collect();
	let Some(first) = lines.iter().position(|l| !trim(l).is_empty() && !trim(l).starts_with("%%")) else {
		return Err(vec!["The plan is empty \u{2014} expected a `graph TD` block with nodes and `-->` requires-edges.".to_owned()]);
	};
	let mut problems: Vec<String> = Vec::new();
	let header = clean(&lines[first]);
	if !HEADER_RE.test(header) {
		problems.push(format!("line {}: expected the header `graph TD` (or flowchart TD/TB) first, got `{header}`.", first + 1));
	}

	let mut titles: Vec<(String, String)> = Vec::new();
	let mut edges: Vec<Json> = Vec::new();
	let mut seen_edges: Vec<String> = Vec::new();

	let mut register = |ep: &Endpoint, line_no: usize, problems: &mut Vec<String>| {
		if !SLUG_RE.test(&ep.id) {
			problems.push(format!(
				"line {line_no}: node id `{}` must be a lowercase slug (a-z, 0-9, joined by hyphens or underscores \u{2014} e.g. `chain-rule-intuition`); ids are permanent and checks reference them.",
				ep.id
			));
			return;
		}
		match titles.iter_mut().find(|(id, _)| *id == ep.id) {
			None => titles.push((ep.id.clone(), if ep.label.is_empty() { ep.id.clone() } else { ep.label.clone() })),
			Some((id, title)) => {
				if !ep.label.is_empty() && title == id {
					*title = ep.label.clone();
				}
			}
		}
	};

	for (i, raw) in lines.iter().enumerate().skip(first + 1) {
		let line = clean(raw);
		let no = i + 1;
		if line.is_empty() || line.starts_with("%%") {
			continue;
		}
		// Edges, chains included: every segment is an endpoint and consecutive pairs are edges.
		let segments: Vec<String> = ARROW_RE.split(line).into_iter().flatten().collect();
		if segments.len() >= 2 {
			let mut endpoints: Vec<Endpoint> = Vec::new();
			let mut unreadable = false;
			for seg in &segments {
				match parse_endpoint(seg) {
					Some(ep) => endpoints.push(ep),
					None => {
						problems.push(format!("line {no}: can't read the edge `{line}` \u{2014} expected `a[title] --> b[title]` (chains like `a --> b --> c` are fine)."));
						unreadable = true;
						break;
					}
				}
			}
			if unreadable {
				continue;
			}
			for ep in &endpoints {
				register(ep, no, &mut problems);
			}
			for pair in endpoints.windows(2) {
				let (from, to) = (&pair[0].id, &pair[1].id);
				if from == to {
					problems.push(format!("line {no}: self-loop `{from} --> {to}` \u{2014} a node can't require itself."));
					continue;
				}
				let key = format!("{from}->{to}");
				if !seen_edges.contains(&key) {
					seen_edges.push(key);
					edges.push(json!({ "from": from, "to": to }));
				}
			}
		} else {
			let Some(node) = parse_endpoint(line) else {
				problems.push(format!(
					"line {no}: can't parse `{line}` \u{2014} ids are the strict part (lowercase slugs: a-z, 0-9, hyphens, underscores); node lines (`slug[title]`) and requires-edges (`a --> b`) are the accepted forms; subgraphs, styles, and spaces are not part of the subset."
				));
				continue;
			};
			register(&node, no, &mut problems);
		}
	}

	if !problems.is_empty() {
		return Err(problems);
	}
	if titles.is_empty() {
		return Err(vec!["No nodes found \u{2014} the plan needs at least one.".to_owned()]);
	}
	Ok(ParsedPlan { nodes: titles.into_iter().map(|(id, title)| json!({ "id": id, "title": title })).collect(), edges })
}

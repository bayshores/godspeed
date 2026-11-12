//! What a cheat sheet request says to the agent (cheat-sheet.ts).

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use gs_base::{locale, re::Re, text};
use gs_json::{Json, js_number, json};

use super::cheat_sheet::{page_size_label, region_text};
use super::items;

/// Most mistakes sent to the agent, and their length.
const MISTAKES_MAX: usize = 6;
const MISTAKE_CHARS: i64 = 160;
/// Most info files named in a request: the syllabus first, the rest counted.
const INFO_FILES_NAMED: usize = 8;
/// Most working folder files named in a request.
const FOLDER_FILES_NAMED: usize = 12;
/// The chat a request carries: its last few messages, each cut short.
const EARLIER_SENT: usize = 8;
const EARLIER_CHARS: i64 = 500;
const ABOUT_CHARS: i64 = 1500;

/// One line of at most `max` UTF-16 units, cut with an ellipsis.
fn one_line(raw: &str, max: i64) -> String {
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	let line = text::trim(&SPACES.replace(raw, " ")).to_owned();
	if text::len16(&line) as i64 <= max { line } else { format!("{}\u{2026}", text::slice16(&line, 0, Some(max - 1))) }
}

fn topic_in<'a>(topic_ids: &'a [Json], wanted: &HashSet<&str>) -> Option<&'a str> {
	topic_ids.iter().filter_map(Json::as_str).find(|t| wanted.contains(t))
}

/// The mistakes in the deadline's topics, newest first, each question once, at most 6.
/// `answers` are `{ text, kind: "wrong" | "hint", at, topicIds }`; a mistake is `{ topicId, text,
/// kind, at }`.
pub fn sheet_mistakes(answers: &[Json], topic_ids: &[String]) -> Vec<Json> {
	static SPACES: LazyLock<Re> = LazyLock::new(|| Re::new(r"\s+", "g"));
	let wanted: HashSet<&str> = topic_ids.iter().map(String::as_str).collect();
	let mut seen: HashSet<String> = HashSet::new();
	let mut newest_first: Vec<&Json> = answers.iter().collect();
	newest_first.sort_by(|x, y| locale::compare(y["at"].as_str().unwrap_or(""), x["at"].as_str().unwrap_or("")));
	let mut out = Vec::new();
	for a in newest_first {
		let line = text::trim(&SPACES.replace(a["text"].as_str().unwrap_or(""), " ")).to_owned();
		let Some(topic_id) = topic_in(items(&a["topicIds"]), &wanted) else { continue };
		if line.is_empty() || !seen.insert(line.clone()) {
			continue;
		}
		out.push(json!({ "topicId": topic_id, "text": one_line(&line, MISTAKE_CHARS), "kind": a["kind"], "at": a["at"] }));
	}
	out.truncate(MISTAKES_MAX);
	out
}

/// Every mistake counted for the first of the deadline's topics it is in (a question missed twice
/// counts twice). `answers` need `topicIds`.
pub fn mistake_counts(answers: &[Json], topic_ids: &[String]) -> HashMap<String, usize> {
	let wanted: HashSet<&str> = topic_ids.iter().map(String::as_str).collect();
	let mut out = HashMap::new();
	for a in answers {
		if let Some(topic_id) = topic_in(items(&a["topicIds"]), &wanted) {
			*out.entry(topic_id.to_owned()).or_default() += 1;
		}
	}
	out
}

fn status_words(status: &str) -> &'static str {
	match status {
		"weak" => "weak",
		"shaky" => "shaky",
		"untested" => "not tested yet",
		"strong" => "knows it well",
		_ => "undefined",
	}
}

fn named_list(names: &[&str], max: usize) -> String {
	let rest = names.len().saturating_sub(max);
	let head = names[..names.len().min(max)].join(", ");
	if rest > 0 { format!("{head}, and {rest} more") } else { head }
}

fn info_file_list(files: &[&str]) -> String {
	static RULES_FILE: LazyLock<Re> = LazyLock::new(|| Re::new(r"syllabus|polic", "i"));
	let mut sorted = files.to_vec();
	sorted.sort_by_key(|f| !RULES_FILE.test(f));
	named_list(&sorted, INFO_FILES_NAMED)
}

fn folder_text(r: &Json, current: Option<&Json>) -> String {
	let names: Vec<&str> = items(&r["folder"]["files"]).iter().filter_map(Json::as_str).collect();
	let files = if names.is_empty() { "It is empty.".to_owned() } else { format!("It has: {}.", named_list(&names, FOLDER_FILES_NAMED)) };
	let path = r["folder"]["path"].as_str().unwrap_or("");
	match current {
		None => format!("Working folder: {path}\n{files} There is no sheet yet. Keep its source here so later changes can edit it."),
		Some(v) => format!(
			"Working folder: {path}\n{files} The sheet now is version {} ({}), made from the source here. To change it, edit that source and keep the rest as it is.",
			number(&v["n"]),
			page_size_label(items(&v["pages"]))
		),
	}
}

fn number(v: &Json) -> String {
	v.as_f64().map_or_else(String::new, js_number)
}

fn earlier_text(messages: &[Json]) -> String {
	let lines: Vec<String> = messages[messages.len().saturating_sub(EARLIER_SENT)..]
		.iter()
		.map(|m| {
			let said = one_line(m["text"].as_str().unwrap_or(""), EARLIER_CHARS);
			if m["role"].as_str() == Some("you") {
				return format!("Learner: {}", if said.is_empty() { "(files only)" } else { &said });
			}
			let made = if m["version"].truthy() { format!("[made version {}]", number(&m["version"])) } else { String::new() };
			format!("You: {}", [said, made].into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" "))
		})
		.collect();
	if lines.is_empty() { String::new() } else { format!("The chat so far, oldest first:\n{}", lines.join("\n")) }
}

fn about_text(a: &Json) -> String {
	let what = if a["kind"].as_str() == Some("problem") { "problem" } else { "question" };
	let work = a["work"].as_str().map(text::trim).filter(|w| !w.is_empty()).map(|w| format!("What they have written for it so far:\n{}", text::slice16(w, 0, Some(ABOUT_CHARS))));
	[
		format!("The student is on this {what} in their session \"{}\", with the sheet open beside it:", a["session"].as_str().unwrap_or("")),
		one_line(a["text"].as_str().unwrap_or(""), ABOUT_CHARS),
		work.unwrap_or_default(),
	]
	.into_iter()
	.filter(|p| !p.is_empty())
	.collect::<Vec<_>>()
	.join("\n")
}

fn region_line(r: &Json, versions: &[Json], current: Option<&Json>) -> String {
	let pages = versions.iter().find(|v| v["n"] == r["n"]).map_or(1, |v| items(&v["pages"]).len());
	let older = match current {
		Some(c) if r["n"] != c["n"] => format!(" That is an older version; the sheet now is version {}.", number(&c["n"])),
		_ => String::new(),
	};
	format!("They pointed at version {}, {}. The first picture shows that part.{older}", number(&r["n"]), region_text(r, pages))
}

fn topic_lines(t: &Json, first_sheet: bool) -> String {
	let mistakes = t["mistakes"].as_f64().unwrap_or(0.0);
	let count = if mistakes > 0.0 { format!(", {} {}", js_number(mistakes), if mistakes == 1.0 { "mistake" } else { "mistakes" }) } else { String::new() };
	let mut lines = vec![format!("{} | {}{count}", t["name"].as_str().unwrap_or(""), status_words(t["status"].as_str().unwrap_or("")))];
	// Facts go with the first sheet only: after that the sheet holds them, and each message stays short.
	if first_sheet {
		lines.extend(items(&t["facts"]).iter().map(|f| format!("  - {}: {}", f["name"].as_str().unwrap_or(""), one_line(f["statement"].as_str().unwrap_or(""), 140))));
	}
	lines.join("\n")
}

/// The request's text: the exam, the sheet's rules, the topics with readiness and facts, the
/// mistakes, the working folder, the chat so far, what the learner is on and points at, and their
/// message last.
///
/// `r` is `{ title, date, spaceNotes, infoFiles, rules, topics, mistakes, folder: { path, files },
/// versions, earlier, message }`; a topic is `{ id, name, status, mistakes, facts: [{ name,
/// statement }] }`.
pub fn cheat_sheet_request_text(r: &Json) -> String {
	let names: HashMap<&str, &str> = items(&r["topics"]).iter().filter_map(|t| Some((t["id"].as_str()?, t["name"].as_str()?))).collect();
	let versions = items(&r["versions"]);
	let current = versions.last();
	let m = &r["message"];
	let info_files: Vec<&str> = items(&r["infoFiles"]).iter().filter_map(Json::as_str).collect();
	let space_notes = r["spaceNotes"].as_str().filter(|n| !n.is_empty());

	let header = [
		format!("Cheat sheet for: {} on {}", r["title"].as_str().unwrap_or(""), r["date"].as_str().unwrap_or("")),
		space_notes.map(|n| format!("About the space: {}", one_line(n, 300))).unwrap_or_default(),
		if info_files.is_empty() { "The space has no space info files; search all its files for the rules.".to_owned() } else { format!("Space info files (the rules are likely here): {}", info_file_list(&info_files)) },
	]
	.into_iter()
	.filter(|p| !p.is_empty())
	.collect::<Vec<_>>()
	.join("\n");

	let rules = items(&r["rules"]);
	let topics = items(&r["topics"]);
	let mistakes = items(&r["mistakes"]);
	let sections = [
		header,
		if rules.is_empty() { String::new() } else { format!("This sheet's rules (follow every one):\n{}", rules.iter().map(|x| format!("- {}", x["text"].as_str().unwrap_or(""))).collect::<Vec<_>>().join("\n")) },
		if topics.is_empty() {
			String::new()
		} else {
			format!(
				"Topics on this exam (name | how the learner does){}:\n{}",
				if current.is_some() { "" } else { ", with some of the space's facts" },
				topics.iter().map(|t| topic_lines(t, current.is_none())).collect::<Vec<_>>().join("\n")
			)
		},
		if mistakes.is_empty() {
			String::new()
		} else {
			let line = |x: &Json| {
				let topic_id = x["topicId"].as_str().unwrap_or("");
				format!("- {} ({}): \"{}\"", if x["kind"].as_str() == Some("hint") { "needed hints" } else { "answered wrong" }, names.get(topic_id).copied().unwrap_or(topic_id), x["text"].as_str().unwrap_or(""))
			};
			format!("Mistakes from practice:\n{}", mistakes.iter().map(line).collect::<Vec<_>>().join("\n"))
		},
		folder_text(r, current),
		earlier_text(items(&r["earlier"])),
		if m["about"].truthy() { about_text(&m["about"]) } else { String::new() },
		if m["region"].truthy() { region_line(&m["region"], versions, current) } else { String::new() },
		{
			let said = text::trim(m["text"].as_str().unwrap_or(""));
			format!("The learner says:\n{}", if said.is_empty() { "(no words, only the files)" } else { said })
		},
	];
	sections.into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("\n\n")
}

#[cfg(test)]
mod tests {
	use super::*;

	fn answer(text: &str, kind: &str, at: &str, topics: &[&str]) -> Json {
		json!({ "text": text, "kind": kind, "at": at, "topicIds": topics })
	}

	#[test]
	fn mistakes_are_newest_first_once_each_and_limited_to_the_exam() {
		let answers = [
			answer("Old   question", "wrong", "2026-01-01", &["t1"]),
			answer("Other topic", "wrong", "2026-01-02", &["t9"]),
			answer("New question", "hint", "2026-01-03", &["t9", "t2"]),
			answer("Old question", "hint", "2026-01-04", &["t1"]),
			answer("  ", "wrong", "2026-01-05", &["t1"]),
		];
		let wanted = ["t1", "t2"].map(String::from);
		let got = sheet_mistakes(&answers, &wanted);
		assert_eq!(gs_json::stringify(&Json::from(got)), r#"[{"topicId":"t1","text":"Old question","kind":"hint","at":"2026-01-04"},{"topicId":"t2","text":"New question","kind":"hint","at":"2026-01-03"}]"#);
		let counts = mistake_counts(&answers, &wanted);
		assert_eq!((counts["t1"], counts["t2"], counts.len()), (3, 1, 2));
		assert_eq!(one_line(&"x".repeat(200), 160).len(), 162);
	}

	#[test]
	fn the_first_request_lists_facts_and_a_later_one_the_chat() {
		let r = json!({
			"title": "CSE 21 Midterm", "date": "2026-11-20", "spaceNotes": "Uses  Rosen.",
			"infoFiles": ["notes.pdf", "Syllabus.pdf"],
			"rules": [{ "text": "A4", "at": "t" }],
			"topics": [{ "id": "t1", "name": "Sums", "status": "weak", "mistakes": 2, "facts": [{ "name": "Gauss", "statement": "1+2+...+n" }] }],
			"mistakes": [{ "topicId": "t1", "text": "What is 1+1?", "kind": "wrong", "at": "t" }],
			"folder": { "path": "/g/CSE", "files": [] },
			"versions": [],
			"earlier": [],
			"message": { "id": "m", "role": "you", "text": " make it ", "at": "t" }
		});
		let first = cheat_sheet_request_text(&r);
		assert_eq!(
			first,
			"Cheat sheet for: CSE 21 Midterm on 2026-11-20\nAbout the space: Uses Rosen.\nSpace info files (the rules are likely here): Syllabus.pdf, notes.pdf\n\nThis sheet's rules (follow every one):\n- A4\n\nTopics on this exam (name | how the learner does), with some of the space's facts:\nSums | weak, 2 mistakes\n  - Gauss: 1+2+...+n\n\nMistakes from practice:\n- answered wrong (Sums): \"What is 1+1?\"\n\nWorking folder: /g/CSE\nIt is empty. There is no sheet yet. Keep its source here so later changes can edit it.\n\nThe learner says:\nmake it"
		);
		let page = json!({ "widthPt": 612, "heightPt": 792 });
		let mut r = r.as_obj().cloned().unwrap();
		r.insert("versions", json!([{ "n": 2, "prompt": "p", "at": "t", "pages": [page] }]));
		r.insert("earlier", json!([{ "role": "you", "text": "", "files": [] }, { "role": "agent", "text": "Done", "version": 2 }]));
		r.insert("message", json!({ "text": "", "region": { "n": 1, "page": 1, "x": 0.1, "y": 0.1, "w": 0.3, "h": 0.2 }, "about": { "kind": "problem", "session": "HW 4", "text": "Find x", "work": " x = 2 " } }));
		let later = cheat_sheet_request_text(&Json::Obj(r));
		assert!(later.contains("Topics on this exam (name | how the learner does):\nSums | weak, 2 mistakes\n\n"));
		assert!(later.contains("It is empty. The sheet now is version 2 (Letter, one side), made from the source here."));
		assert!(later.contains("The chat so far, oldest first:\nLearner: (files only)\nYou: Done [made version 2]\n\n"));
		assert!(later.contains("The student is on this problem in their session \"HW 4\", with the sheet open beside it:\nFind x\nWhat they have written for it so far:\nx = 2\n\n"));
		assert!(later.contains("They pointed at version 1, page 1, from 10% to 40% across and 10% to 30% down. The first picture shows that part. That is an older version; the sheet now is version 2.\n\n"));
		assert!(later.ends_with("The learner says:\n(no words, only the files)"));
	}
}

//! The cheat sheet: the notes a space lets the learner bring to a deadline, one per deadline
//! (cheat-sheet.ts). The sheet is a PDF made by the agent, with a chat, its last few versions
//! and its rules.
//!
//! Records stay JSON, in the key order the file keeps:
//!  - sheet: `{ deadlineId, versions, messages, rules[, folder][, olderFormat], updatedAt }`
//!  - version: `{ n, prompt, at, pages[, file][, fromFolder] }`, page `{ widthPt, heightPt }`
//!  - rule: `{ text, at }`
//!  - region: `{ n, page, x, y, w, h }`, fractions of the page from its top left corner

use std::sync::LazyLock;

use gs_base::{num, re::Re, time};
use gs_json::{Json, Obj, js_number, json};

use super::items;
use crate::spaces::space_shortcuts::safe_entry_name;
use crate::records::teaching_areas::{RULE_MAX_CHARS, RULES_MAX, one_line};

pub use super::sheet_cards::sheet_cards;
pub use super::sheet_parse::{ParsedSheet, parse_cheat_sheet, sheet_about_of, sheet_region_of};
pub use super::sheet_request::{cheat_sheet_request_text, mistake_counts, sheet_mistakes};

/// The record format this build writes, stamped as "version" (3 kept the learner's asks without
/// replies, 2 was the HTML sheet, 1 the fixed-option block sheet).
pub const CHEAT_SHEET_FORMAT: u32 = 4;
/// Most pages a sheet has.
pub const MAX_PAGES: usize = 4;
/// Longest message to the agent, in characters.
pub const PROMPT_MAX: usize = 2000;

/// Smallest and largest page side, in inches.
const PAGE_MIN_IN: f64 = 2.0;
const PAGE_MAX_IN: f64 = 17.0;
const PDF_MAX_BYTES: u64 = 20 * 1024 * 1024;
const MESSAGES_KEPT: usize = 100;
/// Versions kept on the canvas: enough to compare, few enough to stay light.
const VERSIONS_KEPT: usize = 5;

pub fn new_cheat_sheet(deadline_id: &str, now: &str) -> Json {
	json!({ "deadlineId": deadline_id, "versions": [], "messages": [], "rules": [], "updatedAt": now })
}

/// `sheet` with `key` set to `value`, keeping the key's place.
fn with_field(sheet: &Json, key: &str, value: Json) -> Json {
	let mut o = sheet.as_obj().cloned().unwrap_or_else(Obj::new);
	o.insert(key, value);
	Json::Obj(o)
}

/// The last `max` of `list`.
fn last_of(list: &[Json], max: usize) -> Vec<Json> {
	list[list.len().saturating_sub(max)..].to_vec()
}

/// The sheet with one more message in its chat.
pub fn with_message(sheet: &Json, message: &Json) -> Json {
	let mut all = items(&sheet["messages"]).to_vec();
	all.push(message.clone());
	with_field(sheet, "messages", Json::from(last_of(&all, MESSAGES_KEPT)))
}

/// The sheet with new rules kept (cleaned, each once, at most `RULES_MAX`), and the ones that
/// were new.
pub fn with_rules(sheet: &Json, texts: &[String], at: &str) -> (Json, Vec<String>) {
	let mut have: Vec<String> = items(&sheet["rules"]).iter().map(|r| r["text"].as_str().unwrap_or("").to_lowercase()).collect();
	let kept = items(&sheet["rules"]).len();
	let mut added: Vec<String> = Vec::new();
	for raw in texts {
		let text = one_line(raw, RULE_MAX_CHARS);
		if text.is_empty() || have.contains(&text.to_lowercase()) || kept + added.len() >= RULES_MAX {
			continue;
		}
		have.push(text.to_lowercase());
		added.push(text);
	}
	if added.is_empty() {
		return (sheet.clone(), added);
	}
	let mut rules = items(&sheet["rules"]).to_vec();
	rules.extend(added.iter().map(|text| json!({ "text": text, "at": at })));
	(with_field(sheet, "rules", Json::from(rules)), added)
}

pub fn without_rule(sheet: &Json, text: &str) -> Json {
	let rules: Vec<Json> = items(&sheet["rules"]).iter().filter(|r| r["text"].as_str() != Some(text)).cloned().collect();
	with_field(sheet, "rules", Json::from(rules))
}

/// The newest version, or None before the first.
pub fn current_version(sheet: &Json) -> Option<&Json> {
	items(&sheet["versions"]).last()
}

/// The sheet with a new version (`{ prompt, at, pages[, file][, fromFolder] }`) as its newest,
/// and the numbers of the versions that no longer fit (their files go).
pub fn with_version(sheet: &Json, version: &Json) -> (Json, Vec<f64>) {
	let n = current_version(sheet).and_then(|v| v["n"].as_f64()).unwrap_or(0.0) + 1.0;
	let mut all = items(&sheet["versions"]).to_vec();
	all.push(with_field(version, "n", Json::from(n)));
	let cut = all.len().saturating_sub(VERSIONS_KEPT);
	let dropped: Vec<f64> = all[..cut].iter().filter_map(|v| v["n"].as_f64()).collect();
	let mut next = sheet.as_obj().cloned().unwrap_or_else(Obj::new);
	next.remove("olderFormat");
	next.insert("versions", Json::from(all[cut..].to_vec()));
	next.insert("updatedAt", version["at"].clone());
	(Json::Obj(next), dropped)
}

/// Why a PDF the agent sent can't be the sheet, or None. Checks what it is given: the size alone
/// before the file is read, then the head, then the pages (`{ widthPt, heightPt }`).
pub fn pdf_problem(bytes: u64, head: Option<&str>, pages: Option<&[Json]>) -> Option<String> {
	if bytes > PDF_MAX_BYTES {
		return Some(format!("The PDF is {} MB; keep it under {} MB.", (bytes as f64 / 1024.0 / 1024.0).ceil(), PDF_MAX_BYTES / 1024 / 1024));
	}
	if head.is_some_and(|h| !h.starts_with("%PDF-")) {
		return Some("That file is not a PDF.".to_owned());
	}
	let pages = pages?;
	if pages.is_empty() || pages.len() > MAX_PAGES {
		return Some(format!("The PDF has {} pages; a cheat sheet has 1 to {MAX_PAGES}.", pages.len()));
	}
	let side = |pt: Option<f64>| pt.is_some_and(|pt| (PAGE_MIN_IN * 72.0..=PAGE_MAX_IN * 72.0).contains(&pt));
	let fits = pages.iter().all(|p| side(p["widthPt"].as_f64()) && side(p["heightPt"].as_f64()));
	(!fits).then(|| format!("Each page must be between {PAGE_MIN_IN} and {PAGE_MAX_IN} inches on each side."))
}

/// The working folder's name: "CSE 21 Midterm", safe on every OS.
pub fn sheet_folder_name(space_name: &str, deadline_name: &str) -> String {
	safe_entry_name(&format!("{space_name} {deadline_name}"))
}

/// The PDF in the working folder that is newer than the current version (the learner changed the
/// sheet outside godspeed), or None: the newest PDF there, when it was written after the current
/// version was kept. `files` are `(name, mtime in ms)`; `current_at` is the current version's time.
pub fn newer_folder_pdf(files: &[(String, f64)], current_at: Option<&str>) -> Option<String> {
	static PDF: LazyLock<Re> = LazyLock::new(|| Re::new(r"\.pdf$", "i"));
	// The copies Show in Finder writes into the working folder.
	static SHOWN_COPY: LazyLock<Re> = LazyLock::new(|| Re::new(r"^cheat sheet v\d+\.pdf$", "i"));
	let mut newest: Option<&(String, f64)> = None;
	for f in files.iter().filter(|f| PDF.test(&f.0) && !SHOWN_COPY.test(&f.0)) {
		if newest.is_none_or(|n| f.1 > n.1) {
			newest = Some(f);
		}
	}
	let newest = newest?;
	let newer = match current_at {
		None => true,
		Some(at) => time::parse_date(at).is_some_and(|ms| newest.1 > ms as f64),
	};
	newer.then(|| newest.0.clone())
}

/// Why a box isn't on a kept version's page, or None.
pub fn region_problem(region: &Json, versions: &[Json]) -> Option<&'static str> {
	let page = region["page"].as_f64().filter(|p| p.fract() == 0.0);
	let pages = versions.iter().find(|v| v["n"] == region["n"]).map(|v| items(&v["pages"]).len());
	let (Some(pages), Some(page)) = (pages, page) else { return Some("That version of the sheet is gone. Point at it again.") };
	if page < 1.0 || page > pages as f64 {
		return Some("That version of the sheet is gone. Point at it again.");
	}
	let fraction = |key: &str| region[key].as_f64().filter(|k| (0.0..=1.0).contains(k));
	if let (Some(x), Some(y), Some(w), Some(h)) = (fraction("x"), fraction("y"), fraction("w"), fraction("h"))
		&& w > 0.0
		&& h > 0.0
		&& x + w <= 1.001
		&& y + h <= 1.001
	{
		return None;
	}
	Some("That box isn't on the page.")
}

fn pct(f: f64) -> String {
	format!("{}%", js_number(num::math_round(f * 100.0)))
}

/// "page 1 (the front), from 10% to 40% across and 20% to 35% down".
pub fn region_text(region: &Json, pages: usize) -> String {
	let n = |key: &str| region[key].as_f64().unwrap_or(f64::NAN);
	let (page, x, y, w, h) = (n("page"), n("x"), n("y"), n("w"), n("h"));
	let side = if pages == 2 { format!(" (the {})", if page == 1.0 { "front" } else { "back" }) } else { String::new() };
	format!("page {}{side}, from {} to {} across and {} to {} down", js_number(page), pct(x), pct(x + w), pct(y), pct(y + h))
}

/// Paper sizes by name, upright; a card reads the same either way: `(name, width, height, card)`.
const NAMED_SIZES: [(&str, f64, f64, bool); 6] =
	[("Letter", 8.5, 11.0, false), ("A4", 8.27, 11.69, false), ("Legal", 8.5, 14.0, false), ("3 \u{d7} 5 card", 3.0, 5.0, true), ("4 \u{d7} 6 card", 4.0, 6.0, true), ("5 \u{d7} 8 card", 5.0, 8.0, true)];

fn near(a: f64, b: f64) -> bool {
	(a - b).abs() < 0.06
}

/// "A4, front and back", "Letter sideways, one side", "6 x 9 in, 3 pages" (named by the first page).
pub fn page_size_label(pages: &[Json]) -> String {
	let Some(first) = pages.first() else { return String::new() };
	let w = first["widthPt"].as_f64().unwrap_or(f64::NAN) / 72.0;
	let h = first["heightPt"].as_f64().unwrap_or(f64::NAN) / 72.0;
	let upright = NAMED_SIZES.iter().find(|s| near(s.1, w) && near(s.2, h));
	let turned = NAMED_SIZES.iter().find(|s| near(s.2, w) && near(s.1, h));
	let inches = |v: f64| js_number(num::math_round(v * 100.0) / 100.0);
	let size = match (upright, turned) {
		(Some(s), _) => s.0.to_owned(),
		(None, Some(s)) if s.3 => s.0.to_owned(),
		(None, Some(s)) => format!("{} sideways", s.0),
		(None, None) => format!("{} \u{d7} {} in", inches(w), inches(h)),
	};
	let n = pages.len();
	let sides = match n {
		1 => "one side".to_owned(),
		2 => "front and back".to_owned(),
		_ => format!("{n} pages"),
	};
	format!("{size}, {sides}")
}

#[cfg(test)]
mod tests {
	use super::*;

	fn page(w: f64, h: f64) -> Json {
		json!({ "widthPt": w, "heightPt": h })
	}

	fn version(prompt: &str, at: &str) -> Json {
		json!({ "prompt": prompt, "at": at, "pages": [page(612.0, 792.0)] })
	}

	#[test]
	fn a_new_sheet_has_the_files_key_order() {
		let sheet = new_cheat_sheet("ddl_1", "2026-11-10T00:00:00.000Z");
		assert_eq!(gs_json::stringify(&sheet), r#"{"deadlineId":"ddl_1","versions":[],"messages":[],"rules":[],"updatedAt":"2026-11-10T00:00:00.000Z"}"#);
	}

	#[test]
	fn versions_count_up_and_only_five_stay() {
		let mut sheet = new_cheat_sheet("d", "t0");
		sheet = with_field(&sheet, "olderFormat", Json::Bool(true));
		let mut dropped_all = Vec::new();
		for i in 1..=7 {
			let (next, dropped) = with_version(&sheet, &version("p", &format!("t{i}")));
			sheet = next;
			dropped_all.extend(dropped);
		}
		let ns: Vec<f64> = items(&sheet["versions"]).iter().map(|v| v["n"].as_f64().unwrap()).collect();
		assert_eq!(ns, [3.0, 4.0, 5.0, 6.0, 7.0]);
		assert_eq!(dropped_all, [1.0, 2.0]);
		assert!(sheet.get("olderFormat").is_none());
		assert_eq!(sheet["updatedAt"], Json::from("t7"));
		assert_eq!(current_version(&sheet).unwrap()["n"], Json::from(7));
		assert_eq!(gs_json::stringify(&sheet["versions"][4]), r#"{"prompt":"p","at":"t7","pages":[{"widthPt":612,"heightPt":792}],"n":7}"#);
	}

	#[test]
	fn messages_keep_the_last_hundred() {
		let mut sheet = new_cheat_sheet("d", "t");
		for i in 0..105 {
			sheet = with_message(&sheet, &json!({ "id": format!("m{i}"), "role": "you", "text": "x", "at": "t" }));
		}
		assert_eq!(items(&sheet["messages"]).len(), 100);
		assert_eq!(sheet["messages"][0]["id"], Json::from("m5"));
	}

	#[test]
	fn rules_are_cleaned_once_each_and_capped() {
		let sheet = new_cheat_sheet("d", "t");
		let texts = ["  A4,\n both sides ", "a4, both sides", "", "Big font"].map(String::from);
		let (sheet, added) = with_rules(&sheet, &texts, "now");
		assert_eq!(added, ["A4, both sides", "Big font"]);
		assert_eq!(gs_json::stringify(&sheet["rules"]), r#"[{"text":"A4, both sides","at":"now"},{"text":"Big font","at":"now"}]"#);
		let (same, none) = with_rules(&sheet, &["big font".to_owned()], "later");
		assert!(none.is_empty());
		assert_eq!(same, sheet);
		assert_eq!(items(&without_rule(&sheet, "Big font")["rules"]).len(), 1);
		let many: Vec<String> = (0..30).map(|i| format!("rule {i}")).collect();
		assert_eq!(with_rules(&new_cheat_sheet("d", "t"), &many, "now").1.len(), RULES_MAX);
	}

	#[test]
	fn pdf_checks_run_in_order() {
		assert_eq!(pdf_problem(21 * 1024 * 1024 - 5, None, None).unwrap(), "The PDF is 21 MB; keep it under 20 MB.");
		assert_eq!(pdf_problem(10, Some("<html"), None).unwrap(), "That file is not a PDF.");
		assert_eq!(pdf_problem(10, Some("%PDF-1.7"), None), None);
		assert_eq!(pdf_problem(10, None, Some(&[])).unwrap(), "The PDF has 0 pages; a cheat sheet has 1 to 4.");
		assert_eq!(pdf_problem(10, None, Some(&[page(612.0, 792.0)])), None);
		assert_eq!(pdf_problem(10, None, Some(&[page(100.0, 792.0)])).unwrap(), "Each page must be between 2 and 17 inches on each side.");
	}

	#[test]
	fn a_pdf_written_after_the_current_version_is_newer() {
		let files = [("old.pdf".to_owned(), 100.0), ("Cheat Sheet v3.pdf".to_owned(), 900.0), ("notes.txt".to_owned(), 950.0), ("new.PDF".to_owned(), 500.0)];
		let at = "1970-01-01T00:00:00.300Z";
		assert_eq!(newer_folder_pdf(&files, Some(at)).as_deref(), Some("new.PDF"));
		assert_eq!(newer_folder_pdf(&files, None).as_deref(), Some("new.PDF"));
		assert_eq!(newer_folder_pdf(&files, Some("1970-01-01T00:00:01.000Z")), None);
		assert_eq!(newer_folder_pdf(&files, Some("not a date")), None);
		assert_eq!(newer_folder_pdf(&[], None), None);
	}

	#[test]
	fn regions_must_sit_on_a_kept_page() {
		let versions = [json!({ "n": 2, "pages": [page(612.0, 792.0), page(612.0, 792.0)] })];
		let region = |n: i64, page: i64, x: f64, w: f64| json!({ "n": n, "page": page, "x": x, "y": 0.1, "w": w, "h": 0.2 });
		assert_eq!(region_problem(&region(2, 2, 0.1, 0.5), &versions), None);
		assert_eq!(region_problem(&region(1, 1, 0.1, 0.5), &versions), Some("That version of the sheet is gone. Point at it again."));
		assert_eq!(region_problem(&region(2, 3, 0.1, 0.5), &versions), Some("That version of the sheet is gone. Point at it again."));
		assert_eq!(region_problem(&region(2, 1, 0.8, 0.5), &versions), Some("That box isn't on the page."));
		assert_eq!(region_text(&region(2, 1, 0.1, 0.3), 2), "page 1 (the front), from 10% to 40% across and 10% to 30% down");
		assert_eq!(region_text(&region(2, 2, 0.1, 0.3), 1), "page 2, from 10% to 40% across and 10% to 30% down");
	}

	#[test]
	fn page_labels_name_the_first_page() {
		let letter = page(612.0, 792.0);
		assert_eq!(page_size_label(std::slice::from_ref(&letter)), "Letter, one side");
		assert_eq!(page_size_label(&[page(595.0, 842.0), page(595.0, 842.0)]), "A4, front and back");
		assert_eq!(page_size_label(&[page(792.0, 612.0)]), "Letter sideways, one side");
		assert_eq!(page_size_label(&[page(360.0, 216.0)]), "3 \u{d7} 5 card, one side");
		assert_eq!(page_size_label(&[page(432.0, 648.0), letter.clone(), letter]), "6 \u{d7} 9 in, 3 pages");
		assert_eq!(page_size_label(&[]), "");
	}

	#[test]
	fn the_folder_name_is_safe() {
		assert_eq!(sheet_folder_name("CSE 21", "Mid/term: 1"), "CSE 21 Mid-term- 1");
	}
}

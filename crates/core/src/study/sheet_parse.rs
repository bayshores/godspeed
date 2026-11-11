//! Reading a saved cheat sheet record, whatever format wrote it (cheat-sheet.ts).

use gs_base::{text, time};
use gs_json::{Json, Obj, json};

use super::cheat_sheet::CHEAT_SHEET_FORMAT;
use super::items;

/// What a saved record reads as.
#[derive(Debug, PartialEq)]
pub enum ParsedSheet {
	Sheet(Json),
	/// A newer build wrote it: shown, never changed.
	Newer,
}

fn is_number(v: &Json) -> bool {
	v.as_f64().is_some_and(f64::is_finite)
}

/// `list(v, read)`: the items `read` accepts; none when `v` is not an array.
fn list(v: &Json, read: impl Fn(&Json) -> Option<Json>) -> Vec<Json> {
	items(v).iter().filter_map(read).collect()
}

fn read_version(v: &Json) -> Option<Json> {
	if v.as_obj().is_none() || !is_number(&v["n"]) || v["prompt"].as_str().is_none() || v["at"].as_str().is_none() || v["pages"].as_arr().is_none() {
		return None;
	}
	let pages: Vec<Json> = items(&v["pages"]).iter().filter(|p| is_number(&p["widthPt"]) && is_number(&p["heightPt"])).map(|p| json!({ "widthPt": p["widthPt"], "heightPt": p["heightPt"] })).collect();
	if pages.is_empty() {
		return None;
	}
	let mut o = Obj::new();
	o.insert("n", v["n"].clone());
	o.insert("prompt", v["prompt"].clone());
	o.insert("at", v["at"].clone());
	o.insert("pages", pages);
	if v["file"].as_str().is_some() {
		o.insert("file", v["file"].clone());
	}
	if v["fromFolder"].as_bool() == Some(true) {
		o.insert("fromFolder", true);
	}
	Some(Json::Obj(o))
}

/// A file: format 4 keeps `{ name, file }`, format 3 only the name.
fn read_file(v: &Json) -> Option<Json> {
	if v.as_str().is_some() {
		return Some(json!({ "name": v }));
	}
	v["name"].as_str()?;
	let mut o = Obj::new();
	o.insert("name", v["name"].clone());
	if v["file"].as_str().is_some() {
		o.insert("file", v["file"].clone());
	}
	Some(Json::Obj(o))
}

/// A region as sent or saved, or None when it isn't one.
pub fn sheet_region_of(v: &Json) -> Option<Json> {
	v.as_obj()?;
	let keys = ["n", "page", "x", "y", "w", "h"];
	keys.iter().all(|k| is_number(&v[*k])).then(|| Json::Obj(keys.iter().map(|k| (*k, v[*k].clone())).collect()))
}

/// A session's problem or question as sent or saved, or None.
pub fn sheet_about_of(v: &Json) -> Option<Json> {
	v.as_obj()?;
	if !matches!(v["kind"].as_str(), Some("problem" | "question")) || v["session"].as_str().is_none() || v["text"].as_str().is_none() {
		return None;
	}
	let mut o = Obj::new();
	for key in ["kind", "session", "text"] {
		o.insert(key, v[key].clone());
	}
	if v["work"].as_str().is_some() {
		o.insert("work", v["work"].clone());
	}
	Some(Json::Obj(o))
}

fn read_message(v: &Json) -> Option<Json> {
	if v.as_obj().is_none() || v["id"].as_str().is_none() || v["text"].as_str().is_none() || v["at"].as_str().is_none() {
		return None;
	}
	let mut o = Obj::new();
	for key in ["id", "role", "text", "at"] {
		o.insert(key, v[key].clone());
	}
	match v["role"].as_str() {
		Some("you") => {
			let files = list(&v["files"], read_file);
			if !files.is_empty() {
				o.insert("files", files);
			}
			if let Some(region) = sheet_region_of(&v["region"]) {
				o.insert("region", region);
			}
			if let Some(about) = sheet_about_of(&v["about"]) {
				o.insert("about", about);
			}
		}
		Some("agent") => {
			if is_number(&v["version"]) {
				o.insert("version", v["version"].clone());
			}
			let rules: Vec<Json> = items(&v["rules"]).iter().filter(|r| r.as_str().is_some()).cloned().collect();
			if !rules.is_empty() {
				o.insert("rules", rules);
			}
		}
		_ => return None,
	}
	Some(Json::Obj(o))
}

fn read_rule(v: &Json) -> Option<Json> {
	(v["text"].as_str().is_some() && v["at"].as_str().is_some()).then(|| json!({ "text": v["text"], "at": v["at"] }))
}

/// What formats 2 and 3 kept of the learner's asks, as the chat's first messages: each ask, then
/// the version made for it (kept at the same moment).
fn asked_before(prompts: &Json, versions: &[Json]) -> Vec<Json> {
	let asks = list(prompts, |v| {
		(v["text"].as_str().is_some() && v["at"].as_str().is_some()).then(|| json!({ "text": v["text"], "at": v["at"], "files": list(&v["files"], read_file) }))
	});
	let mut out = Vec::new();
	for (i, p) in asks.iter().enumerate() {
		let mut ask = json!({ "id": format!("asked-{i}"), "role": "you", "text": p["text"], "at": p["at"] });
		if let (false, Some(o)) = (items(&p["files"]).is_empty(), ask.as_obj_mut()) {
			o.insert("files", p["files"].clone());
		}
		out.push(ask);
		if let Some(made) = versions.iter().find(|v| v["at"] == p["at"]) {
			out.push(json!({ "id": format!("made-{i}"), "role": "agent", "text": "", "at": p["at"], "version": made["n"] }));
		}
	}
	out
}

/// Format 1's instructions, kept as its first message.
fn block_sheet_asks(raw: &Json, updated_at: &str) -> Vec<Json> {
	let instructions = raw["prefs"]["instructions"].as_str().map(text::trim).unwrap_or("");
	if instructions.is_empty() {
		return vec![];
	}
	let at = raw["confirmedAt"].as_str().unwrap_or(updated_at);
	vec![json!({ "id": "asked-0", "role": "you", "text": instructions, "at": at })]
}

/// A saved record: None when it isn't one, `Newer` when a newer build wrote it. Format 3's asks
/// become the chat's first messages. An HTML sheet (format 2) or block sheet (format 1) can't
/// become a PDF without the agent: its asks stay and it is marked `olderFormat` when it had a sheet.
pub fn parse_cheat_sheet(raw: &Json) -> Option<ParsedSheet> {
	raw.as_obj()?;
	let deadline_id = raw["deadlineId"].as_str()?;
	let version = raw["version"].as_f64().filter(|v| v.is_finite());
	if version.is_some_and(|v| v > f64::from(CHEAT_SHEET_FORMAT)) {
		return Some(ParsedSheet::Newer);
	}
	let updated_at = raw["updatedAt"].as_str().map_or_else(|| time::iso(0), str::to_owned);
	let current = version == Some(3.0) || version == Some(f64::from(CHEAT_SHEET_FORMAT));
	let (versions, messages, rules, folder, older_format) = if version == Some(2.0) {
		(vec![], asked_before(&raw["prompts"], &[]), vec![], None, raw["doc"].truthy())
	} else if !current {
		(vec![], block_sheet_asks(raw, &updated_at), vec![], None, !items(&raw["blocks"]).is_empty())
	} else {
		let versions = list(&raw["versions"], read_version);
		let messages = if version == Some(3.0) { asked_before(&raw["prompts"], &versions) } else { list(&raw["messages"], read_message) };
		let folder = raw["folder"].as_str().filter(|f| !f.is_empty());
		(versions, messages, list(&raw["rules"], read_rule), folder, raw["olderFormat"].as_bool() == Some(true))
	};
	let mut sheet = Obj::new();
	sheet.insert("deadlineId", deadline_id);
	sheet.insert("versions", versions);
	sheet.insert("messages", messages);
	sheet.insert("rules", rules);
	if let Some(folder) = folder {
		sheet.insert("folder", folder);
	}
	if older_format {
		sheet.insert("olderFormat", true);
	}
	sheet.insert("updatedAt", updated_at);
	Some(ParsedSheet::Sheet(Json::Obj(sheet)))
}

#[cfg(test)]
mod tests {
	use gs_json::{parse, stringify};

	use super::*;

	fn read(text: &str) -> Option<ParsedSheet> {
		parse_cheat_sheet(&parse(text).unwrap())
	}

	fn sheet(text: &str) -> String {
		match read(text) {
			Some(ParsedSheet::Sheet(s)) => stringify(&s),
			other => format!("{other:?}"),
		}
	}

	#[test]
	fn what_is_not_a_record_is_none_and_newer_builds_are_flagged() {
		assert_eq!(read("[]"), None);
		assert_eq!(read(r#"{"deadlineId":1}"#), None);
		assert_eq!(read(r#"{"deadlineId":"d","version":5}"#), Some(ParsedSheet::Newer));
	}

	#[test]
	fn format_four_keeps_what_is_well_formed() {
		let got = sheet(
			r#"{"deadlineId":"d","version":4,"folder":"CSE","updatedAt":"t",
			"versions":[{"n":1,"prompt":"p","at":"a","pages":[{"widthPt":1,"heightPt":2,"x":9},{"widthPt":"no"}],"file":"f","fromFolder":true},{"n":2,"prompt":"p","at":"a","pages":[]}],
			"messages":[{"id":"m1","role":"you","text":"hi","at":"a","files":["x.png",{"name":"y.png","file":"f.png"},3],"region":{"n":1,"page":1,"x":0,"y":0,"w":1,"h":1},"about":{"kind":"bogus"}},
			{"id":"m2","role":"agent","text":"ok","at":"b","version":1,"rules":["r",1]},{"id":"m3","role":"robot","text":"","at":"c"}],
			"rules":[{"text":"t","at":"a"},{"text":"t"}],"olderFormat":true}"#,
		);
		assert_eq!(
			got,
			r#"{"deadlineId":"d","versions":[{"n":1,"prompt":"p","at":"a","pages":[{"widthPt":1,"heightPt":2}],"file":"f","fromFolder":true}],"messages":[{"id":"m1","role":"you","text":"hi","at":"a","files":[{"name":"x.png"},{"name":"y.png","file":"f.png"}],"region":{"n":1,"page":1,"x":0,"y":0,"w":1,"h":1}},{"id":"m2","role":"agent","text":"ok","at":"b","version":1,"rules":["r"]}],"rules":[{"text":"t","at":"a"}],"folder":"CSE","olderFormat":true,"updatedAt":"t"}"#
		);
	}

	#[test]
	fn format_three_turns_asks_into_chat_messages() {
		let got = sheet(r#"{"deadlineId":"d","version":3,"updatedAt":"u","versions":[{"n":1,"prompt":"p","at":"a","pages":[{"widthPt":1,"heightPt":2}]}],"prompts":[{"text":"first","at":"a","files":["x.png"]},{"text":"second","at":"z"}]}"#);
		assert_eq!(
			got,
			r#"{"deadlineId":"d","versions":[{"n":1,"prompt":"p","at":"a","pages":[{"widthPt":1,"heightPt":2}]}],"messages":[{"id":"asked-0","role":"you","text":"first","at":"a","files":[{"name":"x.png"}]},{"id":"made-0","role":"agent","text":"","at":"a","version":1},{"id":"asked-1","role":"you","text":"second","at":"z"}],"rules":[],"updatedAt":"u"}"#
		);
	}

	#[test]
	fn older_formats_keep_their_asks_and_say_they_had_a_sheet() {
		assert_eq!(sheet(r#"{"deadlineId":"d","version":2,"doc":{"a":1},"prompts":[{"text":"q","at":"a"}]}"#), r#"{"deadlineId":"d","versions":[],"messages":[{"id":"asked-0","role":"you","text":"q","at":"a"}],"rules":[],"olderFormat":true,"updatedAt":"1970-01-01T00:00:00.000Z"}"#);
		assert_eq!(
			sheet(r#"{"deadlineId":"d","blocks":[1],"prefs":{"instructions":"  big font "},"confirmedAt":"c","updatedAt":12}"#),
			r#"{"deadlineId":"d","versions":[],"messages":[{"id":"asked-0","role":"you","text":"big font","at":"c"}],"rules":[],"olderFormat":true,"updatedAt":"1970-01-01T00:00:00.000Z"}"#
		);
		assert_eq!(sheet(r#"{"deadlineId":"d","updatedAt":"u"}"#), r#"{"deadlineId":"d","versions":[],"messages":[],"rules":[],"updatedAt":"u"}"#);
	}
}

//! Every deadline of a class with its cheat sheet (cheat-sheet.ts: sheetCards).

use gs_base::locale;
use gs_json::{Json, Obj};

use super::cheat_sheet::{ParsedSheet, current_version};
use super::js_greater;

/// Every deadline of the class with its sheet: upcoming soonest first, then past ones, latest
/// first. A card is `{ deadlineId, name, kind, date[, time], past, status, version }`, with status
/// "made", "making", "older", "newer" or "none".
pub fn sheet_cards(deadlines: &[Json], sheet_of: impl Fn(&str) -> Option<ParsedSheet>, running: impl Fn(&str) -> bool, today: &str) -> Vec<Json> {
	let cards: Vec<(Json, bool)> = deadlines
		.iter()
		.map(|d| {
			let id = d["id"].as_str().unwrap_or("");
			let sheet = sheet_of(id);
			let version = match &sheet {
				Some(ParsedSheet::Sheet(s)) => current_version(s).cloned(),
				_ => None,
			};
			let status = if running(id) {
				"making"
			} else if sheet == Some(ParsedSheet::Newer) {
				"newer"
			} else if version.is_some() {
				"made"
			} else if matches!(&sheet, Some(ParsedSheet::Sheet(s)) if s["olderFormat"].truthy()) {
				"older"
			} else {
				"none"
			};
			let past = d["done"].truthy() || js_greater(today, d["date"].as_str().unwrap_or(""));
			let mut o = Obj::new();
			o.insert("deadlineId", d["id"].clone());
			o.insert("name", d["name"].clone());
			o.insert("kind", d["kind"].clone());
			o.insert("date", d["date"].clone());
			if d["time"].truthy() {
				o.insert("time", d["time"].clone());
			}
			o.insert("past", past);
			o.insert("status", status);
			o.insert("version", version);
			(Json::Obj(o), past)
		})
		.collect();
	let when = |c: &Json| format!("{} {}", c["date"].as_str().unwrap_or(""), c["time"].as_str().unwrap_or("23:59"));
	let mut upcoming: Vec<Json> = cards.iter().filter(|c| !c.1).map(|c| c.0.clone()).collect();
	upcoming.sort_by(|a, b| locale::compare(&when(a), &when(b)));
	let mut past: Vec<Json> = cards.into_iter().filter(|c| c.1).map(|c| c.0).collect();
	past.sort_by(|a, b| locale::compare(&when(b), &when(a)));
	upcoming.extend(past);
	upcoming
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn upcoming_soonest_first_then_past_latest_first() {
		let d = |id: &str, date: &str, time: Option<&str>, done: bool| {
			let mut o = json!({ "id": id, "name": id, "kind": "exam", "date": date, "done": done });
			if let Some(t) = time {
				o.as_obj_mut().unwrap().insert("time", t);
			}
			o
		};
		let deadlines = [d("late", "2026-12-01", None, false), d("early", "2026-11-12", Some("09:00"), false), d("old", "2026-11-01", None, false), d("older", "2026-10-01", None, false), d("done", "2027-01-01", None, true)];
		let made = json!({ "deadlineId": "early", "versions": [{ "n": 1 }], "messages": [], "rules": [], "updatedAt": "t" });
		let sheet_of = |id: &str| match id {
			"early" => Some(ParsedSheet::Sheet(made.clone())),
			"late" => Some(ParsedSheet::Newer),
			"old" => Some(ParsedSheet::Sheet(json!({ "olderFormat": true }))),
			_ => None,
		};
		let cards = sheet_cards(&deadlines, sheet_of, |id| id == "older", "2026-11-10");
		let got: Vec<String> = cards.iter().map(|c| format!("{}:{}", c["deadlineId"].as_str().unwrap(), c["status"].as_str().unwrap())).collect();
		assert_eq!(got, ["early:made", "late:newer", "done:none", "old:older", "older:making"]);
		assert_eq!(cards[0]["version"], json!({ "n": 1 }));
		assert_eq!(cards[0]["time"], Json::from("09:00"));
		assert_eq!(cards[1]["past"], Json::Bool(false));
	}
}

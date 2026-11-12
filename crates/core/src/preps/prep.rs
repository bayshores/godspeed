//! The rules of a prep sheet (prep.ts): reading a saved one, taking the sheet the teacher wrote,
//! the learner's own changes, and how solid each topic is from the answers tagged with it.
//!
//! A prep (`SpacePrep` in contracts/prep.ts) is `{goal, date?, about, sources[{title, url}],
//! topics[{id, name, why?}], mock?{questions, minutes}, writtenAt?}`; a topic's id is the plan
//! node of study sessions on it, so answers there (and in mocks) count for it.

use std::collections::HashSet;
use std::ops::RangeInclusive;
use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::text::{cmp16, slice16, trim, trim_end};
use gs_json::{Json, Obj, json};

use crate::contracts::space::is_calendar_date;
use crate::records::teaching_areas::one_line;
use crate::study::progress::{Tally, topic_status};
use crate::study::study::is_latest_wrong;

pub const GOAL_MAX: usize = 300;
const ABOUT_MAX: i64 = 4000;
const NAME_MAX: usize = 60;
pub const TOPIC_NAME_MAX: usize = 80;
const TOPIC_WHY_MAX: usize = 200;
pub const MAX_PREP_TOPICS: usize = 12;
const MAX_PREP_SOURCES: usize = 8;
pub const MOCK_QUESTIONS: RangeInclusive<i64> = 1..=10;
pub const MOCK_MINUTES: RangeInclusive<i64> = 5..=240;

fn mock_range() -> String {
	format!("mock must be {} to {} questions in {} to {} minutes.", MOCK_QUESTIONS.start(), MOCK_QUESTIONS.end(), MOCK_MINUTES.start(), MOCK_MINUTES.end())
}

fn items(v: &Json) -> &[Json] {
	v.as_arr().map_or(&[], Vec::as_slice)
}

/// Longest name a prep gets from its goal, before the sheet names it.
const GOAL_NAME_MAX: usize = 40;

/// A prep's name before its sheet is written: the goal, or when longer its whole words within
/// GOAL_NAME_MAX and "…", so its top bar tab stays short.
pub fn goal_name(goal: &str) -> String {
	let chars: Vec<char> = goal.chars().collect();
	if chars.len() <= GOAL_NAME_MAX {
		return goal.to_owned();
	}
	let head = &chars[..=GOAL_NAME_MAX];
	// One word longer than the limit is cut inside it.
	let kept: String = match head.iter().rposition(|&c| c == ' ') {
		Some(cut) if cut > 0 => head[..cut].iter().collect(),
		_ => chars[..GOAL_NAME_MAX].iter().collect(),
	};
	format!("{}…", trim_end(&kept))
}

/// A new prep, before its sheet is written. None when nothing was typed.
pub fn new_prep(goal: &str, date: Option<&str>) -> Option<Json> {
	let clean = one_line(goal, GOAL_MAX);
	if clean.is_empty() {
		return None;
	}
	let mut out = Obj::new();
	out.insert("goal", clean);
	if let Some(date) = date.filter(|d| is_calendar_date(&Json::from(*d))) {
		out.insert("date", date);
	}
	out.insert("about", "");
	out.insert("sources", json!([]));
	out.insert("topics", json!([]));
	Some(Json::Obj(out))
}

fn clean_sources(raw: &Json) -> Json {
	static LINK: LazyLock<Re> = LazyLock::new(|| Re::new(r"^https?:\/\/\S+$", "i"));
	let mut out: Vec<Json> = Vec::new();
	for s in items(raw) {
		let Some(url) = s["url"].as_str().filter(|_| s.as_obj().is_some()).map(trim).filter(|u| LINK.test(u)) else { continue };
		if out.iter().any(|o| o["url"].as_str() == Some(url)) {
			continue;
		}
		let title = one_line(s["title"].as_str().unwrap_or(""), 120);
		out.push(json!({ "title": if title.is_empty() { url.to_owned() } else { title }, "url": url }));
	}
	out.truncate(MAX_PREP_SOURCES);
	Json::Arr(out)
}

/// A whole number, as `Number.isInteger` sees it.
fn integer(v: &Json) -> Option<i64> {
	v.as_f64().filter(|n| n.is_finite() && n.fract() == 0.0).map(|n| n as i64)
}

fn clean_mock(raw: &Json) -> Option<Json> {
	raw.as_obj()?;
	let (questions, minutes) = (integer(&raw["questions"])?, integer(&raw["minutes"])?);
	(MOCK_QUESTIONS.contains(&questions) && MOCK_MINUTES.contains(&minutes)).then(|| json!({ "questions": raw["questions"].clone(), "minutes": raw["minutes"].clone() }))
}

/// `about` as kept: trimmed, at most ABOUT_MAX UTF-16 units.
fn clean_about(about: &str) -> String {
	slice16(trim(about), 0, Some(ABOUT_MAX))
}

/// A saved prep, cleaned; None when it isn't one.
pub fn parse_prep(raw: &Json) -> Option<Json> {
	static TOPIC_ID: LazyLock<Re> = LazyLock::new(|| Re::new(r"^pt_[a-z0-9]+$", ""));
	raw.as_obj()?;
	let mut out = new_prep(raw["goal"].as_str()?, raw["date"].as_str())?;
	let mut topics: Vec<Json> = Vec::new();
	for t in items(&raw["topics"]) {
		let (Some(id), Some(name)) = (t["id"].as_str().filter(|id| t.as_obj().is_some() && TOPIC_ID.test(id)), t["name"].as_str()) else { continue };
		let name = one_line(name, TOPIC_NAME_MAX);
		if name.is_empty() || topics.iter().any(|o| o["id"].as_str() == Some(id)) {
			continue;
		}
		topics.push(topic(id, name, &one_line(t["why"].as_str().unwrap_or(""), TOPIC_WHY_MAX)));
	}
	topics.truncate(MAX_PREP_TOPICS);
	let obj = out.as_obj_mut()?;
	obj.insert("about", raw["about"].as_str().map(clean_about).unwrap_or_default());
	obj.insert("sources", clean_sources(&raw["sources"]));
	obj.insert("topics", Json::Arr(topics));
	if let Some(mock) = clean_mock(&raw["mock"]) {
		obj.insert("mock", mock);
	}
	if raw["writtenAt"].as_str().is_some() {
		obj.insert("writtenAt", raw["writtenAt"].clone());
	}
	Some(out)
}

fn topic(id: &str, name: String, why: &str) -> Json {
	let mut out = Obj::new();
	out.insert("id", id);
	out.insert("name", name);
	if !why.is_empty() {
		out.insert("why", why);
	}
	Json::Obj(out)
}

/// Why a written sheet (`{name, about, sources, topics[{name, why?}], mock}`, as the teacher
/// sends it) can't be kept; None when it can.
pub fn sheet_problem(sheet: &Json) -> Option<String> {
	if one_line(sheet["name"].as_str().unwrap_or(""), NAME_MAX).is_empty() {
		return Some("name is empty: give the prep a short name.".to_owned());
	}
	if trim(sheet["about"].as_str().unwrap_or("")).is_empty() {
		return Some("about is empty: say what it is like.".to_owned());
	}
	if items(&sheet["topics"]).iter().all(|t| one_line(t["name"].as_str().unwrap_or(""), TOPIC_NAME_MAX).is_empty()) {
		return Some("topics is empty: list what to study, in order.".to_owned());
	}
	if clean_mock(&sheet["mock"]).is_none() {
		return Some(mock_range());
	}
	None
}

fn same_name(a: &str, b: &str) -> bool {
	a.to_lowercase() == b.to_lowercase()
}

fn name_of(t: &Json) -> &str {
	t["name"].as_str().unwrap_or("")
}

/// The prep with the teacher's sheet, and the teacher's name for it. A topic the old sheet had
/// under the same name keeps its id, so what the learner answered on it still counts, and an old
/// topic in `answered` the new sheet left out stays at its end, so no answer stops counting.
pub fn with_sheet(prep: &Json, sheet: &Json, at: &str, new_id: &mut dyn FnMut() -> String, answered: &HashSet<String>) -> (Json, String) {
	let named: Vec<(String, String)> = items(&sheet["topics"]).iter().map(|t| (one_line(name_of(t), TOPIC_NAME_MAX), one_line(t["why"].as_str().unwrap_or(""), TOPIC_WHY_MAX))).collect();
	let old = items(&prep["topics"]);
	let carried: Vec<Json> = old
		.iter()
		.filter(|o| o["id"].as_str().is_some_and(|id| answered.contains(id)) && !named.iter().any(|(name, _)| same_name(name, name_of(o))))
		.cloned()
		.collect();
	let mut topics: Vec<Json> = Vec::new();
	for (name, why) in named {
		if name.is_empty() || topics.iter().any(|o| same_name(name_of(o), &name)) || topics.len() + carried.len() >= MAX_PREP_TOPICS {
			continue;
		}
		let id = old.iter().find(|o| same_name(name_of(o), &name)).and_then(|o| o["id"].as_str().map(str::to_owned)).unwrap_or_else(&mut *new_id);
		topics.push(topic(&id, name, &why));
	}
	topics.extend(carried);
	let mut out = Obj::new();
	out.insert("goal", prep["goal"].clone());
	if prep["date"].truthy() {
		out.insert("date", prep["date"].clone());
	}
	out.insert("about", clean_about(sheet["about"].as_str().unwrap_or("")));
	out.insert("sources", clean_sources(&sheet["sources"]));
	out.insert("topics", Json::Arr(topics));
	if let Some(mock) = clean_mock(&sheet["mock"]) {
		out.insert("mock", mock);
	}
	out.insert("writtenAt", at);
	(Json::Obj(out), one_line(name_of(sheet), NAME_MAX))
}

/// The prep with the edits, or why they can't be made (then nothing changes). Edits are, each
/// only when given: `date` (null clears the day), `about`, `mock`, `addTopics` (`[{name, why?}]`,
/// added at the end in order) and `removeTopicIds`.
pub fn with_edits(prep: &Json, edits: &Json, new_id: &mut dyn FnMut() -> String) -> Result<Json, String> {
	let mut topics: Vec<Json> = items(&prep["topics"]).to_vec();
	for id in items(&edits["removeTopicIds"]) {
		let id = id.as_str().unwrap_or("");
		if !topics.iter().any(|t| t["id"].as_str() == Some(id)) {
			return Err(format!("No topic \"{id}\" on the sheet."));
		}
		topics.retain(|t| t["id"].as_str() != Some(id));
	}
	for t in items(&edits["addTopics"]) {
		let name = one_line(name_of(t), TOPIC_NAME_MAX);
		if name.is_empty() {
			return Err("A topic's name is empty.".to_owned());
		}
		if topics.iter().any(|o| same_name(name_of(o), &name)) {
			return Err(format!("\"{name}\" is already on the sheet."));
		}
		if topics.len() >= MAX_PREP_TOPICS {
			return Err(format!("The sheet is full ({MAX_PREP_TOPICS} topics). Remove one first."));
		}
		let why = one_line(t["why"].as_str().unwrap_or(""), TOPIC_WHY_MAX);
		topics.push(topic(&new_id(), name, &why));
	}
	if edits["date"].as_str().is_some() && !is_calendar_date(&edits["date"]) {
		return Err("date must be YYYY-MM-DD.".to_owned());
	}
	let about = edits["about"].as_str().map(clean_about);
	if edits.get("about").is_some() && about.as_deref().is_none_or(str::is_empty) {
		return Err("about is empty: say what it is like.".to_owned());
	}
	let mock = match edits.get("mock") {
		None => prep.get("mock").cloned(),
		Some(raw) => Some(clean_mock(raw).ok_or_else(mock_range)?),
	};
	let date = edits.get("date").or(prep.get("date")).cloned();
	// Like `{ ...rest, ...(date ? { date } : {}), ... }`: the day and the mock go to the end.
	let mut out = prep.as_obj().cloned().unwrap_or_default();
	out.remove("date");
	out.remove("mock");
	if let Some(date) = date.filter(Json::truthy) {
		out.insert("date", date);
	}
	if let Some(about) = about {
		out.insert("about", about);
	}
	out.insert("topics", Json::Arr(topics));
	if let Some(mock) = mock {
		out.insert("mock", mock);
	}
	Ok(Json::Obj(out))
}

/// Each topic with its track record: the answers (`{nodeId?, outcome, answeredAt}`) tagged with
/// its id (study sessions tag a question's plan node, mocks tag a question's topic). Adds
/// `status`, `latestWrong` (weak, and the newest answer on it was not right), `answered`, `right`
/// and `rate` (None before the first answer).
pub fn prep_topic_progress(topics: &[Json], answers: &[Json]) -> Vec<Json> {
	topics
		.iter()
		.map(|t| {
			let tagged: Vec<&Json> = answers.iter().filter(|a| a["nodeId"].as_str().is_some_and(|n| Some(n) == t["id"].as_str())).collect();
			let mine = Tally::of(tagged.iter().copied());
			let status = topic_status(mine.rate).as_str();
			let at = |a: &Json| a["answeredAt"].as_str().unwrap_or("").to_owned();
			let latest = tagged.iter().copied().fold(None::<&Json>, |l, a| if l.is_none_or(|l| cmp16(&at(a), &at(l)).is_ge()) { Some(a) } else { l });
			let mut out = t.as_obj().cloned().unwrap_or_default();
			out.insert("status", status);
			if is_latest_wrong(status, latest.and_then(|a| a["outcome"].as_str())) {
				out.insert("latestWrong", true);
			}
			out.insert("answered", mine.answered);
			out.insert("right", mine.right);
			out.insert("rate", mine.rate);
			Json::Obj(out)
		})
		.collect()
}

fn study_first(status: &Json) -> u8 {
	match status.as_str() {
		Some("weak") => 0,
		Some("shaky") => 1,
		Some("untested") => 2,
		_ => 3,
	}
}

/// The topics in the order to study them: the ones going badly first, then the ones not started,
/// the solid ones last; ties keep the sheet's order.
pub fn weakest_first(topics: &[Json]) -> Vec<Json> {
	let mut out = topics.to_vec();
	out.sort_by_key(|t| study_first(&t["status"]));
	out
}

/// How many topics one Study click takes on.
const STUDY_TOPIC_COUNT: usize = 3;

/// A study session's topics from the sheet: the ones named, in the sheet's order, or with none
/// named the few that most need work. A sheet topic has no material label (the topic grouper
/// never sees it), so the study prompt picks its move from where the learner stands alone.
pub fn prep_study_topics(topics: &[Json], topic_ids: &[String]) -> Vec<Json> {
	let picked: Vec<Json> = if topic_ids.is_empty() {
		weakest_first(topics).into_iter().take(STUDY_TOPIC_COUNT).collect()
	} else {
		topics.iter().filter(|t| t["id"].as_str().is_some_and(|id| topic_ids.iter().any(|i| i == id))).cloned().collect()
	};
	picked
		.iter()
		.map(|t| {
			let mut out = Obj::new();
			for key in ["id", "name", "status"] {
				out.insert(key, t[key].clone());
			}
			if t["latestWrong"].truthy() {
				out.insert("latestWrong", true);
			}
			out.insert("factIds", json!([]));
			Json::Obj(out)
		})
		.collect()
}

/// An attached file and where the sheet writer reads it.
pub struct RequestFile {
	pub name: String,
	pub path: String,
}

/// The sheet writer's request: the learner's words, the day, the files they attached, and the
/// topics the sheet already has.
pub fn prep_request_text(goal: &str, date: Option<&str>, today: &str, files: &[RequestFile], topics: &[Json]) -> String {
	let mut lines = vec![
		format!("They are preparing for: {goal}"),
		format!("Today is {today}. {}", date.map_or_else(|| "They have no date for it yet.".to_owned(), |d| format!("It is on {d}."))),
	];
	if !files.is_empty() {
		lines.extend(["".to_owned(), "They attached these files. Read them first:".to_owned()]);
		lines.extend(files.iter().map(|f| format!("- {}: {}", f.name, f.path)));
	}
	if !topics.is_empty() {
		lines.extend(["".to_owned(), "The sheet's topics now (keep a name where it still fits):".to_owned()]);
		lines.extend(topics.iter().map(|t| format!("- {}", name_of(t))));
	}
	lines.join("\n")
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	fn ids() -> impl FnMut() -> String {
		let mut n = 0;
		move || {
			n += 1;
			format!("pt_{n:08}")
		}
	}

	fn sheet() -> Json {
		json!({
			"name": "Acme junior web test",
			"about": "Four coding questions in 70 minutes.",
			"sources": [
				{ "title": "Acme test guide", "url": "https://example.com/guide" },
				{ "title": "", "url": "https://example.com/guide" },
				{ "title": "Not a link", "url": "javascript:alert(1)" },
			],
			"topics": [{ "name": "Arrays and strings", "why": "Questions 1 and 2" }, { "name": " arrays and strings " }, { "name": "Hash maps" }, { "name": "  " }],
			"mock": { "questions": 4, "minutes": 70 },
		})
	}

	fn with(base: &Json, key: &str, value: Json) -> Json {
		let mut out = base.clone();
		out.as_obj_mut().unwrap().insert(key, value);
		out
	}

	fn names(prep: &Json) -> Vec<(String, String)> {
		items(&prep["topics"]).iter().map(|t| (t["id"].as_str().unwrap().to_owned(), name_of(t).to_owned())).collect()
	}

	fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
		list.iter().map(|(a, b)| ((*a).to_owned(), (*b).to_owned())).collect()
	}

	#[test]
	fn starts_from_the_learners_words_with_a_day_only_when_it_is_a_real_one() {
		assert_eq!(
			stringify(&new_prep("  Acme online test\nfor a junior web role ", Some("2026-11-20")).unwrap()),
			r#"{"goal":"Acme online test for a junior web role","date":"2026-11-20","about":"","sources":[],"topics":[]}"#
		);
		assert!(new_prep("Interview", Some("soon")).unwrap().get("date").is_none());
		assert!(new_prep("   ", None).is_none());
	}

	#[test]
	fn is_named_by_a_short_form_of_a_long_goal_until_the_sheet_names_it() {
		let forty = "Acme online test for a junior web roles!";
		assert_eq!(forty.chars().count(), 40);
		assert_eq!(goal_name(forty), forty, "40 characters stay whole");
		assert_eq!(goal_name(&format!("{forty} and more")), "Acme online test for a junior web roles!…", "a word ending at 40 is kept");
		assert_eq!(goal_name("Second round with the platform team at Acme, two hours"), "Second round with the platform team at…");
		assert_eq!(goal_name(&"x".repeat(50)), format!("{}…", "x".repeat(40)), "one long word is cut inside it");
	}

	#[test]
	fn takes_the_teachers_sheet_clean_sources_each_topic_once_a_short_name() {
		let (prep, name) = with_sheet(&new_prep("Acme online test", Some("2026-11-20")).unwrap(), &sheet(), "2026-11-11T10:00:00.000Z", &mut ids(), &HashSet::new());
		assert_eq!(name, "Acme junior web test");
		assert_eq!(
			stringify(&prep),
			r#"{"goal":"Acme online test","date":"2026-11-20","about":"Four coding questions in 70 minutes.","sources":[{"title":"Acme test guide","url":"https://example.com/guide"}],"topics":[{"id":"pt_00000001","name":"Arrays and strings","why":"Questions 1 and 2"},{"id":"pt_00000002","name":"Hash maps"}],"mock":{"questions":4,"minutes":70},"writtenAt":"2026-11-11T10:00:00.000Z"}"#
		);
	}

	#[test]
	fn a_topic_keeps_its_id_when_the_sheet_is_written_again_under_the_same_name() {
		let mut new_id = ids();
		let (first, _) = with_sheet(&new_prep("Acme online test", None).unwrap(), &sheet(), "t1", &mut new_id, &HashSet::new());
		let again = with(&sheet(), "topics", json!([{ "name": "Recursion" }, { "name": "hash maps" }]));
		let (again, _) = with_sheet(&first, &again, "t2", &mut new_id, &HashSet::new());
		assert_eq!(names(&again), pairs(&[("pt_00000003", "Recursion"), ("pt_00000002", "hash maps")]));
	}

	#[test]
	fn a_topic_with_answers_stays_when_the_sheet_is_written_again_without_it() {
		let mut new_id = ids();
		let (first, _) = with_sheet(&new_prep("Acme online test", None).unwrap(), &sheet(), "t1", &mut new_id, &HashSet::new());
		let answered = HashSet::from(["pt_00000001".to_owned()]);
		let renamed = with(&sheet(), "topics", json!([{ "name": "Arrays & strings" }, { "name": "Hash maps" }]));
		let (again, _) = with_sheet(&first, &renamed, "t2", &mut new_id, &answered);
		assert_eq!(names(&again), pairs(&[("pt_00000003", "Arrays & strings"), ("pt_00000002", "Hash maps"), ("pt_00000001", "Arrays and strings")]));
		let full = with(&sheet(), "topics", Json::Arr((1..=12).map(|i| json!({ "name": format!("Topic {i}") })).collect()));
		let (capped, _) = with_sheet(&first, &full, "t3", &mut new_id, &answered);
		let topics = items(&capped["topics"]);
		assert_eq!(topics.len(), 12, "the kept one takes the last place");
		assert_eq!(topics[11]["id"], Json::from("pt_00000001"));
	}

	#[test]
	fn says_why_a_sheet_cant_be_kept() {
		assert_eq!(sheet_problem(&sheet()), None);
		assert!(sheet_problem(&with(&sheet(), "name", json!(" "))).unwrap().contains("name"));
		assert!(sheet_problem(&with(&sheet(), "about", json!(""))).unwrap().contains("about"));
		assert!(sheet_problem(&with(&sheet(), "topics", json!([{ "name": "" }]))).unwrap().contains("topics"));
		assert_eq!(sheet_problem(&with(&sheet(), "mock", json!({ "questions": 0, "minutes": 70 }))).unwrap(), "mock must be 1 to 10 questions in 5 to 240 minutes.");
		assert!(sheet_problem(&with(&sheet(), "mock", json!({ "questions": 4, "minutes": 1000 }))).unwrap().contains("mock"));
	}

	#[test]
	fn takes_edits_to_the_sheet_or_says_why_not() {
		let mut new_id = ids();
		let (prep, _) = with_sheet(&new_prep("Acme online test", None).unwrap(), &sheet(), "t1", &mut new_id, &HashSet::new());
		let more = with_edits(&prep, &json!({ "addTopics": [{ "name": " Sorting ", "why": "Question 3" }] }), &mut new_id).unwrap();
		assert_eq!(stringify(items(&more["topics"]).last().unwrap()), r#"{"id":"pt_00000003","name":"Sorting","why":"Question 3"}"#);
		assert_eq!(with_edits(&more, &json!({ "addTopics": [{ "name": "sorting" }] }), &mut new_id), Err("\"sorting\" is already on the sheet.".to_owned()));
		assert_eq!(with_edits(&more, &json!({ "addTopics": [{ "name": "  " }] }), &mut new_id), Err("A topic's name is empty.".to_owned()));
		let fewer = with_edits(&more, &json!({ "removeTopicIds": ["pt_00000001"] }), &mut new_id).unwrap();
		assert_eq!(items(&fewer["topics"]).iter().map(name_of).collect::<Vec<_>>(), ["Hash maps", "Sorting"]);
		assert_eq!(with_edits(&more, &json!({ "removeTopicIds": ["pt_nope"] }), &mut new_id), Err("No topic \"pt_nope\" on the sheet.".to_owned()));
		let ten = Json::Arr((0..10).map(|i| json!({ "name": format!("Topic {i}") })).collect());
		let full = with_edits(&prep, &json!({ "addTopics": ten }), &mut new_id).unwrap();
		assert_eq!(with_edits(&full, &json!({ "addTopics": [{ "name": "One more" }] }), &mut new_id), Err("The sheet is full (12 topics). Remove one first.".to_owned()));

		let dated = with_edits(&prep, &json!({ "date": "2026-12-01" }), &mut new_id).unwrap();
		assert_eq!(dated["date"], Json::from("2026-12-01"));
		assert!(with_edits(&dated, &json!({ "date": null }), &mut new_id).unwrap().get("date").is_none());
		assert_eq!(with_edits(&dated, &json!({ "about": " Three rounds. " }), &mut new_id).unwrap()["date"], Json::from("2026-12-01"), "what isn't given stays");
		assert_eq!(with_edits(&prep, &json!({ "date": "soon" }), &mut new_id), Err("date must be YYYY-MM-DD.".to_owned()));
		assert_eq!(with_edits(&prep, &json!({ "about": " Three rounds. " }), &mut new_id).unwrap()["about"], Json::from("Three rounds."));
		assert_eq!(with_edits(&prep, &json!({ "about": " " }), &mut new_id), Err("about is empty: say what it is like.".to_owned()));
		assert_eq!(stringify(&with_edits(&prep, &json!({ "mock": { "questions": 3, "minutes": 60 } }), &mut new_id).unwrap()["mock"]), r#"{"questions":3,"minutes":60}"#);
		assert_eq!(with_edits(&prep, &json!({ "mock": { "questions": 0, "minutes": 60 } }), &mut new_id), Err("mock must be 1 to 10 questions in 5 to 240 minutes.".to_owned()));
		assert_eq!(with_edits(&prep, &json!({}), &mut new_id).unwrap(), prep);
	}

	#[test]
	fn an_edit_puts_the_day_and_the_mock_last_as_the_spread_does() {
		let (prep, _) = with_sheet(&new_prep("Acme online test", Some("2026-11-20")).unwrap(), &sheet(), "t1", &mut ids(), &HashSet::new());
		let keys = |p: &Json| p.as_obj().unwrap().keys().cloned().collect::<Vec<_>>();
		assert_eq!(keys(&with_edits(&prep, &json!({}), &mut ids()).unwrap()), ["goal", "about", "sources", "topics", "writtenAt", "date", "mock"]);
	}

	#[test]
	fn reads_a_saved_prep_back_the_same_and_drops_what_isnt_one() {
		let (prep, _) = with_sheet(&new_prep("Acme online test", Some("2026-11-20")).unwrap(), &sheet(), "2026-11-11T10:00:00.000Z", &mut ids(), &HashSet::new());
		assert_eq!(stringify(&parse_prep(&prep).unwrap()), stringify(&prep));
		assert_eq!(parse_prep(&Json::Null), None);
		assert_eq!(parse_prep(&json!({ "goal": "" })), None);
		let odd = parse_prep(&json!({ "goal": "Interview", "topics": [{ "id": "x", "name": "Bad id" }, { "id": "pt_1", "name": "Kept" }, { "id": "pt_1", "name": "Twice" }], "mock": { "questions": 99, "minutes": 1 } })).unwrap();
		assert_eq!(stringify(&odd["topics"]), r#"[{"id":"pt_1","name":"Kept"}]"#);
		assert!(odd.get("mock").is_none());
	}

	fn sheet_topics() -> Vec<Json> {
		vec![json!({ "id": "pt_a", "name": "Arrays" }), json!({ "id": "pt_b", "name": "Hash maps" }), json!({ "id": "pt_c", "name": "Recursion" }), json!({ "id": "pt_d", "name": "Sorting" })]
	}

	fn at(day: u32) -> String {
		format!("2026-11-{day:02}T10:00:00.000Z")
	}

	fn answer(node: Option<&str>, outcome: &str, day: u32) -> Json {
		let mut out = Obj::new();
		if let Some(node) = node {
			out.insert("nodeId", node);
		}
		out.insert("outcome", outcome);
		out.insert("answeredAt", at(day));
		Json::Obj(out)
	}

	fn answers() -> Vec<Json> {
		let mut all: Vec<Json> = (1..=9).map(|d| answer(Some("pt_a"), "right", d)).collect();
		all.extend([
			answer(Some("pt_a"), "wrong", 10),
			answer(Some("pt_b"), "right", 1),
			answer(Some("pt_b"), "right", 2),
			answer(Some("pt_b"), "dontKnow", 3),
			answer(Some("pt_d"), "wrong", 1),
			answer(None, "right", 1),
		]);
		all
	}

	#[test]
	fn topics_count_only_the_answers_tagged_with_them() {
		let progress = prep_topic_progress(&sheet_topics(), &answers());
		let rows: Vec<String> = progress.iter().map(|t| format!("{} {} {} {}", name_of(t), t["status"].as_str().unwrap(), stringify(&t["right"]), stringify(&t["answered"]))).collect();
		assert_eq!(rows, ["Arrays strong 9 10", "Hash maps shaky 2 3", "Recursion untested 0 0", "Sorting weak 0 1"]);
		assert_eq!(progress[2]["rate"], Json::Null);
		assert_eq!(progress.iter().map(|t| t["latestWrong"].truthy()).collect::<Vec<_>>(), [false, false, false, true], "only a weak topic is flagged");
		assert_eq!(stringify(&progress[1]), r#"{"id":"pt_b","name":"Hash maps","status":"shaky","answered":3,"right":2,"rate":0.6666666666666666}"#);
	}

	#[test]
	fn a_weak_topic_is_flagged_only_while_its_newest_answer_by_time_is_not_right() {
		let weak = vec![answer(Some("pt_c"), "right", 5), answer(Some("pt_c"), "wrong", 3), answer(Some("pt_c"), "wrong", 4)];
		assert!(prep_topic_progress(&sheet_topics(), &weak)[2].get("latestWrong").is_none(), "caught up, though the mock's answers came later in the list");
		let mut later = weak.clone();
		later.push(answer(Some("pt_c"), "dontKnow", 6));
		assert_eq!(prep_topic_progress(&sheet_topics(), &later)[2]["latestWrong"], Json::from(true));
	}

	#[test]
	fn a_study_session_gets_the_weakest_ones_or_the_ones_named() {
		let progress = prep_topic_progress(&sheet_topics(), &answers());
		assert_eq!(
			stringify(&Json::Arr(prep_study_topics(&progress, &[]))),
			r#"[{"id":"pt_d","name":"Sorting","status":"weak","latestWrong":true,"factIds":[]},{"id":"pt_b","name":"Hash maps","status":"shaky","factIds":[]},{"id":"pt_c","name":"Recursion","status":"untested","factIds":[]}]"#
		);
		assert_eq!(stringify(&Json::Arr(prep_study_topics(&progress, &["pt_a".to_owned()]))), r#"[{"id":"pt_a","name":"Arrays","status":"strong","factIds":[]}]"#);
	}

	#[test]
	fn topics_are_studied_weakest_first() {
		let order = |answers: &[Json]| weakest_first(&prep_topic_progress(&sheet_topics(), answers)).iter().map(|t| name_of(t).to_owned()).collect::<Vec<_>>();
		assert_eq!(order(&answers()), ["Sorting", "Hash maps", "Recursion", "Arrays"]);
		assert_eq!(order(&[]), ["Arrays", "Hash maps", "Recursion", "Sorting"], "ties keep the sheet's order");
	}

	#[test]
	fn the_request_names_the_day_the_files_and_the_topics() {
		let files = [RequestFile { name: "posting.txt".to_owned(), path: "/data/posting.txt".to_owned() }];
		assert_eq!(
			prep_request_text("Acme online test", Some("2026-11-20"), "2026-11-12", &files, &sheet_topics()[..1]),
			"They are preparing for: Acme online test\nToday is 2026-11-12. It is on 2026-11-20.\n\nThey attached these files. Read them first:\n- posting.txt: /data/posting.txt\n\nThe sheet's topics now (keep a name where it still fits):\n- Arrays"
		);
		assert_eq!(prep_request_text("Interview", None, "2026-11-12", &[], &[]), "They are preparing for: Interview\nToday is 2026-11-12. They have no date for it yet.");
	}
}

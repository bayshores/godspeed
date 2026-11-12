//! Teaching rules an agent saves on its own. The rule goes into the same list the learner edits
//! (Settings, Teaching for every lesson; Edit space for one space); agent-rules.json only marks
//! it as the agent's. The learner can undo or edit it from the chat, the notice or Settings.

use gs_base::events::EventKind;
use gs_base::locks::{Guard, LockKey};
use gs_base::time;
use gs_core::records::agent_rules::{rule_for, same_where, where_label};
use gs_core::records::teaching_areas::{RULE_MAX_CHARS, RULES_MAX, one_line};
use gs_json::{Json, json};

use super::settings_record::record_or_new;
use crate::App;

/// Why a rule could not be saved or changed.
#[derive(Debug)]
pub enum RuleFailure {
	NotFound,
	Conflict,
	/// In words for the learner or the agent.
	Refused(String),
	/// The files could not be read or written.
	Disk(String),
}

impl RuleFailure {
	pub fn message(&self) -> &str {
		match self {
			RuleFailure::NotFound => "That rule was removed.",
			RuleFailure::Conflict => "You already have that rule.",
			RuleFailure::Refused(message) | RuleFailure::Disk(message) => message,
		}
	}
}

impl From<String> for RuleFailure {
	fn from(message: String) -> RuleFailure {
		RuleFailure::Disk(message)
	}
}

fn too_long() -> RuleFailure {
	RuleFailure::Refused(format!("A rule is one line of 1 to {RULE_MAX_CHARS} characters."))
}

fn space_name(app: &App, place: &Json) -> Option<String> {
	let space = app.stores.spaces.get_space(place["spaceId"].as_str()?)?;
	space["name"].as_str().map(str::to_owned)
}

fn strings(raw: &Json) -> Vec<String> {
	raw.as_arr().map(|list| list.iter().filter_map(|rule| rule.as_str().map(str::to_owned)).collect()).unwrap_or_default()
}

const SETTINGS: LockKey<'static> = LockKey::AppFile("settings.json");
/// The marks file, held from its read through its write; taken after the list's lock.
const MARKS: LockKey<'static> = LockKey::AppFile("agent-rules.json");

/// Holds the file the list at `place` lives in (its space record, or settings.json) from its read
/// through its write, so two saves at once never write over each other's rule.
fn lock_list(app: &App, place: &Json) -> Guard {
	match place["spaceId"].as_str() {
		Some(id) => app.locks.lock(LockKey::Space(id)),
		None => app.locks.lock(SETTINGS),
	}
}

/// The rule list at `place`, or None for a space that doesn't exist.
fn read_list(app: &App, place: &Json) -> Result<Option<Vec<String>>, String> {
	if let Some(id) = place["spaceId"].as_str() {
		return Ok(app.stores.spaces.get_space(id).map(|space| strings(&space["rules"])));
	}
	let record = app.stores.settings.read_settings()?;
	Ok(Some(record.map(|record| strings(&record["agent"]["rules"][place["area"].as_str().unwrap_or_default()])).unwrap_or_default()))
}

fn write_list(app: &App, place: &Json, rules: &[String]) -> Result<(), String> {
	if let Some(id) = place["spaceId"].as_str() {
		return app.stores.spaces.update_space(id, &json!({ "rules": rules })).map(|_| ());
	}
	let area = place["area"].as_str().unwrap_or_default();
	let mut record = record_or_new(app.stores.settings.read_settings()?);
	let mut agent = record["agent"].as_obj().cloned().unwrap_or_default();
	let mut area_rules = agent.get("rules").and_then(Json::as_obj).cloned().unwrap_or_default();
	if rules.is_empty() {
		area_rules.remove(area);
	} else {
		area_rules.insert(area, rules.to_vec());
	}
	agent.insert("rules", area_rules);
	if let Some(fields) = record.as_obj_mut() {
		fields.insert("agent", agent);
	}
	app.stores.settings.write_settings(&record).map(|_| ())
}

/// Every mark except the one for `text` at `place`.
fn others(saved: Vec<Json>, place: &Json, text: &str) -> Vec<Json> {
	saved.into_iter().filter(|mark| !(mark["text"].as_str() == Some(text) && same_where(&mark["where"], place))).collect()
}

fn unmark(app: &App, place: &Json, text: &str) -> Result<(), String> {
	let _marks = app.locks.lock(MARKS);
	let saved = app.stores.agent_rules.read_saved_rules();
	let before = saved.len();
	let kept = others(saved, place, text);
	if kept.len() == before { Ok(()) } else { app.stores.agent_rules.write_saved_rules(&kept) }
}

fn outcome(app: &App, place: &Json, rule: &str) -> Json {
	let name = space_name(app, place);
	json!({ "ok": true, "rule": rule, "for": rule_for(place, name.as_deref()), "where": where_label(place, name.as_deref()) })
}

fn save(app: &App, text: &str, place: &Json, agent: Option<&str>) -> Result<Json, RuleFailure> {
	let rule = one_line(text, RULE_MAX_CHARS);
	if rule.is_empty() {
		return Err(too_long());
	}
	let _list = lock_list(app, place);
	let Some(list) = read_list(app, place)? else { return Err(RuleFailure::Refused("No such space.".to_owned())) };
	let saved = outcome(app, place, &rule);
	// The learner already has it: nothing to save or mark.
	if list.contains(&rule) {
		return Ok(saved);
	}
	let label = saved["where"].as_str().unwrap_or_default();
	if list.len() >= RULES_MAX {
		return Err(RuleFailure::Refused(format!("{label} already has {RULES_MAX} rules, the most it can hold. Tell the learner, and ask which one to remove in Settings.")));
	}
	write_list(app, place, &[list, vec![rule.clone()]].concat())?;
	// A stale mark from a rule the learner removed in Settings is replaced, not doubled.
	{
		let _marks = app.locks.lock(MARKS);
		let mut marks = others(app.stores.agent_rules.read_saved_rules(), place, &rule);
		marks.push(json!({ "where": place, "text": rule, "at": time::iso_now() }));
		app.stores.agent_rules.write_saved_rules(&marks)?;
	}
	let event = match agent.filter(|a| !a.is_empty()) {
		Some(agent) => json!({ "saved": { "text": rule, "where": place, "label": label, "agent": agent } }),
		None => json!({}),
	};
	app.events.emit(EventKind::RulesChanged, event);
	Ok(saved)
}

/// Save a rule for the learner. With `agent` (an outside agent's name, from the terminal) the
/// window shows a notice; a lesson shows it in the chat. Ok has `rule`, `for` and `where`; Err
/// is the message for the agent.
pub fn save_rule_by_agent(app: &App, text: &str, place: &Json, agent: Option<&str>) -> Result<Json, String> {
	save(app, text, place, agent).map_err(|failure| failure.message().to_owned())
}

/// Undo: take the rule out of its list. False when it isn't there.
pub fn remove_rule(app: &App, place: &Json, text: &str) -> Result<bool, String> {
	let _list = lock_list(app, place);
	let Some(list) = read_list(app, place)?.filter(|list| list.iter().any(|rule| rule == text)) else { return Ok(false) };
	write_list(app, place, &list.into_iter().filter(|rule| rule != text).collect::<Vec<_>>())?;
	unmark(app, place, text)?;
	app.events.emit(EventKind::RulesChanged, json!({}));
	Ok(true)
}

/// Rewrite a rule in place. It becomes the learner's, so the mark goes.
pub fn edit_rule(app: &App, place: &Json, text: &str, new_text: &str) -> Result<Json, RuleFailure> {
	let rule = one_line(new_text, RULE_MAX_CHARS);
	if rule.is_empty() {
		return Err(too_long());
	}
	let _list = lock_list(app, place);
	let list = read_list(app, place)?;
	let Some((list, at)) = list.and_then(|list| list.iter().position(|r| r == text).map(|at| (list, at))) else { return Err(RuleFailure::NotFound) };
	if rule != text && list.contains(&rule) {
		return Err(RuleFailure::Conflict);
	}
	let edited: Vec<String> = list.into_iter().enumerate().map(|(i, r)| if i == at { rule.clone() } else { r }).collect();
	write_list(app, place, &edited)?;
	unmark(app, place, text)?;
	app.events.emit(EventKind::RulesChanged, json!({}));
	Ok(outcome(app, place, &rule))
}

/// The agent-saved rules that are still in their lists. Marks for rules the learner removed or
/// rewrote in Settings are dropped here.
pub fn agent_saved_rules(app: &App) -> Result<Vec<Json>, String> {
	// settings.json first: reading an area's list takes it, and the lock order puts it first.
	let _settings = app.locks.lock(SETTINGS);
	let _marks = app.locks.lock(MARKS);
	let saved = app.stores.agent_rules.read_saved_rules();
	let mut kept = Vec::new();
	for mark in &saved {
		let text = mark["text"].as_str().unwrap_or_default();
		if read_list(app, &mark["where"])?.is_some_and(|list| list.iter().any(|rule| rule == text)) {
			kept.push(mark.clone());
		}
	}
	if kept.len() != saved.len() {
		app.stores.agent_rules.write_saved_rules(&kept)?;
	}
	Ok(kept)
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	fn area() -> Json {
		json!({ "area": "teaching" })
	}

	fn rules_in_settings(app: &App) -> Json {
		app.stores.settings.read_settings().unwrap().map_or(Json::Null, |record| record["agent"]["rules"].clone())
	}

	#[test]
	fn a_saved_rule_lands_in_the_learners_list_marked_and_announced() {
		let root = scratch_dir("rules-save");
		let app = test_app(&root);
		let mut events = app.events.subscribe();
		let saved = save_rule_by_agent(&app, "  Keep   it short ", &area(), Some("Codex")).unwrap();
		assert_eq!(stringify(&saved), r#"{"ok":true,"rule":"Keep it short","for":"every lesson","where":"Every lesson, under Lesson flow"}"#);
		assert_eq!(stringify(&rules_in_settings(&app)), r#"{"teaching":["Keep it short"]}"#);
		let marks = agent_saved_rules(&app).unwrap();
		assert_eq!((marks.len(), marks[0]["text"].as_str()), (1, Some("Keep it short")));
		assert_eq!(
			stringify(&events.try_recv().unwrap().payload),
			r#"{"saved":{"text":"Keep it short","where":{"area":"teaching"},"label":"Every lesson, under Lesson flow","agent":"Codex"}}"#
		);
		save_rule_by_agent(&app, "Keep it short", &area(), None).unwrap();
		assert_eq!(app.stores.agent_rules.read_saved_rules().len(), 1);
		assert!(events.try_recv().is_err());
	}

	#[test]
	fn two_rules_saved_at_once_both_stay_marked() {
		let root = scratch_dir("rules-together");
		let app = test_app(&root);
		let space = app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap();
		for (round, place) in [area(), json!({ "spaceId": space["id"] })].iter().cycle().take(40).enumerate() {
			let start = std::sync::Arc::new(std::sync::Barrier::new(2));
			let save = |rule: String| {
				let (app, start, place) = (app.clone(), start.clone(), place.clone());
				std::thread::spawn(move || {
					start.wait();
					save_rule_by_agent(&app, &rule, &place, None).unwrap();
				})
			};
			let threads = [save(format!("A{round}")), save(format!("B{round}"))];
			threads.into_iter().for_each(|t| t.join().unwrap());
			let list = read_list(&app, place).unwrap().unwrap();
			assert!(list.contains(&format!("A{round}")) && list.contains(&format!("B{round}")), "round {round}: {list:?}");
			write_list(&app, place, &[]).unwrap();
			let marked = app.stores.agent_rules.read_saved_rules();
			assert!(marked.iter().any(|m| m["text"].as_str() == Some(&format!("A{round}"))) && marked.iter().any(|m| m["text"].as_str() == Some(&format!("B{round}"))), "round {round}");
		}
	}

	#[test]
	fn refusals_use_the_agents_words() {
		let root = scratch_dir("rules-refuse");
		let app = test_app(&root);
		assert_eq!(save_rule_by_agent(&app, " \n ", &area(), None).unwrap_err(), "A rule is one line of 1 to 200 characters.");
		assert_eq!(save_rule_by_agent(&app, "x", &json!({ "spaceId": "cls_gone" }), None).unwrap_err(), "No such space.");
		for n in 0..RULES_MAX {
			save_rule_by_agent(&app, &format!("Rule {n}"), &area(), None).unwrap();
		}
		assert_eq!(
			save_rule_by_agent(&app, "One more", &area(), None).unwrap_err(),
			"Every lesson, under Lesson flow already has 20 rules, the most it can hold. Tell the learner, and ask which one to remove in Settings."
		);
	}

	#[test]
	fn undoing_a_rule_removes_it_and_its_mark() {
		let root = scratch_dir("rules-remove");
		let app = test_app(&root);
		save_rule_by_agent(&app, "Be brief", &area(), None).unwrap();
		assert!(!remove_rule(&app, &area(), "Not there").unwrap());
		assert!(remove_rule(&app, &area(), "Be brief").unwrap());
		assert!(rules_in_settings(&app)["teaching"].is_null());
		assert!(app.stores.agent_rules.read_saved_rules().is_empty());
		assert!(!remove_rule(&app, &area(), "Be brief").unwrap());
	}

	#[test]
	fn editing_a_rule_makes_it_the_learners() {
		let root = scratch_dir("rules-edit");
		let app = test_app(&root);
		save_rule_by_agent(&app, "Be brief", &area(), None).unwrap();
		save_rule_by_agent(&app, "Use examples", &area(), None).unwrap();
		assert!(matches!(edit_rule(&app, &area(), "Gone", "x"), Err(RuleFailure::NotFound)));
		assert!(matches!(edit_rule(&app, &area(), "Be brief", "Use examples"), Err(RuleFailure::Conflict)));
		assert!(matches!(edit_rule(&app, &area(), "Be brief", "  "), Err(RuleFailure::Refused(_))));
		let edited = edit_rule(&app, &area(), "Be brief", "Be very brief").unwrap();
		assert_eq!(edited["rule"].as_str(), Some("Be very brief"));
		assert_eq!(stringify(&rules_in_settings(&app)), r#"{"teaching":["Be very brief","Use examples"]}"#);
		assert_eq!(agent_saved_rules(&app).unwrap().len(), 1);
	}

	#[test]
	fn marks_for_rules_changed_in_settings_are_dropped() {
		let root = scratch_dir("rules-stale");
		let app = test_app(&root);
		save_rule_by_agent(&app, "Be brief", &area(), None).unwrap();
		write_list(&app, &area(), &["Be shorter".to_owned()]).unwrap();
		assert!(agent_saved_rules(&app).unwrap().is_empty());
		assert!(app.stores.agent_rules.read_saved_rules().is_empty());
	}

	#[test]
	fn a_space_keeps_its_own_rules() {
		let root = scratch_dir("rules-space");
		let app = test_app(&root);
		let space = app.stores.spaces.create_space(&json!({ "name": "Algebra" })).unwrap();
		let place = json!({ "spaceId": space["id"] });
		let saved = save_rule_by_agent(&app, "Show every step", &place, Some("Codex")).unwrap();
		assert_eq!((saved["for"].as_str(), saved["where"].as_str()), (Some("Algebra"), Some("Lessons in Algebra")));
		assert_eq!(stringify(&app.stores.spaces.get_space(space["id"].as_str().unwrap()).unwrap()["rules"]), r#"["Show every step"]"#);
		assert!(rules_in_settings(&app).is_null());
	}
}

use gs_core::records::agent_notes::{NOTE_MAX_CHARS, NOTES_MAX};
use gs_json::{Json, parse, stringify};
use gs_store::agent_actions::AgentActionsStore;
use gs_store::agent_notes::AgentNotesStore;
use gs_store::agent_rules::AgentRulesStore;
use gs_store::search_key::SearchKeyStore;

use crate::support::{Lab, tabbed};

const NOTE: &str = r#"{"id":"note_0000aa01","text":"Likes worked examples.","createdAt":"2026-11-01T10:00:00.000Z"}"#;
const RULE: &str = "Use Python for code examples.";
const AT: &str = "2026-11-01T10:00:00.000Z";

fn notes(lab: &Lab) -> AgentNotesStore {
	AgentNotesStore::new(&lab.paths, &lab.locks)
}

fn rules(lab: &Lab) -> AgentRulesStore {
	AgentRulesStore::new(&lab.paths, &lab.locks)
}

fn actions(lab: &Lab) -> AgentActionsStore {
	AgentActionsStore::new(&lab.paths, &lab.locks)
}

fn texts(list: &[Json]) -> Vec<String> {
	list.iter().map(stringify).collect()
}

#[test]
fn a_broken_file_is_set_aside_once_and_reads_as_empty() {
	let lab = Lab::new("agent-broken");
	let broken_notes = "{ \"version\": 1, \"notes\": [";
	let broken_rules = "not json at all";
	let broken_actions = "{\"version\":1,\"actions\":[{\"id\":\"act_0000000000a1\"";
	lab.put("agent-notes.json", broken_notes);
	lab.put("agent-rules.json", broken_rules);
	lab.put("agent-actions.json", broken_actions);
	for _ in 0..2 {
		assert!(notes(&lab).list_agent_notes().is_empty());
		assert!(rules(&lab).read_saved_rules().is_empty());
		assert!(actions(&lab).read_agent_actions().is_empty());
	}
	assert_eq!(lab.aside("agent-notes.json.corrupt-"), [broken_notes]);
	assert_eq!(lab.aside("agent-rules.json.corrupt-"), [broken_rules]);
	assert_eq!(lab.aside("agent-actions.json.corrupt-"), [broken_actions]);
	assert!(!lab.exists("agent-notes.json") && !lab.exists("agent-rules.json") && !lab.exists("agent-actions.json"));
}

#[test]
fn a_file_of_the_wrong_shape_reads_as_empty_and_stays_in_place() {
	for text in [r#"{"version":1,"notes":"none"}"#, r#"{"version":1,"notes":{}}"#, "[]", "null", "5", "\"x\""] {
		let lab = Lab::new("agent-shape");
		lab.put("agent-notes.json", text);
		lab.put("agent-rules.json", &text.replace("notes", "rules"));
		lab.put("agent-actions.json", &text.replace("notes", "actions"));
		assert!(notes(&lab).list_agent_notes().is_empty(), "{text}");
		assert!(rules(&lab).read_saved_rules().is_empty(), "{text}");
		assert!(actions(&lab).read_agent_actions().is_empty(), "{text}");
		assert_eq!(lab.names("."), ["agent-actions.json", "agent-notes.json", "agent-rules.json"], "{text}");
		assert_eq!(lab.get("agent-notes.json"), text);
	}
}

#[test]
fn notes_with_bad_entries_keep_only_the_good_ones() {
	let lab = Lab::new("agent-notes-bad");
	let list = format!(r#"{{"version":1,"notes":[{NOTE},{{"id":5,"text":"x","createdAt":"y"}},null,{{"id":"note_0000aa02","text":"No time"}},{{"id":"note_0000aa03","text":"Likes worked examples.","createdAt":"{AT}","spaceId":7}}]}}"#);
	lab.put("agent-notes.json", &list);
	let read = notes(&lab).list_agent_notes();
	let ids: Vec<&str> = read.iter().filter_map(|n| n["id"].as_str()).collect();
	assert_eq!(ids, ["note_0000aa01", "note_0000aa03"]);
	assert!(read[1].get("spaceId").is_none());
	assert_eq!(lab.get("agent-notes.json"), list);
}

#[test]
fn notes_stamped_newer_are_read_and_saved_back_as_version_1() {
	let lab = Lab::new("agent-notes-newer");
	lab.put("agent-notes.json", &tabbed(&format!(r#"{{"version":99,"notes":[{{"id":"note_0000aa01","text":"Likes worked examples.","createdAt":"{AT}","pinned":true}}],"future":{{"keep":"me"}}}}"#)));
	assert_eq!(lab.hash_normalized("agent-notes.json", &[("note_0000aa01", "<note#3>"), (AT, "<iso.3Z>")]), "f6cdabc5f76231cb");
	let read = notes(&lab).list_agent_notes();
	assert_eq!(texts(&read), [format!(r#"{{"id":"note_0000aa01","text":"Likes worked examples.","createdAt":"{AT}"}}"#)]);
	assert_eq!(notes(&lab).remove_agent_note("note_0000aa01"), Ok(true));
	assert_eq!(lab.hash("agent-notes.json"), "1093eafe09b24087");
	assert_eq!(lab.get("agent-notes.json"), tabbed(r#"{"version":1,"notes":[]}"#));
	assert_eq!(notes(&lab).remove_agent_note("note_0000aa01"), Ok(false));
}

#[test]
fn a_note_is_added_cleaned_and_removed() {
	let lab = Lab::new("agent-notes-add");
	let store = notes(&lab);
	let plain = store.add_agent_note("  Prefers   short answers.\n", None).unwrap();
	let with_space = store.add_agent_note("Studies at night.", Some("cls_a")).unwrap();
	let empty_space = store.add_agent_note("Likes diagrams.", Some("")).unwrap();
	assert_eq!(plain["text"].as_str(), Some("Prefers short answers."));
	assert!(plain.get("spaceId").is_none() && empty_space.get("spaceId").is_none());
	assert_eq!(with_space["spaceId"].as_str(), Some("cls_a"));
	assert_eq!(store.list_agent_notes().len(), 3);
	assert_eq!(texts(&store.list_agent_notes())[1], stringify(&with_space));
	assert_eq!(store.remove_agent_note(plain["id"].as_str().unwrap()), Ok(true));
	assert_eq!(store.remove_agent_note("note_nope"), Ok(false));
	assert_eq!(store.list_agent_notes().len(), 2);
	assert_eq!(parse(&lab.get("agent-notes.json")).unwrap()["version"].as_i64(), Some(1));
}

#[test]
fn a_note_must_be_one_short_line_and_only_30_are_kept() {
	let lab = Lab::new("agent-notes-limits");
	let store = notes(&lab);
	let message = format!("A note is one line of 1 to {NOTE_MAX_CHARS} characters.");
	for bad in ["", "   ", &"x".repeat(NOTE_MAX_CHARS + 1)] {
		assert_eq!(store.add_agent_note(bad, None), Err(message.clone()));
	}
	assert!(store.add_agent_note(&"x".repeat(NOTE_MAX_CHARS), None).is_ok());
	for i in 1..NOTES_MAX {
		store.add_agent_note(&format!("Note {i}"), None).unwrap();
	}
	let err = store.add_agent_note("One too many", None).unwrap_err();
	let (head, list) = err.split_once('\n').unwrap();
	assert_eq!(head, format!("godspeed already keeps {NOTES_MAX} notes. Forget one that is out of date first."));
	assert_eq!(list.lines().count(), NOTES_MAX);
	assert!(list.lines().all(|line| line.starts_with("- note_")));
	assert_eq!(store.list_agent_notes().len(), NOTES_MAX);
}

#[test]
fn rules_stamped_newer_are_read_and_saved_back_as_version_1() {
	let lab = Lab::new("agent-rules-newer");
	lab.put(
		"agent-rules.json",
		&tabbed(&format!(r#"{{"version":99,"rules":[{{"where":{{"area":"teaching"}},"text":"{RULE}","at":"{AT}","by":"future"}},{{"where":{{"area":"nowhere"}},"text":"x","at":"{AT}"}}]}}"#)),
	);
	assert_eq!(lab.hash_normalized("agent-rules.json", &[(AT, "<iso.3Z>")]), "2718b841ea0c5998");
	let read = rules(&lab).read_saved_rules();
	assert_eq!(read.len(), 1);
	assert_eq!(read[0]["text"].as_str(), Some(RULE));
	rules(&lab).write_saved_rules(&[]).unwrap();
	assert_eq!(lab.get("agent-rules.json"), tabbed(r#"{"version":1,"rules":[]}"#));
	assert_eq!(lab.hash("agent-rules.json"), "8fca7379750da377");
}

#[test]
fn actions_are_saved_whole_and_read_back_in_order() {
	let lab = Lab::new("agent-actions");
	let list = [
		parse(r#"{"id":"act_1","at":"2026-11-01T10:00:00.000Z","agent":"Codex","label":"Added a file","spaceId":"cls_a","target":{"kind":"file","id":"f_1"},"page":"/","removed":true}"#).unwrap(),
		parse(r#"{"id":"act_2","at":"2026-11-01T10:01:00.000Z","agent":"Codex","label":"Opened a lesson","spaceId":null,"target":null,"page":"/","open":true}"#).unwrap(),
	];
	actions(&lab).write_agent_actions(&list).unwrap();
	assert_eq!(texts(&actions(&lab).read_agent_actions()), texts(&list));
	assert_eq!(lab.get("agent-actions.json"), tabbed(&format!(r#"{{"version":1,"actions":[{},{}]}}"#, stringify(&list[0]), stringify(&list[1]))));
}

#[test]
fn actions_stamped_newer_are_read_anyway() {
	let lab = Lab::new("agent-actions-newer");
	lab.put("agent-actions.json", &tabbed(&format!(r#"{{"version":99,"actions":[{{"id":"act_0000000000b1","at":"{AT}","agent":"Codex","label":"From the future","spaceId":null,"target":null,"page":"/"}}]}}"#)));
	let read = actions(&lab).read_agent_actions();
	assert_eq!(read.len(), 1);
	assert_eq!(read[0]["label"].as_str(), Some("From the future"));
}

#[test]
fn the_seed_memory_files_read_and_save_back_byte_for_byte() {
	let lab = Lab::new("agent-seed");
	if !(lab.copy_seed("agent-rules.json") && lab.copy_seed("agent-actions.json")) {
		return;
	}
	let rules_before = lab.get("agent-rules.json");
	let saved_rules = rules(&lab).read_saved_rules();
	let saved_actions = actions(&lab).read_agent_actions();
	assert!(!saved_rules.is_empty() && !saved_actions.is_empty());
	assert_eq!(lab.get("agent-rules.json"), rules_before);
	rules(&lab).write_saved_rules(&saved_rules).unwrap();
	actions(&lab).write_agent_actions(&saved_actions).unwrap();
	assert_eq!(lab.get("agent-rules.json"), rules_before);
	// Actions saved before spaces read with the old names moved over (classId, /class pages), so
	// only the first write may change the file; from then on it saves back byte for byte.
	let written = lab.get("agent-actions.json");
	assert_eq!(actions(&lab).read_agent_actions(), saved_actions);
	actions(&lab).write_agent_actions(&saved_actions).unwrap();
	assert_eq!(lab.get("agent-actions.json"), written);
}

#[cfg(unix)]
fn file_mode(lab: &Lab, rel: &str) -> u32 {
	use std::os::unix::fs::PermissionsExt;
	std::fs::metadata(lab.file(rel)).unwrap().permissions().mode() & 0o777
}

#[test]
fn the_search_key_is_saved_readable_only_by_the_owner_and_removed() {
	let lab = Lab::new("search-key");
	let store = SearchKeyStore::new(&lab.paths);
	assert_eq!(store.read_search_key(), None);
	store.write_search_key("tvly-dev-abcd1234").unwrap();
	#[cfg(unix)]
	assert_eq!(file_mode(&lab, "search-key"), 0o600);
	assert_eq!(store.read_search_key().as_deref(), Some("tvly-dev-abcd1234"));
	assert!(!lab.exists("settings.json"));
	store.remove_search_key().unwrap();
	assert!(!lab.exists("search-key"));
	assert_eq!(store.read_search_key(), None);
	store.remove_search_key().unwrap();
}

#[test]
fn a_blank_search_key_file_counts_as_no_key() {
	let lab = Lab::new("search-key-blank");
	lab.put("search-key", "  \n");
	assert_eq!(SearchKeyStore::new(&lab.paths).read_search_key(), None);
	lab.put("search-key", " tvly-x \n");
	assert_eq!(SearchKeyStore::new(&lab.paths).read_search_key().as_deref(), Some("tvly-x"));
}

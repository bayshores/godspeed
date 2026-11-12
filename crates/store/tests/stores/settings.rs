use gs_json::{parse, stringify};
use gs_store::settings::SettingsStore;

use crate::support::{Lab, tabbed};

fn store(lab: &Lab) -> SettingsStore {
	SettingsStore::new(&lab.paths, &lab.locks)
}

#[test]
fn an_old_default_threshold_is_dropped_and_the_file_saved_as_version_3() {
	let lab = Lab::new("settings-v1-old");
	lab.put("settings.json", &tabbed(r#"{"version":1,"compaction":{"thresholdTokens":150000},"general":{"teacherName":"Zed"}}"#));
	assert_eq!(lab.hash("settings.json"), "b6ffadc25d90edef");
	let read = store(&lab).read_settings().unwrap().unwrap();
	assert_eq!(stringify(&read), r#"{"version":3,"general":{"teacherName":"Zed"},"compaction":{}}"#);
	assert_eq!(lab.hash("settings.json"), "ccf4399246a37f41");
	store(&lab).read_settings().unwrap().unwrap();
	assert_eq!(lab.hash("settings.json"), "ccf4399246a37f41");
}

#[cfg(unix)]
#[test]
fn an_upgrade_that_cannot_be_saved_fails_the_read() {
	use std::os::unix::fs::PermissionsExt;
	let lab = Lab::new("settings-v1-readonly");
	let before = tabbed(r#"{"version":1,"compaction":{"thresholdTokens":150000}}"#);
	lab.put("settings.json", &before);
	let set_mode = |mode| std::fs::set_permissions(&lab.paths.data, std::fs::Permissions::from_mode(mode)).unwrap();
	set_mode(0o555);
	let read = store(&lab).read_settings();
	set_mode(0o755);
	assert!(read.as_ref().is_err_and(|err| err.starts_with("EACCES: permission denied")), "{read:?}");
	assert_eq!(lab.get("settings.json"), before);
}

#[test]
fn a_custom_threshold_reads_as_version_3_but_the_file_is_left_alone() {
	let lab = Lab::new("settings-v1-custom");
	lab.put("settings.json", &tabbed(r#"{"version":1,"compaction":{"thresholdTokens":100000}}"#));
	assert_eq!(lab.hash("settings.json"), "a4f85206acc24a0a");
	let read = store(&lab).read_settings().unwrap().unwrap();
	assert_eq!(stringify(&read), r#"{"version":3,"compaction":{"thresholdTokens":100000}}"#);
	assert_eq!(lab.hash("settings.json"), "a4f85206acc24a0a");
}

#[test]
fn retired_prompt_switches_delete_the_versions_not_switched_on() {
	let lab = Lab::new("settings-switches");
	lab.put("settings.json", &tabbed(r#"{"version":2,"agent":{"prompts":{"teacher/10-planning.md":true,"shared/10-voice.md":false},"rules":{"voice":["Short."]}}}"#));
	lab.put("prompts/teacher/10-planning.md", "mine planning\n");
	lab.put("prompts/shared/10-voice.md", "mine voice\n");
	lab.put("prompts/teacher/20-teaching.md", "mine teaching\n");
	lab.put("prompts/notes.txt", "not a segment\n");
	assert_eq!(lab.hash("settings.json"), "5a67894720f553eb");
	let read = store(&lab).read_settings().unwrap().unwrap();
	assert_eq!(stringify(&read), r#"{"version":3,"agent":{"rules":{"voice":["Short."]}}}"#);
	assert_eq!(lab.hash("settings.json"), "d37abacad7b7de61");
	assert_eq!(lab.names("prompts"), ["notes.txt", "shared", "teacher"]);
	assert!(lab.names("prompts/shared").is_empty());
	assert_eq!(lab.names("prompts/teacher"), ["10-planning.md"]);
	assert!(!lab.exists("prompts/shared/10-voice.md"));
}

#[test]
fn files_that_are_not_a_settings_record_are_set_aside_and_read_as_none() {
	let cases = [
		("BOM", "\u{feff}{\"version\":2,\"general\":{\"teacherName\":\"B\"}}"),
		("array", "[1,2]"),
		("empty", ""),
		("string", "\"text\""),
		("not JSON", "{not json"),
		("null", "null"),
	];
	for (name, text) in cases {
		let lab = Lab::new("settings-aside");
		lab.put("settings.json", text);
		assert!(store(&lab).read_settings().unwrap().is_none(), "{name}");
		assert!(!lab.exists("settings.json"), "{name}");
		assert_eq!(lab.aside("settings.json.corrupt-"), [text], "{name}");
		assert!(store(&lab).read_settings().unwrap().is_none(), "{name} again");
		assert_eq!(lab.aside("settings.json.corrupt-").len(), 1, "{name} again");
	}
}

#[test]
fn a_missing_file_reads_as_none_and_creates_nothing() {
	let lab = Lab::new("settings-missing");
	assert!(store(&lab).read_settings().unwrap().is_none());
	assert!(lab.names(".").is_empty());
	let effective = store(&lab).effective_settings().unwrap();
	assert!(effective.as_obj().is_some());
	assert!(lab.names(".").is_empty());
}

#[test]
fn a_duplicate_key_takes_the_last_value() {
	let lab = Lab::new("settings-duplicate");
	lab.put("settings.json", r#"{"version":2,"general":{"teacherName":"first","teacherName":"second"}}"#);
	let read = store(&lab).read_settings().unwrap().unwrap();
	assert_eq!(stringify(&read), r#"{"version":3,"general":{"teacherName":"second"}}"#);
	assert_eq!(lab.get("settings.json"), r#"{"version":2,"general":{"teacherName":"first","teacherName":"second"}}"#);
}

#[test]
fn a_write_is_sanitized_and_laid_out_with_tabs() {
	let lab = Lab::new("settings-write");
	let written = store(&lab).write_settings(&parse(r#"{"version":3,"general":{"teacherName":"  Ada  ","autoUpdate":"yes"},"chat":{"old":true}}"#).unwrap()).unwrap();
	assert_eq!(lab.get("settings.json"), tabbed(&stringify(&written)));
	assert_eq!(stringify(&written), r#"{"version":3,"general":{"teacherName":"Ada"}}"#);
	assert_eq!(stringify(&store(&lab).read_settings().unwrap().unwrap()), stringify(&written));
}

#[test]
fn a_write_of_anything_but_an_object_is_refused() {
	let lab = Lab::new("settings-refused");
	for raw in ["[1]", "null", "\"x\"", "5"] {
		assert_eq!(store(&lab).write_settings(&parse(raw).unwrap()), Err("settings record must be a JSON object".to_owned()), "{raw}");
	}
	assert!(lab.names(".").is_empty());
}

#[test]
fn the_seed_settings_upgrade_once_then_save_back_byte_for_byte() {
	let lab = Lab::new("settings-seed");
	if !lab.copy_seed("settings.json") {
		return;
	}
	// The seed was saved before spaces, so its first read may save the moved open space.
	let read = store(&lab).read_settings().unwrap().unwrap();
	let upgraded = lab.get("settings.json");
	assert_eq!(read["version"].as_i64(), Some(3));
	store(&lab).read_settings().unwrap().unwrap();
	assert_eq!(lab.get("settings.json"), upgraded);
	store(&lab).write_settings(&read).unwrap();
	assert_eq!(lab.get("settings.json"), upgraded);
	assert_eq!(store(&lab).effective_settings().unwrap()["general"]["teacherName"].as_str(), Some("marco"));
}

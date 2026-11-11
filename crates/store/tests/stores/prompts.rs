use gs_store::prompt_overrides::PromptOverrides;

use crate::support::Lab;

#[test]
fn overrides_are_written_listed_read_and_deleted() {
	let lab = Lab::new("prompts-roundtrip");
	let overrides = PromptOverrides::new(&lab.paths);
	assert!(overrides.list_overrides().is_empty());
	overrides.write_override("teacher/20-teaching.md", "two\n").unwrap();
	overrides.write_override("shared/10-voice.md", "one\n").unwrap();
	assert_eq!(overrides.list_overrides(), ["shared/10-voice.md", "teacher/20-teaching.md"]);
	assert_eq!(overrides.read_override("shared/10-voice.md").as_deref(), Some("one\n"));
	assert_eq!(overrides.read_override("teacher/10-planning.md"), None);
	overrides.delete_override("shared/10-voice.md");
	overrides.delete_override("shared/10-voice.md");
	assert_eq!(overrides.list_overrides(), ["teacher/20-teaching.md"]);
}

#[test]
fn paths_that_could_leave_the_folder_are_refused() {
	let lab = Lab::new("prompts-refused");
	let overrides = PromptOverrides::new(&lab.paths);
	for bad in ["../evil.md", "teacher/../../evil.md", "/abs.md", "notes.txt", "teacher/.md", ""] {
		assert_eq!(overrides.write_override(bad, "x"), Ok(()), "{bad}");
		assert_eq!(overrides.read_override(bad), None, "{bad}");
	}
	assert!(!lab.exists("prompts"));
	assert!(!lab.exists("../evil.md"));
}

#[test]
fn other_files_and_links_are_not_listed() {
	let lab = Lab::new("prompts-list");
	lab.put("prompts/teacher/10-planning.md", "plan\n");
	lab.put("prompts/notes.txt", "not a segment\n");
	lab.put("outside/10-voice.md", "elsewhere\n");
	std::os::unix::fs::symlink(lab.file("outside"), lab.file("prompts/shared")).unwrap();
	std::os::unix::fs::symlink(lab.file("outside/10-voice.md"), lab.file("prompts/teacher/20-teaching.md")).unwrap();
	let overrides = PromptOverrides::new(&lab.paths);
	assert_eq!(overrides.list_overrides(), ["teacher/10-planning.md"]);
}

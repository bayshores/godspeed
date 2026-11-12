//! The prompt text the app ships, embedded at build time: the shared base and every numbered
//! fragment of each agent's folder and of the shared one. Paths mirror the source layout, which
//! is also how a learner's saved version is keyed. Sorted by folder then file name, so a folder's
//! fragments are already in the order they compose.

pub const SOURCES: [(&str, &str); 24] = [
	("system-prompt.md", include_str!("../../../../src/backend/agent/system-prompt.md")),
	("homework/00-base.md", include_str!("../../../../src/backend/agent/prompts/homework/00-base.md")),
	("practice/00-base.md", include_str!("../../../../src/backend/agent/prompts/practice/00-base.md")),
	("practice/10-doctrine.md", include_str!("../../../../src/backend/agent/prompts/practice/10-doctrine.md")),
	("practice/20-hints.md", include_str!("../../../../src/backend/agent/prompts/practice/20-hints.md")),
	("prober/10-probe-doctrine.md", include_str!("../../../../src/backend/agent/prompts/prober/10-probe-doctrine.md")),
	("shared/10-voice.md", include_str!("../../../../src/backend/agent/prompts/shared/10-voice.md")),
	("shared/12-space-context.md", include_str!("../../../../src/backend/agent/prompts/shared/12-space-context.md")),
	("shared/15-accuracy.md", include_str!("../../../../src/backend/agent/prompts/shared/15-accuracy.md")),
	("shared/16-mental-model.md", include_str!("../../../../src/backend/agent/prompts/shared/16-mental-model.md")),
	("shared/20-question-tools.md", include_str!("../../../../src/backend/agent/prompts/shared/20-question-tools.md")),
	("shared/25-confidence.md", include_str!("../../../../src/backend/agent/prompts/shared/25-confidence.md")),
	("shared/30-learner-files.md", include_str!("../../../../src/backend/agent/prompts/shared/30-learner-files.md")),
	("shared/35-work-plan.md", include_str!("../../../../src/backend/agent/prompts/shared/35-work-plan.md")),
	("shared/40-formatting.md", include_str!("../../../../src/backend/agent/prompts/shared/40-formatting.md")),
	("study/10-study.md", include_str!("../../../../src/backend/agent/prompts/study/10-study.md")),
	("talk/00-base.md", include_str!("../../../../src/backend/agent/prompts/talk/00-base.md")),
	("teacher/05-method.md", include_str!("../../../../src/backend/agent/prompts/teacher/05-method.md")),
	("teacher/10-planning.md", include_str!("../../../../src/backend/agent/prompts/teacher/10-planning.md")),
	("teacher/20-teaching.md", include_str!("../../../../src/backend/agent/prompts/teacher/20-teaching.md")),
	("teacher/28-predictions.md", include_str!("../../../../src/backend/agent/prompts/teacher/28-predictions.md")),
	("teacher/30-question-principles.md", include_str!("../../../../src/backend/agent/prompts/teacher/30-question-principles.md")),
	("teacher/40-jobs.md", include_str!("../../../../src/backend/agent/prompts/teacher/40-jobs.md")),
	("teacher/50-demos.md", include_str!("../../../../src/backend/agent/prompts/teacher/50-demos.md")),
];

#[cfg(test)]
mod tests {
	use gs_core::records::prompt_segments::FRAGMENT_RE;

	use super::SOURCES;

	#[test]
	fn the_embedded_segments_are_every_fragment_the_app_ships_in_path_order() {
		let prompts = concat!(env!("CARGO_MANIFEST_DIR"), "/../../src/backend/agent/prompts");
		let mut on_disk = Vec::new();
		for dir in std::fs::read_dir(prompts).unwrap().flatten().filter(|d| d.path().is_dir()) {
			for file in std::fs::read_dir(dir.path()).unwrap().flatten() {
				let (dir, file) = (dir.file_name().to_string_lossy().into_owned(), file.file_name().to_string_lossy().into_owned());
				if FRAGMENT_RE.test(&file) {
					on_disk.push(format!("{dir}/{file}"));
				}
			}
		}
		on_disk.sort();
		on_disk.insert(0, "system-prompt.md".to_owned());
		let embedded: Vec<&str> = SOURCES.iter().map(|(path, _)| *path).collect();
		assert_eq!(embedded, on_disk);
	}
}

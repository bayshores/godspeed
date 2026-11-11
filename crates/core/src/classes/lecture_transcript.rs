//! A lecture recording whose transcript is already in the class: it isn't transcribed again and
//! its facts come from the transcript. Purely from names.

use std::sync::LazyLock;

use gs_base::{locale, re::Re};
use gs_json::Json;

use super::file_series::date_in_name;
use crate::contracts::class::{FILE_NOT_FOUND, is_recording_file, is_transcript_file};

fn name_of(file: &Json) -> &str {
	file["name"].as_str().unwrap_or("")
}

/// Captions, or another file (a PDF, notes) whose name says "transcript".
fn reads_as_transcript(name: &str) -> bool {
	static WORD: LazyLock<Re> = LazyLock::new(|| Re::new("transcript", "i"));
	is_transcript_file(name) || (!is_recording_file(name) && WORD.test(name))
}

fn lecture_of(name: &str) -> Option<f64> {
	static NUMBER: LazyLock<Re> = LazyLock::new(|| Re::new(r"lecture[\s_\-.]*0*(\d+)", "i"));
	NUMBER.captures(name).map(|m| m.get(1).and_then(|n| n.parse().ok()).unwrap_or(f64::NAN))
}

/// The study transcript that covers a study recording: a .srt/.vtt file or a file whose name
/// says "transcript", with the same date in its name (and not another lecture number), or, when
/// either name has no date, the same lecture number. Captions win over other transcripts; then
/// name order. None when none.
pub fn transcript_for<'a>(recording: &Json, files: &'a [Json]) -> Option<&'a Json> {
	if recording["kind"].as_str() != Some("study") || !is_recording_file(name_of(recording)) {
		return None;
	}
	let date = date_in_name(name_of(recording));
	let lecture = lecture_of(name_of(recording));
	let mut matches: Vec<&Json> = files
		.iter()
		.filter(|f| {
			if f["id"] == recording["id"] || f["kind"].as_str() != Some("study") || !reads_as_transcript(name_of(f)) {
				return false;
			}
			let other = date_in_name(name_of(f));
			let other_lecture = lecture_of(name_of(f));
			// A day's office hours aren't that day's lecture.
			if let (Some(date), Some(other)) = (&date, &other) {
				return date == other && (lecture.is_none() || other_lecture.is_none() || lecture == other_lecture);
			}
			lecture.is_some() && lecture == other_lecture
		})
		.collect();
	matches.sort_by(|a, b| is_transcript_file(name_of(b)).cmp(&is_transcript_file(name_of(a))).then_with(|| locale::compare(name_of(a), name_of(b))));
	matches.first().copied()
}

/// Recordings to process again after the file list changed: one whose transcript left (or
/// became course info) is transcribed after all, and a settled one a newly added transcript
/// covers drops its own facts. Files still waiting or being read see the change when their turn
/// comes, and a recording that is gone waits for the folder scan.
pub fn recordings_to_recheck(files: &[Json]) -> Vec<String> {
	files
		.iter()
		.filter(|f| {
			if f["transcriptId"].truthy() {
				return !files.iter().any(|t| t["id"] == f["transcriptId"] && t["kind"].as_str() == Some("study"));
			}
			!matches!(f["status"].as_str(), Some("pending" | "extracting")) && f["error"].as_str() != Some(FILE_NOT_FOUND) && transcript_for(f, files).is_some()
		})
		.map(|f| f["id"].as_str().unwrap_or("").to_owned())
		.collect()
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn file(id: &str, name: &str, kind: &str) -> Json {
		json!({ "id": id, "name": name, "kind": kind })
	}

	#[test]
	fn captions_with_the_same_date_cover_a_recording() {
		let files = vec![file("r", "CSE 21 Lecture 3 2026-10-01.mp4", "study"), file("t", "Lecture 3 2026-10-01.srt", "study"), file("n", "Lecture 3 2026-10-01 transcript.pdf", "study")];
		assert_eq!(transcript_for(&files[0], &files).map(|f| f["id"].clone()), Some(json!("t")));
		assert!(transcript_for(&files[1], &files).is_none());
	}

	#[test]
	fn another_lecture_number_does_not_match() {
		let files = vec![file("r", "Lecture 3 2026-10-01.mp4", "study"), file("t", "Lecture 4 2026-10-01.srt", "study")];
		assert!(transcript_for(&files[0], &files).is_none());
	}

	#[test]
	fn a_recording_with_a_covering_transcript_is_rechecked() {
		let files = vec![file("r", "Lecture 3.mp4", "study"), file("t", "Lecture 3.vtt", "study")];
		assert_eq!(recordings_to_recheck(&files), ["r"]);
	}
}

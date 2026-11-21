//! How a saved note's record holds P1's values in `vault-notes.json`: its state and what godspeed
//! last wrote.

use gs_json::{Json, Obj};

use super::note_file::Written;

/// Where a note stands. `Active`: godspeed writes it. `Yours`: the learner took the `godspeed`
/// key out, so it is theirs. `Kept`: the learner's own note handed over with `godspeed: keep`.
/// `Removed`: the file is gone and is never made again, except by "Note this".
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NoteState {
	Active,
	Yours,
	Kept,
	Removed,
}

impl NoteState {
	pub fn as_str(self) -> &'static str {
		match self {
			NoteState::Active => "active",
			NoteState::Yours => "yours",
			NoteState::Kept => "kept",
			NoteState::Removed => "removed",
		}
	}

	pub fn parse(text: &str) -> Option<NoteState> {
		[NoteState::Active, NoteState::Yours, NoteState::Kept, NoteState::Removed].into_iter().find(|s| s.as_str() == text)
	}
}

fn string_map(map: &std::collections::BTreeMap<String, String>) -> Json {
	Json::Obj(map.iter().map(|(k, v)| (k.clone(), Json::from(v.as_str()))).collect::<Obj>())
}

fn read_string_map(value: &Json) -> std::collections::BTreeMap<String, String> {
	value.as_obj().into_iter().flatten().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_owned()))).collect()
}

/// The two maps of a note record: `keys` and `sections`.
pub fn written_fields(written: &Written) -> [(&'static str, Json); 2] {
	[("keys", string_map(&written.keys)), ("sections", string_map(&written.sections))]
}

/// What a note record's `keys` and `sections` hold; an empty `Written` when they are missing.
pub fn written_of(note: &Json) -> Written {
	Written { keys: read_string_map(&note["keys"]), sections: read_string_map(&note["sections"]) }
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn every_state_round_trips_its_name() {
		for state in [NoteState::Active, NoteState::Yours, NoteState::Kept, NoteState::Removed] {
			assert_eq!(NoteState::parse(state.as_str()), Some(state));
		}
		assert_eq!(NoteState::parse("gone"), None);
	}

	#[test]
	fn what_godspeed_wrote_round_trips_and_a_bad_record_reads_as_nothing() {
		let written = Written { keys: [("confidence".to_owned(), "confidence: ok".to_owned())].into(), sections: [("recall".to_owned(), "abc".to_owned())].into() };
		let mut note = json!({ "topic": "tpc_1" });
		for (key, value) in written_fields(&written) {
			note.set(key, value);
		}
		assert_eq!(written_of(&note), written);
		assert_eq!(written_of(&json!({ "keys": [1], "sections": { "a": 5, "b": "h" } })), Written { keys: Default::default(), sections: [("b".to_owned(), "h".to_owned())].into() });
		assert_eq!(written_of(&Json::Null), Written::default());
	}
}

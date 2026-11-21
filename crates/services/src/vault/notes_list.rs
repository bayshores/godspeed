//! The pages of a note: a space's Obsidian card on Progress and a lesson's end.

use gs_core::study::progress::TopicStatus;
use gs_core::vault::note_record::NoteState;
use gs_json::{Json, json};

use super::topic_data::{TopicFacts, space_topics};
use crate::App;

/// One page: `{topicId, name, recall, color, kind, path, saving}`. `kind` is godspeed (godspeed
/// writes it), kept (handed over with `keep`) or mine (the learner's own). `saving` is true while
/// the note waits for the vault. `note` is the note's record, null for one not written yet.
pub(super) fn page(topic: &TopicFacts, note: &Json, kind: &str, saving: bool) -> Json {
	let path = note["path"].as_str();
	let name = path.map_or_else(|| topic.name.clone(), |p| p.rsplit('/').next().unwrap_or(p).trim_end_matches(".md").to_owned());
	json!({ "topicId": topic.id, "name": name, "recall": note["recall"].clone(), "color": topic.color, "kind": kind, "path": path, "saving": saving })
}

pub(super) fn kind_of(state: NoteState) -> Option<&'static str> {
	match state {
		NoteState::Active => Some("godspeed"),
		NoteState::Kept => Some("kept"),
		NoteState::Yours => Some("mine"),
		NoteState::Removed => None,
	}
}

/// How soon a topic wants its note read again: the weakest first.
fn want(status: TopicStatus) -> u8 {
	match status {
		TopicStatus::Weak => 0,
		TopicStatus::Shaky => 1,
		TopicStatus::Untested => 2,
		TopicStatus::Strong => 3,
	}
}

/// `{notes: [page]}`, the weakest topic first and then by name. A removed note has no page. None
/// when the space does not exist.
pub fn space_vault_notes(app: &App, space_id: &str) -> Result<Option<Json>, String> {
	let Some(topics) = space_topics(app, space_id)? else { return Ok(None) };
	let record = app.stores.vault_notes.read();
	let mut pages: Vec<(u8, Json)> = record["notes"]
		.as_obj()
		.into_iter()
		.flatten()
		.filter(|(_, note)| note["spaceId"].as_str() == Some(space_id))
		.filter_map(|(topic_id, note)| {
			let kind = kind_of(NoteState::parse(note["state"].str_or_empty())?)?;
			let topic = topics.iter().find(|t| t.id == *topic_id)?;
			Some((want(topic.status), page(topic, note, kind, !note["pending"].is_null())))
		})
		.collect();
	pages.sort_by(|(a, page_a), (b, page_b)| a.cmp(b).then_with(|| page_a["name"].str_or_empty().cmp(page_b["name"].str_or_empty())));
	Ok(Some(json!({ "notes": pages.into_iter().map(|(_, page)| page).collect::<Vec<_>>() })))
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::super::test_support::Fixture;
	use super::super::write_vault_note;
	use super::*;

	#[test]
	fn a_space_lists_a_page_per_note_by_who_owns_it_and_leaves_removed_ones_out() {
		let fx = Fixture::new(&[("t1", "Binary search"), ("t2", "Pigeonhole"), ("t3", "Graphs")]);
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "x", "recall": "Why halve?" }))).unwrap();
		fx.write("Mine/Pigeonhole.md", "my words");
		write_vault_note(&fx.app, &fx.request("t2", json!({ "covered_by": "Mine/Pigeonhole.md" }))).unwrap();
		write_vault_note(&fx.app, &fx.request("t3", json!({ "text": "y" }))).unwrap();
		std::fs::remove_file(fx.vault.join("CSE 21/Graphs.md")).unwrap();
		super::super::minute_check(&fx.app);
		let pages = space_vault_notes(&fx.app, &fx.space_id).unwrap().unwrap();
		let pages = pages["notes"].items();
		assert_eq!(pages.len(), 2);
		assert_eq!((pages[0]["name"].as_str(), pages[0]["kind"].as_str()), (Some("Binary search"), Some("godspeed")));
		assert_eq!(pages[0]["recall"].as_str(), Some("Why halve?"));
		assert_eq!((pages[1]["name"].as_str(), pages[1]["kind"].as_str(), pages[1]["path"].as_str()), (Some("Pigeonhole"), Some("mine"), Some("Mine/Pigeonhole.md")));
		assert_eq!(pages[0]["saving"].as_bool(), Some(false));
		assert!(space_vault_notes(&fx.app, "space_nope").unwrap().is_none());
	}
}

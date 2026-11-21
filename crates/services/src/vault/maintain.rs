//! The minute check of the vault: rereads it, follows godspeed's notes the learner renamed or
//! moved, notices a note the learner deleted, takes over notes handed over with
//! `godspeed: keep`, and writes the notes that waited for the vault.

use std::path::Path;

use gs_base::fsx;
use gs_core::vault::frontmatter::{Doc, scalar_block};
use gs_core::vault::note_keys::OWNER_KEY;
use gs_core::vault::note_record::NoteState;
use gs_json::{Json, json};

use super::write::{is_icloud_placeholder, picked_vault, write_vault_note};
use super::{notes_changed, rescan, with_reader};
use crate::App;

fn log(what: &str, err: &str) {
	eprintln!("[vault] {what}: {err}");
}

/// Everything the vault needs once a minute, and again when the learner presses Try again.
pub fn minute_check(app: &App) {
	if !picked_vault(app) || rescan(app).is_err() {
		return;
	}
	let mut changed = false;
	for step in [follow_files, take_over_kept, write_waiting] {
		match step(app) {
			Ok(did) => changed |= did,
			Err(err) => log("check", &err),
		}
	}
	if changed {
		notes_changed(app);
	}
}

enum Seen {
	Moved(String, String),
	Gone(String),
}

/// A note godspeed wrote that is no longer at its recorded path is found again by its
/// `godspeed` key. One that is simply gone is marked removed, but only when its folder is still
/// there, it is not an iCloud placeholder, and it is the only one gone: several at once mean a
/// moved folder or a sync still running, not the learner deleting notes.
fn follow_files(app: &App) -> Result<bool, String> {
	let Some(vault) = super::setup::setting(app)?.path else { return Ok(false) };
	let vault = Path::new(&vault);
	let record = app.stores.vault_notes.read();
	let mut seen = Vec::new();
	for (topic, note) in record["notes"].as_obj().into_iter().flatten() {
		let state = NoteState::parse(note["state"].str_or_empty());
		let Some(path) = note["path"].as_str().filter(|_| matches!(state, Some(NoteState::Active | NoteState::Kept))) else { continue };
		if vault.join(path).is_file() {
			continue;
		}
		match with_reader(app, |r| r.path_of_topic(topic).map(str::to_owned)).map_err(|e| e.message())? {
			Some(now) => seen.push(Seen::Moved(topic.to_owned(), now)),
			None if vault.join(path).parent().is_some_and(Path::is_dir) && !is_icloud_placeholder(vault, path) => seen.push(Seen::Gone(topic.to_owned())),
			None => {}
		}
	}
	let gone = seen.iter().filter(|s| matches!(s, Seen::Gone(_))).count();
	if seen.is_empty() {
		return Ok(false);
	}
	app.stores.vault_notes.update(|rec| {
		let notes = rec.get_mut("notes").and_then(Json::as_obj_mut).ok_or("vault-notes.json has no notes.")?;
		for item in &seen {
			match item {
				Seen::Moved(topic, now) => {
					if let Some(note) = notes.get_mut(topic) {
						note.set("path", now.as_str());
					}
				}
				Seen::Gone(topic) if gone == 1 => {
					if let Some(note) = notes.get_mut(topic) {
						note.set("state", NoteState::Removed.as_str());
					}
				}
				Seen::Gone(_) => {}
			}
		}
		Ok(())
	})?;
	Ok(true)
}

/// A note with `godspeed: keep` whose file name is the name of exactly one topic gets that
/// topic's id in place of `keep`. Any other note stays for the teacher to match.
fn take_over_kept(app: &App) -> Result<bool, String> {
	let Some(vault) = super::setup::setting(app)?.path else { return Ok(false) };
	let kept = with_reader(app, |r| r.kept_paths().into_iter().filter_map(|p| Some((p.to_owned(), r.note(p)?.name.to_lowercase()))).collect::<Vec<_>>()).map_err(|e| e.message())?;
	if kept.is_empty() {
		return Ok(false);
	}
	let mut topics: Vec<(String, String, String)> = Vec::new();
	for space in app.stores.spaces.list_space_records().iter().filter(|s| !s["closed"].truthy()) {
		let space_id = space["id"].str_or_empty();
		let snapshot = app.stores.graphs.read_topics(Some(space_id))?.unwrap_or(Json::Null);
		topics.extend(snapshot["topics"].items().iter().map(|t| (t["id"].str_or_empty().to_owned(), t["name"].str_or_empty().to_lowercase(), space_id.to_owned())));
	}
	let known = app.stores.vault_notes.read();
	let mut changed = false;
	for (path, name) in kept {
		let mut matches = topics.iter().filter(|(_, topic_name, _)| *topic_name == name);
		let (Some((topic, _, space_id)), None) = (matches.next(), matches.next()) else { continue };
		if known["notes"][topic.as_str()]["path"].as_str().is_some() {
			continue;
		}
		let file = Path::new(&vault).join(&path);
		let mut doc = Doc::parse(&fsx::read_text(&file).map_err(|e| e.to_string())?);
		doc.set_block(OWNER_KEY, &scalar_block(OWNER_KEY, topic));
		fsx::write_text_atomic(&file, &doc.render()).map_err(|e| e.to_string())?;
		app.stores.vault_notes.update(|rec| {
			let notes = rec.get_mut("notes").and_then(Json::as_obj_mut).ok_or("vault-notes.json has no notes.")?;
			notes.insert(topic, json!({ "spaceId": space_id, "path": path, "state": NoteState::Kept.as_str(), "keys": {}, "sections": {}, "kinds": [] }));
			Ok(())
		})?;
		let _ = with_reader(app, |r| r.reread(&path));
		changed = true;
	}
	Ok(changed)
}

/// Writes each request that waited for the vault. One the teacher could no longer make (its
/// topic is gone) is dropped with a log line.
fn write_waiting(app: &App) -> Result<bool, String> {
	let record = app.stores.vault_notes.read();
	let waiting: Vec<(String, Json)> = record["notes"].as_obj().into_iter().flatten().filter(|(_, n)| !n["pending"].is_null()).map(|(t, n)| (t.to_owned(), n["pending"].clone())).collect();
	for (topic, request) in &waiting {
		if let Err(why) = write_vault_note(app, request) {
			log(&format!("waiting note for {topic} dropped"), &why);
			app.stores.vault_notes.update(|rec| {
				if let Some(note) = rec.get_mut("notes").and_then(Json::as_obj_mut).and_then(|n| n.get_mut(topic)).and_then(Json::as_obj_mut) {
					note.remove("pending");
				}
				Ok(())
			})?;
		}
	}
	Ok(!waiting.is_empty())
}

#[cfg(test)]
mod tests {
	use super::super::test_support::Fixture;
	use super::*;

	#[test]
	fn a_keep_note_named_like_one_topic_gets_that_topics_id() {
		let fx = Fixture::new(&[("t1", "Binary search"), ("t2", "Pigeonhole")]);
		fx.write("Notes/Binary search.md", "---\ngodspeed: keep\ntags: mine\n---\nMy own words.\n");
		fx.write("Notes/Something else.md", "---\ngodspeed: keep\n---\nNo topic has this name.\n");
		minute_check(&fx.app);
		let text = fx.read("Notes/Binary search.md");
		assert!(text.contains("godspeed: t1") && !text.contains("godspeed: keep") && text.contains("tags: mine") && text.contains("My own words."), "{text}");
		assert!(fx.read("Notes/Something else.md").contains("godspeed: keep"), "left for the teacher");
		let record = fx.app.stores.vault_notes.read();
		assert_eq!((record["notes"]["t1"]["state"].as_str(), record["notes"]["t1"]["path"].as_str()), (Some("kept"), Some("Notes/Binary search.md")));
	}

	#[test]
	fn a_keep_note_whose_name_two_topics_share_is_left_alone() {
		let fx = Fixture::new(&[("t1", "Sets"), ("t2", "Sets")]);
		fx.write("Sets.md", "---\ngodspeed: keep\n---\nbody\n");
		minute_check(&fx.app);
		assert!(fx.read("Sets.md").contains("godspeed: keep"));
	}

	#[test]
	fn a_moved_note_is_followed_and_one_deleted_note_is_marked_removed() {
		let fx = Fixture::new(&[("t1", "Binary search"), ("t2", "Pigeonhole")]);
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "a" }))).unwrap();
		write_vault_note(&fx.app, &fx.request("t2", json!({ "text": "b" }))).unwrap();
		std::fs::create_dir_all(fx.vault.join("Moved")).unwrap();
		std::fs::rename(fx.vault.join("CSE 21/Binary search.md"), fx.vault.join("Moved/Search.md")).unwrap();
		std::fs::remove_file(fx.vault.join("CSE 21/Pigeonhole.md")).unwrap();
		minute_check(&fx.app);
		let record = fx.app.stores.vault_notes.read();
		assert_eq!(record["notes"]["t1"]["path"].as_str(), Some("Moved/Search.md"));
		assert_eq!(record["notes"]["t2"]["state"].as_str(), Some("removed"));
	}

	#[test]
	fn several_notes_gone_at_once_are_not_marked_removed() {
		let fx = Fixture::new(&[("t1", "Binary search"), ("t2", "Pigeonhole")]);
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "a" }))).unwrap();
		write_vault_note(&fx.app, &fx.request("t2", json!({ "text": "b" }))).unwrap();
		std::fs::remove_file(fx.vault.join("CSE 21/Binary search.md")).unwrap();
		std::fs::remove_file(fx.vault.join("CSE 21/Pigeonhole.md")).unwrap();
		minute_check(&fx.app);
		let record = fx.app.stores.vault_notes.read();
		assert_eq!((record["notes"]["t1"]["state"].as_str(), record["notes"]["t2"]["state"].as_str()), (Some("active"), Some("active")));
	}

	#[test]
	fn a_waiting_request_whose_topic_is_gone_is_dropped_not_kept_forever() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		fx.app.stores.vault_notes.update(|rec| {
			rec.get_mut("notes").and_then(Json::as_obj_mut).unwrap().insert("ghost", json!({ "spaceId": fx.space_id, "state": "active", "pending": fx.request("ghost", json!({ "text": "x" })) }));
			Ok(())
		})
		.unwrap();
		minute_check(&fx.app);
		assert!(fx.app.stores.vault_notes.read()["notes"]["ghost"]["pending"].is_null());
	}
}

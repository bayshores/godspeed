//! Writes one note into the vault: a new file, an update of godspeed's own note, or a link to a
//! note the learner already wrote. The learner's own files are only ever read, except that a
//! note handed over with `godspeed: keep` gets its keys and mistake lines.

use std::collections::HashSet;
use std::io;
use std::path::Path;

use gs_base::{clock, fsx};
use gs_core::spaces::space_shortcuts::{safe_entry_name, unique_name};
use gs_core::spaces::today_note::{day_label, local_day};
use gs_core::vault::base_file::base_text;
use gs_core::vault::frontmatter::{Doc, Owner, scalar_block};
use gs_core::vault::mistakes::{MAX_KINDS, Mistake, line_kind};
use gs_core::vault::note_file::{self, Merged, NoteData, Source, note_name};
use gs_core::vault::note_keys::{OWNER_KEY, confidence_word};
use gs_core::vault::note_record::{NoteState, written_fields, written_of};
use gs_core::vault::note_tool::{LINKS_MAX, MISTAKE_KIND_MAX, MISTAKE_TEXT_MAX, RECALL_MAX, TEXT_MAX, TITLE_MAX};
use gs_core::vault::sections::{Kind, Sections};
use gs_json::{Json, json};

use super::source::source_for;
use super::topic_data::{TopicFacts, space_topics};
use super::{NO_VAULT, VaultError, notes_changed, rescan, with_reader};
use crate::App;
use crate::spaces::space_actions::{CLOSED_SPACE, no_space_text};

const REMOVED: &str = "The learner removed this note, so it is not written again unless they ask with Note this.";

/// What the teacher sent, checked against the limits.
struct Request {
	space_id: String,
	topic_id: String,
	title: Option<String>,
	text: Option<String>,
	recall: Option<String>,
	mistakes: Vec<(String, String)>,
	/// The ids the notes block gave the mistakes, so a later block leaves them out.
	mistake_ids: Vec<String>,
	source: Option<String>,
	links: Vec<String>,
	covered_by: Option<String>,
	/// The learner asked for this note, so a note they removed is written again.
	asked: bool,
	/// Typed at a lesson end; the tools cannot send it.
	words: Option<String>,
}

fn limited(args: &Json, key: &str, max: usize) -> Result<Option<String>, String> {
	match args[key].as_str().map(str::trim).filter(|s| !s.is_empty()) {
		Some(s) if s.chars().count() > max => Err(format!("{key} is at most {max} characters.")),
		Some(s) => Ok(Some(s.to_owned())),
		None => Ok(None),
	}
}

fn required(args: &Json, key: &str) -> Result<String, String> {
	args[key].as_str().filter(|s| !s.is_empty()).map(str::to_owned).ok_or_else(|| format!("{key} is needed."))
}

impl Request {
	fn parse(args: &Json) -> Result<Request, String> {
		let mistakes = args["mistakes"].items().iter().map(|m| Ok((limited(m, "kind", MISTAKE_KIND_MAX)?.ok_or("Each mistake needs a kind.")?, limited(m, "text", MISTAKE_TEXT_MAX)?.ok_or("Each mistake needs text.")?))).collect::<Result<Vec<_>, String>>()?;
		if mistakes.len() > MAX_KINDS {
			return Err(format!("Send at most {MAX_KINDS} mistakes."));
		}
		let mistake_ids = args["mistakes"].items().iter().filter_map(|m| m["id"].as_str().filter(|id| !id.is_empty()).map(str::to_owned)).collect();
		let links: Vec<String> = args["links"].items().iter().filter_map(|l| l.as_str().map(str::to_owned)).collect();
		if links.len() > LINKS_MAX {
			return Err(format!("Link at most {LINKS_MAX} notes."));
		}
		let request = Request {
			space_id: required(args, "space_id")?,
			topic_id: required(args, "topic_id")?,
			title: limited(args, "title", TITLE_MAX)?,
			text: limited(args, "text", TEXT_MAX)?,
			recall: limited(args, "recall", RECALL_MAX)?,
			mistakes,
			mistake_ids,
			source: args["source"].as_str().filter(|s| !s.is_empty()).map(str::to_owned),
			links,
			covered_by: args["covered_by"].as_str().filter(|s| !s.is_empty()).map(str::to_owned),
			asked: args["asked"].truthy(),
			words: None,
		};
		let alongside = request.title.is_some() || request.text.is_some() || request.recall.is_some() || !request.mistakes.is_empty() || request.source.is_some() || !request.links.is_empty();
		if request.covered_by.is_some() && alongside {
			return Err("Send nothing else with covered_by.".to_owned());
		}
		Ok(request)
	}
}

/// The vault folder Settings names, when there is one.
pub(crate) fn picked_vault(app: &App) -> bool {
	super::setup::setting(app).is_ok_and(|s| s.path.is_some())
}

#[derive(PartialEq)]
enum Covered {
	Learner,
	/// Handed over with `godspeed: keep`.
	Kept,
	Godspeed,
}

/// What is read from the vault before its record is locked.
struct Seen {
	/// The note whose `godspeed` key names the topic, wherever it is now.
	found: Option<String>,
	/// Whose note is at `covered_by`.
	covered: Option<Covered>,
	has_space_note: bool,
	taken_files: HashSet<String>,
	link_names: HashSet<String>,
}

const DISK_FULL: &str = "The disk is full, so the note was not written.";
const READ_ONLY: &str = "The vault cannot be written to: it is read-only or godspeed has no permission for it.";
const NOT_WRITTEN: &str = "The note could not be written";

fn io_failure(err: &io::Error) -> String {
	match fsx::error_code(err) {
		Some("ENOSPC") => DISK_FULL.to_owned(),
		Some("EROFS" | "EACCES" | "EPERM") => READ_ONLY.to_owned(),
		_ => format!("{NOT_WRITTEN}: {err}"),
	}
}

/// What the learner reads when a write the disk refused leaves its note waiting.
fn disk_failure(why: &str) -> Option<&'static str> {
	[(DISK_FULL, "The disk is full."), (READ_ONLY, "The folder is read-only."), (NOT_WRITTEN, "The note could not be written.")].into_iter().find(|(prefix, _)| why.starts_with(prefix)).map(|(_, line)| line)
}

/// "Nov 20" for today.
fn today_label() -> String {
	let label = day_label(&local_day(clock::now_ms()));
	label.split_once(' ').map_or(label.clone(), |(_, rest)| rest.to_owned())
}

fn mistake_kinds(note_text: &str) -> Vec<String> {
	let doc = Doc::parse(note_text);
	Sections::parse(&doc.body, doc.eol()).list_lines(Kind::Mistakes).iter().filter_map(|l| line_kind(l)).collect()
}

pub(super) fn is_icloud_placeholder(vault: &Path, rel: &str) -> bool {
	let file = vault.join(rel);
	match (file.parent(), file.file_name()) {
		(Some(dir), Some(name)) => dir.join(format!(".{}.icloud", name.to_string_lossy())).exists(),
		_ => false,
	}
}

enum Outcome {
	Done(Json),
	Refused(String),
	/// The vault cannot be reached; the request waits in the record.
	Waits,
}

/// Writes the note for `args` and answers `{status, name, path, confidence, next_review?, kept?}`.
/// `status` is written, updated, linked or waiting.
pub(crate) fn write_vault_note(app: &App, args: &Json) -> Result<Json, String> {
	write_request(app, Request::parse(args)?, args)
}

/// Writes what the learner typed at a lesson end as the note's "My words". Answers like
/// `write_vault_note`.
pub(crate) fn write_vault_words(app: &App, space_id: &str, topic_id: &str, words: &str) -> Result<Json, String> {
	let args = json!({ "space_id": space_id, "topic_id": topic_id });
	let mut req = Request::parse(&args)?;
	req.words = Some(words.to_owned());
	write_request(app, req, &args)
}

fn write_request(app: &App, req: Request, args: &Json) -> Result<Json, String> {
	let setting = super::setup::setting(app)?;
	let vault = setting.path.ok_or(NO_VAULT)?;
	let space = app.stores.spaces.get_space(&req.space_id).ok_or_else(|| no_space_text(&req.space_id))?;
	if space["closed"].truthy() {
		return Err(CLOSED_SPACE.to_owned());
	}
	let topics = space_topics(app, &req.space_id)?.ok_or_else(|| no_space_text(&req.space_id))?;
	let topic = topics.into_iter().find(|t| t.id == req.topic_id).ok_or_else(|| format!("No topic \"{}\" in this space. Use read_space.", req.topic_id))?;
	let source = req.source.as_deref().map(|id| source_for(app, &space, Path::new(&vault), id)).transpose()?;
	let space_name = space["name"].str_or_empty().to_owned();
	let note_title = req.title.clone().unwrap_or_else(|| topic.name.clone());

	let seen = match rescan(app) {
		Ok(_) => with_reader(app, |r| Seen {
			found: r.path_of_topic(&topic.id).map(str::to_owned),
			covered: req.covered_by.as_deref().and_then(|p| r.note(p)).map(|n| match n.owner {
				None => Covered::Learner,
				Some(Owner::Keep) => Covered::Kept,
				Some(Owner::Topic(_)) => Covered::Godspeed,
			}),
			has_space_note: !r.paths_named(&space_name).is_empty(),
			taken_files: r.file_names(),
			link_names: r.names(),
		}),
		Err(err) => Err(err),
	};
	let mut refused = None;
	let outcome = match seen {
		Ok(seen) => match place(app, Path::new(&vault), &req, &space_name, &note_title, &topic, source, seen) {
			Ok(outcome) => outcome,
			Err(why) => {
				refused = Some(disk_failure(&why).ok_or(why)?);
				Outcome::Waits
			}
		},
		Err(VaultError::Missing) => Outcome::Waits,
		Err(err) => return Err(err.message()),
	};
	match outcome {
		Outcome::Done(answer) => {
			if let Some(path) = answer["path"].as_str() {
				let _ = with_reader(app, |r| r.reread(path));
			}
			notes_changed(app);
			Ok(answer)
		}
		Outcome::Refused(why) => {
			notes_changed(app);
			Err(why)
		}
		Outcome::Waits => {
			app.stores.vault_notes.update(|rec| keep_waiting(rec, &req, args, refused, &note_title))?;
			notes_changed(app);
			Ok(json!({ "status": "waiting", "name": note_name(&note_title), "path": null, "confidence": confidence_word(topic.status) }))
		}
	}
}

/// Keeps the request until the vault takes it, with the note's name for the failure notice.
/// `refused` is why the disk would not; "Try again" repeats the write.
fn keep_waiting(rec: &mut Json, req: &Request, args: &Json, refused: Option<&str>, name: &str) -> Result<(), String> {
	let notes = rec.get_mut("notes").and_then(Json::as_obj_mut).ok_or("vault-notes.json has no notes.")?;
	let mut note = notes.get(&req.topic_id).cloned().unwrap_or_else(|| json!({ "spaceId": req.space_id, "state": NoteState::Active.as_str() }));
	note.set("pending", args.clone());
	note.set("title", name);
	match refused {
		Some(why) => note.set("failure", why),
		None => {
			if let Some(fields) = note.as_obj_mut() {
				fields.remove("failure");
			}
		}
	}
	notes.insert(&req.topic_id, note);
	Ok(())
}

#[expect(clippy::too_many_arguments, reason = "the one caller holds each of these apart, and a struct made only to carry them would be a type with one use")]
fn place(app: &App, vault: &Path, req: &Request, space_name: &str, note_title: &str, topic: &TopicFacts, source: Option<Source>, seen: Seen) -> Result<Outcome, String> {
	for link in &req.links {
		if !seen.link_names.contains(&link.to_lowercase()) && !recorded_names(app).contains(&link.to_lowercase()) {
			return Err(format!("There is no note named \"{link}\" to link to."));
		}
	}
	if let Some(path) = &req.covered_by
		&& !matches!(seen.covered, Some(Covered::Learner | Covered::Kept))
	{
		return Err(format!("covered_by must be the path of one of the learner's notes, and {path} is not."));
	}
	let data = NoteData {
		title: note_title.to_owned(),
		space: space_name.to_owned(),
		deadlines: topic.deadlines.clone(),
		standing: topic.status,
		answered: Some(topic.answered.clone()),
		next_review: topic.next_review.clone(),
		facts: topic.facts.clone(),
		up: seen.has_space_note.then(|| space_name.to_owned()),
		text: req.text.clone(),
		recall: req.recall.clone(),
		mistakes: req.mistakes.iter().map(|(kind, text)| Mistake { kind: kind.clone(), text: text.clone(), date: today_label() }).collect(),
		links: req.links.clone(),
		source,
		words: req.words.clone(),
	};
	app.stores.vault_notes.update(|rec| {
		let existing = rec["notes"][req.topic_id.as_str()].clone();
		let state = NoteState::parse(existing["state"].str_or_empty()).unwrap_or(NoteState::Active);
		if state == NoteState::Removed && !req.asked {
			return Ok(Outcome::Refused(REMOVED.to_owned()));
		}
		let recorded = existing["path"].as_str().map(str::to_owned);
		let mut current = seen.found.clone().or_else(|| recorded.clone().filter(|p| vault.join(p).is_file()));
		let mut handed = false;
		if let Some(covered) = &req.covered_by {
			if current.is_some() {
				return Ok(Outcome::Refused("This topic already has a note, so it cannot be marked as covered.".to_owned()));
			}
			if seen.covered == Some(Covered::Kept) {
				hand_over(vault, covered, &req.topic_id)?;
				(current, handed) = (Some(covered.clone()), true);
			} else {
				save_note(rec, req, covered, NoteState::Yours, None, None);
				return Ok(Outcome::Done(answer("linked", covered, topic, &[])));
			}
		}
		let Some(rel) = current else {
			if let Some(gone) = recorded.filter(|_| !req.asked) {
				if is_icloud_placeholder(vault, &gone) {
					return Ok(Outcome::Waits);
				}
				if vault.join(&gone).parent().is_some_and(Path::is_dir) {
					rec.get_mut("notes").and_then(Json::as_obj_mut).and_then(|n| n.get_mut(&req.topic_id)).ok_or("vault-notes.json lost the note.")?.set("state", NoteState::Removed.as_str());
					return Ok(Outcome::Refused(REMOVED.to_owned()));
				}
			}
			return create(rec, vault, req, &data, topic, seen.taken_files).map(Outcome::Done);
		};
		let text = fsx::read_text(&vault.join(&rel)).map_err(|e| format!("The note {rel} could not be read: {e}"))?;
		let last = written_of(&existing);
		let doc_owner = Doc::parse(&text).owner();
		let kept = state == NoteState::Kept || handed;
		let merged = match doc_owner {
			None => {
				save_note(rec, req, &rel, NoteState::Yours, None, Some(&text));
				return Ok(Outcome::Done(answer("linked", &rel, topic, &[])));
			}
			Some(Owner::Keep) | Some(Owner::Topic(_)) if kept => note_file::merge_handed_over(&text, &data, &last),
			_ => note_file::merge(&text, &data, &last),
		}
		.ok_or("The note has no godspeed key.")?;
		let new_state = if kept { NoteState::Kept } else { NoteState::Active };
		write_file(vault, &rel, &text, &merged)?;
		save_note(rec, req, &rel, new_state, Some(&merged), Some(&merged.text));
		let mut left: Vec<String> = merged.kept_keys.clone();
		left.extend(merged.kept_sections.iter().cloned());
		Ok(Outcome::Done(answer("updated", &rel, topic, &left)))
	})
}

/// A note handed over with `godspeed: keep` gets the topic's id in place of `keep`.
fn hand_over(vault: &Path, rel: &str, topic_id: &str) -> Result<(), String> {
	let file = vault.join(rel);
	let mut doc = Doc::parse(&fsx::read_text(&file).map_err(|e| format!("The note {rel} could not be read: {e}"))?);
	doc.set_block(OWNER_KEY, &scalar_block(OWNER_KEY, topic_id));
	fsx::write_text_atomic(&file, &doc.render()).map_err(|e| io_failure(&e))
}

/// File names of the notes godspeed recorded, for `links` to the notes of the same lesson.
fn recorded_names(app: &App) -> HashSet<String> {
	let rec = app.stores.vault_notes.read();
	rec["notes"].as_obj().into_iter().flatten().filter_map(|(_, n)| n["path"].as_str()).map(|p| p.rsplit('/').next().unwrap_or(p).trim_end_matches(".md").to_lowercase()).collect()
}

fn write_file(vault: &Path, rel: &str, before: &str, merged: &Merged) -> Result<(), String> {
	if merged.text == before {
		return Ok(());
	}
	fsx::write_text_atomic(&vault.join(rel), &merged.text).map_err(|e| io_failure(&e))
}

fn create(rec: &mut Json, vault: &Path, req: &Request, data: &NoteData, topic: &TopicFacts, mut taken_files: HashSet<String>) -> Result<Json, String> {
	let folder_known = rec["folders"][req.space_id.as_str()].as_str().map(str::to_owned);
	let folder = match &folder_known {
		Some(folder) => folder.clone(),
		None => {
			let mut taken: HashSet<String> = rec["folders"].as_obj().into_iter().flatten().filter_map(|(_, v)| v.as_str().map(str::to_lowercase)).collect();
			taken.extend(std::fs::read_dir(vault).into_iter().flatten().flatten().map(|e| e.file_name().to_string_lossy().to_lowercase()));
			unique_name(&safe_entry_name(&data.space), &mut taken)
		}
	};
	let file = unique_name(&note_file::file_name(&data.title), &mut taken_files);
	let rel = format!("{folder}/{file}");
	let built = note_file::build(&topic.id, data);
	std::fs::create_dir_all(vault.join(&folder)).map_err(|e| io_failure(&e))?;
	if folder_known.is_none() {
		fsx::write_text_atomic(&vault.join(&folder).join(format!("{folder}.base")), &base_text(&folder)).map_err(|e| io_failure(&e))?;
		rec.get_mut("folders").and_then(Json::as_obj_mut).ok_or("vault-notes.json has no folders.")?.insert(&req.space_id, folder.as_str());
	}
	fsx::write_text_atomic(&vault.join(&rel), &built.text).map_err(|e| io_failure(&e))?;
	save_note(rec, req, &rel, NoteState::Active, Some(&built), Some(&built.text));
	Ok(answer("written", &rel, topic, &[]))
}

/// Stores the note's record: where it is, what godspeed wrote and its state. The waiting
/// request is cleared, since the note is now written.
fn save_note(rec: &mut Json, req: &Request, rel: &str, state: NoteState, merged: Option<&Merged>, text: Option<&str>) {
	let Some(notes) = rec.get_mut("notes").and_then(Json::as_obj_mut) else { return };
	let mut note = notes.get(&req.topic_id).cloned().unwrap_or_else(|| json!({}));
	note.set("spaceId", req.space_id.as_str());
	note.set("path", rel);
	note.set("state", state.as_str());
	if let Some(merged) = merged {
		for (key, value) in written_fields(&merged.written) {
			note.set(key, value);
		}
	}
	if let Some(text) = text {
		note.set("kinds", Json::Arr(mistake_kinds(text).into_iter().map(Json::from).collect()));
	}
	if let Some(recall) = &req.recall {
		note.set("recall", recall.as_str());
	}
	if !req.mistake_ids.is_empty() {
		let mut ids: Vec<String> = note["mistakeIds"].items().iter().filter_map(|id| id.as_str().map(str::to_owned)).collect();
		for id in &req.mistake_ids {
			if !ids.contains(id) {
				ids.push(id.clone());
			}
		}
		note.set("mistakeIds", Json::Arr(ids.into_iter().map(Json::from).collect()));
	}
	if req.words.is_some() {
		note.set("words", true);
	}
	if let Some(fields) = note.as_obj_mut() {
		fields.remove("pending");
		fields.remove("failure");
	}
	notes.insert(&req.topic_id, note);
}

fn answer(status: &str, rel: &str, topic: &TopicFacts, kept: &[String]) -> Json {
	let name = rel.rsplit('/').next().unwrap_or(rel).trim_end_matches(".md");
	let mut out = json!({ "status": status, "name": name, "path": rel, "confidence": confidence_word(topic.status) });
	if let Some(fields) = out.as_obj_mut() {
		if let Some(date) = &topic.next_review {
			fields.insert("next_review", date.as_str());
		}
		if !kept.is_empty() {
			fields.insert("kept", Json::Arr(kept.iter().map(|k| Json::from(k.as_str())).collect()));
		}
	}
	out
}

#[cfg(test)]
mod tests {
	use super::super::test_support::Fixture;
	use super::*;

	#[test]
	fn a_first_note_makes_the_space_folder_with_one_base_file() {
		let fx = Fixture::new(&[("t1", "Binary search"), ("t2", "Pigeonhole")]);
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "Halve the range each step.", "recall": "How many steps for n items?" }))).unwrap();
		assert_eq!((answer["status"].as_str(), answer["name"].as_str(), answer["path"].as_str()), (Some("written"), Some("Binary search"), Some("CSE 21/Binary search.md")));
		let text = fx.read("CSE 21/Binary search.md");
		assert!(text.contains("godspeed: t1") && text.contains("Halve the range each step."), "{text}");
		let base = fx.read("CSE 21/CSE 21.base");
		let second = write_vault_note(&fx.app, &fx.request("t2", json!({ "text": "Too many items for the boxes." }))).unwrap();
		assert_eq!(second["path"].as_str(), Some("CSE 21/Pigeonhole.md"));
		assert_eq!(fx.read("CSE 21/CSE 21.base"), base, "the Base file is written only when the folder is first made");
		let record = fx.app.stores.vault_notes.read();
		assert_eq!(record["folders"][fx.space_id.as_str()].as_str(), Some("CSE 21"));
		assert_eq!(record["notes"]["t1"]["recall"].as_str(), Some("How many steps for n items?"));
	}

	#[test]
	fn a_folder_name_already_in_the_vault_gets_a_number_and_a_clashing_file_too() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		fx.write("CSE 21/Mine.md", "mine");
		fx.write("Elsewhere/Binary search.md", "the learner's own note of that name");
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "x" }))).unwrap();
		assert_eq!(answer["path"].as_str(), Some("CSE 21 (2)/Binary search (2).md"));
		assert_eq!(fx.read("CSE 21/Mine.md"), "mine");
	}

	#[test]
	fn a_second_write_updates_the_note_and_keeps_what_the_learner_added() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "Halve the range." }))).unwrap();
		let mut text = fx.read("CSE 21/Binary search.md");
		text = text.replacen("godspeed: t1", "godspeed: t1\ntags: mine", 1);
		fx.write("CSE 21/Binary search.md", &text);
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "mistakes": [{ "kind": "Off by one", "text": "Counted n steps, not log n." }] }))).unwrap();
		assert_eq!(answer["status"].as_str(), Some("updated"));
		let after = fx.read("CSE 21/Binary search.md");
		assert!(after.contains("tags: mine"), "{after}");
		assert!(after.contains("Off by one"), "{after}");
	}

	#[test]
	fn a_renamed_note_is_found_again_by_its_key() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "Halve the range." }))).unwrap();
		std::fs::create_dir_all(fx.vault.join("Moved")).unwrap();
		std::fs::rename(fx.vault.join("CSE 21/Binary search.md"), fx.vault.join("Moved/Bisect.md")).unwrap();
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "recall": "Why halve?" }))).unwrap();
		assert_eq!((answer["status"].as_str(), answer["path"].as_str()), (Some("updated"), Some("Moved/Bisect.md")));
		assert!(!fx.vault.join("CSE 21/Binary search.md").exists(), "no second copy");
	}

	#[test]
	fn a_missing_vault_keeps_the_request_and_the_minute_check_writes_it_later() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		let aside = fx.vault.with_file_name("Notes-aside");
		std::fs::rename(&fx.vault, &aside).unwrap();
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "Kept for later." }))).unwrap();
		assert_eq!(answer["status"].as_str(), Some("waiting"));
		assert!(answer["path"].is_null());
		assert_eq!(fx.app.stores.vault_notes.read()["notes"]["t1"]["pending"]["text"].as_str(), Some("Kept for later."));
		std::fs::rename(&aside, &fx.vault).unwrap();
		super::super::minute_check(&fx.app);
		let record = fx.app.stores.vault_notes.read();
		assert!(record["notes"]["t1"]["pending"].is_null());
		assert!(fx.read("CSE 21/Binary search.md").contains("Kept for later."));
	}

	#[test]
	fn a_note_the_learner_deleted_is_marked_removed_and_only_note_this_may_bring_it_back() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "x" }))).unwrap();
		std::fs::remove_file(fx.vault.join("CSE 21/Binary search.md")).unwrap();
		let why = write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "again" }))).unwrap_err();
		assert_eq!(why, REMOVED);
		assert_eq!(fx.app.stores.vault_notes.read()["notes"]["t1"]["state"].as_str(), Some("removed"));
		assert!(!fx.vault.join("CSE 21/Binary search.md").exists());
	}

	#[test]
	fn asked_writes_a_removed_note_again() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "x" }))).unwrap();
		std::fs::remove_file(fx.vault.join("CSE 21/Binary search.md")).unwrap();
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "again" }))).unwrap_err();
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "again", "asked": true }))).unwrap();
		assert_eq!(answer["status"].as_str(), Some("written"));
		assert_eq!(fx.app.stores.vault_notes.read()["notes"]["t1"]["state"].as_str(), Some("active"));
	}

	#[test]
	fn a_kept_note_no_name_matched_becomes_the_topics_note_when_the_teacher_covers_it() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		fx.write("Mine/Halving.md", "---\ngodspeed: keep\n---\nMy own words.\n");
		super::super::rescan(&fx.app).unwrap();
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "covered_by": "Mine/Halving.md" }))).unwrap();
		assert_eq!((answer["status"].as_str(), answer["path"].as_str()), (Some("updated"), Some("Mine/Halving.md")));
		let text = fx.read("Mine/Halving.md");
		assert!(text.contains("godspeed: t1") && !text.contains("godspeed: keep") && text.contains("My own words."), "{text}");
		assert_eq!(fx.app.stores.vault_notes.read()["notes"]["t1"]["state"].as_str(), Some("kept"));
	}

	#[test]
	fn the_mistake_ids_sent_are_remembered_once() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		let mistakes = json!([{ "id": "m1a2b3c", "kind": "Off by one", "text": "Used < for <=." }]);
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "x", "mistakes": mistakes }))).unwrap();
		write_vault_note(&fx.app, &fx.request("t1", json!({ "mistakes": mistakes }))).unwrap();
		assert_eq!(gs_json::stringify(&fx.app.stores.vault_notes.read()["notes"]["t1"]["mistakeIds"]), r#"["m1a2b3c"]"#);
	}

	#[test]
	fn words_typed_at_a_lesson_end_become_my_words() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "x" }))).unwrap();
		write_vault_words(&fx.app, &fx.space_id, "t1", "It halves the range.").unwrap();
		assert!(fx.read("CSE 21/Binary search.md").contains("## My words\nIt halves the range."));
		assert_eq!(fx.app.stores.vault_notes.read()["notes"]["t1"]["words"].as_bool(), Some(true));
	}

	#[test]
	fn a_note_whose_whole_folder_is_gone_is_written_again_not_marked_removed() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "x" }))).unwrap();
		std::fs::remove_dir_all(fx.vault.join("CSE 21")).unwrap();
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "x" }))).unwrap();
		assert_eq!(answer["status"].as_str(), Some("written"));
	}

	#[test]
	fn an_icloud_placeholder_means_wait_not_removed() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "x" }))).unwrap();
		std::fs::remove_file(fx.vault.join("CSE 21/Binary search.md")).unwrap();
		fx.write("CSE 21/.Binary search.md.icloud", "");
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "y" }))).unwrap();
		assert_eq!(answer["status"].as_str(), Some("waiting"));
		assert_eq!(fx.app.stores.vault_notes.read()["notes"]["t1"]["state"].as_str(), Some("active"));
	}

	#[test]
	fn a_note_the_learner_wrote_is_linked_never_changed() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		fx.write("Mine/Bisection.md", "My own words about halving.\n");
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "covered_by": "Mine/Bisection.md" }))).unwrap();
		assert_eq!((answer["status"].as_str(), answer["path"].as_str()), (Some("linked"), Some("Mine/Bisection.md")));
		assert_eq!(fx.read("Mine/Bisection.md"), "My own words about halving.\n");
		assert_eq!(fx.app.stores.vault_notes.read()["notes"]["t1"]["state"].as_str(), Some("yours"));
		let again = write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "ignored" }))).unwrap();
		assert_eq!(again["status"].as_str(), Some("linked"));
		assert_eq!(fx.read("Mine/Bisection.md"), "My own words about halving.\n");
	}

	#[test]
	fn a_kept_note_gets_keys_and_mistakes_and_its_body_stays() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		fx.write("Notes/Bisection.md", "---\ngodspeed: t1\n---\nMy own body.\n");
		fx.app.stores.vault_notes.update(|rec| {
			rec.get_mut("notes").and_then(Json::as_obj_mut).unwrap().insert("t1", json!({ "spaceId": fx.space_id, "path": "Notes/Bisection.md", "state": "kept", "keys": {}, "sections": {}, "kinds": [] }));
			Ok(())
		})
		.unwrap();
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "Teacher words.", "mistakes": [{ "kind": "Off by one", "text": "Counted wrong." }] }))).unwrap();
		assert_eq!(answer["status"].as_str(), Some("updated"));
		let text = fx.read("Notes/Bisection.md");
		assert!(text.contains("My own body.") && !text.contains("Teacher words."), "{text}");
		assert!(text.contains("Off by one") && text.contains("confidence"), "{text}");
		assert_eq!(fx.app.stores.vault_notes.read()["notes"]["t1"]["state"].as_str(), Some("kept"));
	}

	#[cfg(unix)]
	#[test]
	fn a_folder_the_disk_refuses_keeps_the_note_waiting_until_try_again() {
		use std::os::unix::fs::PermissionsExt;
		let fx = Fixture::new(&[("t1", "Binary search")]);
		std::fs::set_permissions(&fx.vault, std::fs::Permissions::from_mode(0o555)).unwrap();
		let answer = write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "Halve it." }))).unwrap();
		assert_eq!(answer["status"].as_str(), Some("waiting"));
		let status = super::super::vault_status(&fx.app).unwrap();
		assert_eq!((status["waiting"]["names"][0].as_str(), status["waiting"]["why"].as_str()), (Some("Binary search"), Some("The folder is read-only.")));
		std::fs::set_permissions(&fx.vault, std::fs::Permissions::from_mode(0o755)).unwrap();
		let status = super::super::retry_vault(&fx.app).unwrap();
		assert!(status["waiting"].is_null());
		assert!(fx.read("CSE 21/Binary search.md").contains("Halve it."));
	}

	#[test]
	fn the_refusals_say_what_to_fix() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		let refused = |extra: Json| write_vault_note(&fx.app, &fx.request("t1", extra)).unwrap_err();
		assert!(refused(json!({ "text": "x".repeat(1201) })).contains("1200"));
		assert!(refused(json!({ "recall": "x".repeat(201) })).contains("200"));
		assert!(refused(json!({ "links": ["a", "b", "c", "d", "e", "f", "g"] })).contains('6'));
		assert!(refused(json!({ "text": "x", "covered_by": "Any.md" })).contains("nothing else"));
		assert!(refused(json!({ "links": ["No such note"] })).contains("No such note"));
		assert!(refused(json!({ "covered_by": "Missing.md" })).contains("learner's notes"));
		let unknown = write_vault_note(&fx.app, &fx.request("nope", json!({ "text": "x" }))).unwrap_err();
		assert!(unknown.contains("No topic"), "{unknown}");
		assert_eq!(write_vault_note(&fx.app, &json!({ "topic_id": "t1" })).unwrap_err(), "space_id is needed.");
		fx.app.stores.spaces.update_space(&fx.space_id, &json!({ "closed": true })).unwrap();
		assert_eq!(write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "x" }))).unwrap_err(), CLOSED_SPACE);
	}

	#[test]
	fn no_vault_picked_is_refused_with_where_to_pick_one() {
		let root = crate::app::test_support::scratch_dir("vault-none");
		let app = crate::app::test_support::test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 21" })).unwrap()["id"].as_str().unwrap().to_owned();
		let why = write_vault_note(&app, &json!({ "space_id": space_id, "topic_id": "t1" })).unwrap_err();
		assert_eq!(why, NO_VAULT);
	}

	#[test]
	fn a_link_to_a_note_written_in_the_same_pass_or_in_the_vault_is_allowed() {
		let fx = Fixture::new(&[("t1", "Binary search"), ("t2", "Pigeonhole")]);
		fx.write("Mine/Sorting.md", "sorting");
		write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "x" }))).unwrap();
		write_vault_note(&fx.app, &fx.request("t2", json!({ "text": "y", "links": ["Binary search", "sorting"] }))).unwrap();
		let text = fx.read("CSE 21/Pigeonhole.md");
		assert!(text.contains("[[Binary search]]") && text.contains("[[sorting]]"), "{text}");
	}

	#[test]
	fn a_full_disk_or_a_read_only_vault_is_said_in_plain_words() {
		assert_eq!(io_failure(&io::Error::from_raw_os_error(28)), "The disk is full, so the note was not written.");
		assert!(io_failure(&io::Error::from_raw_os_error(30)).contains("read-only"));
		assert!(io_failure(&io::Error::from(io::ErrorKind::InvalidData)).starts_with("The note could not be written"));
	}
}

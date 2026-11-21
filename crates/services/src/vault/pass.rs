//! The pass that turns a lesson's answers into notes. A lesson end, leaving a lesson that has new
//! answers, and the start of the app (for a lesson left when it quit) each queue the lesson here.
//! The queued answers go to the teacher once, as a notes block: on the space's next topic
//! grouping when a helper is here, else as an item of their own once no lesson turn waits.
//! A helper is never started for notes.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use gs_agent::extraction::topic_grouper::RidingNotes;
use gs_agent::subagents::pi_run::{SubagentRunOptions, run_subagent};
use gs_agent::tools::vault_note::{WriteVaultNote, write_vault_note_tool};
use gs_agent::vault::notes_block::{Block, Entry, Mistake, Section, Topic, Words, notes_block};
use gs_base::tasks::detach;
use gs_base::{clock, fsx, time};
use gs_core::vault::frontmatter::Doc;
use gs_core::vault::note_file::note_name;
use gs_core::vault::note_keys::confidence_word;
use gs_core::vault::note_record::{NoteState, written_of};
use gs_core::vault::note_tool::{ASKS_MAX, LINKS_MAX, WORDS_MAX};
use gs_engine::turn::tool::Tool;
use gs_core::vault::sections::{Kind, Sections};
use gs_json::{Json, json};
use gs_search::vault::VaultOwner;
use parking_lot::Mutex;

use super::notes_list::{kind_of, page};
use super::topic_data::{TopicFacts, space_topics};
use super::write::{picked_vault, write_vault_note, write_vault_words};
use super::{notes_changed, setup, with_reader};
use crate::App;
use crate::graph::progress::{lesson_answered_topics, progress_for, space_mistakes};

/// A queued pass waits this long for a space's topic grouping before it is sent on its own.
const GROUPING_WAIT_MS: i64 = 3 * 60_000;
/// After a failed run, the same pass is not sent again for this long.
const RETRY_AFTER_MS: i64 = 10 * 60_000;
/// Mistakes sent for one topic in one pass.
const MISTAKES_PER_TOPIC: usize = 4;
/// Passages and covering notes offered for one topic.
const PASSAGES_PER_TOPIC: usize = 2;
const COVERING_PER_TOPIC: usize = 3;
/// Skips after which a note is never asked for again.
const SKIPS_BEFORE_NEVER: i64 = 2;

const INSTRUCTIONS: &str = "You write notes for a learner in godspeed, a learning app, into their Obsidian vault. These instructions are short to save tokens. The learner does not see this conversation. Follow the [Vault notes] block with write_vault_note, once per idea, then end with one short line saying what you wrote.";

#[derive(Default)]
struct Waiting {
	lessons: BTreeSet<String>,
	since: i64,
	not_before: i64,
}

/// What the pass knows in memory only: a restart finds the same lessons again from their
/// markers.
#[derive(Default)]
pub struct PassState {
	waiting: Mutex<HashMap<String, Waiting>>,
	/// A space's topics whose block was sent and whose run has not ended.
	sending: Mutex<HashMap<String, HashSet<String>>>,
	caught_up: AtomicBool,
}

/// A block taken from the queue: it is finished with `done`, which marks the lessons as sent, or
/// puts them back when the run failed.
pub struct Taken {
	text: String,
	topics: usize,
	app: Arc<App>,
	space_id: String,
	lessons: Vec<String>,
	at: String,
	asks: Vec<(String, Vec<String>)>,
}

impl Taken {
	/// The block and the tool that writes it, for the topic grouping item that carries them.
	pub fn riding(&self) -> RidingNotes {
		RidingNotes { block: self.text.clone(), tool: notes_tool(&self.app, &self.space_id), topics: self.topics }
	}

	pub fn done(self, app: &App, ok: bool) {
		app.vault.pass.sending.lock().remove(&self.space_id);
		if ok {
			let saved = app.stores.vault_notes.update(|rec| {
				for lesson in &self.lessons {
					set_in(rec, "passes", lesson, Json::from(self.at.as_str()))?;
				}
				for (lesson, topics) in &self.asks {
					set_in(rec, "asks", lesson, Json::Arr(topics.iter().map(|t| Json::from(t.as_str())).collect()))?;
				}
				Ok(())
			});
			if let Err(why) = saved {
				eprintln!("[vault] could not mark a pass as sent: {why}");
			}
		} else {
			requeue(app, &self.space_id, self.lessons, clock::now_ms() + RETRY_AFTER_MS);
		}
		notes_changed(app);
	}
}

fn set_in(rec: &mut Json, map: &str, key: &str, value: Json) -> Result<(), String> {
	rec.get_mut(map).and_then(Json::as_obj_mut).ok_or_else(|| format!("vault-notes.json has no {map}."))?.insert(key, value);
	Ok(())
}

fn requeue(app: &App, space_id: &str, lessons: Vec<String>, not_before: i64) {
	let mut waiting = app.vault.pass.waiting.lock();
	let entry = waiting.entry(space_id.to_owned()).or_default();
	entry.lessons.extend(lessons);
	entry.since = entry.since.max(clock::now_ms());
	entry.not_before = not_before;
}

/// The lesson's space, when its answers since the last pass earned a note, the lesson has the
/// vault (it began after one was picked) and the vault is still picked.
fn earning_space(app: &App, chat_id: &str) -> Result<Option<String>, String> {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(None) };
	let Some(space_id) = record["spaceId"].as_str().filter(|s| !s.is_empty()) else { return Ok(None) };
	if !record["vaultPicked"].truthy() || !picked_vault(app) {
		return Ok(None);
	}
	if app.stores.spaces.get_space(space_id).is_none_or(|s| s["closed"].truthy()) {
		return Ok(None);
	}
	let marker = app.stores.vault_notes.read()["passes"][chat_id].as_str().map(str::to_owned);
	let topics = lesson_answered_topics(app, chat_id, marker.as_deref())?;
	Ok((!topics.is_empty()).then(|| space_id.to_owned()))
}

/// Queues the lesson's new answers for a pass, and sends them now when no helper is here.
pub fn queue_lesson(app: &Arc<App>, chat_id: &str) {
	match earning_space(app, chat_id) {
		Ok(Some(space_id)) => {
			{
				let mut waiting = app.vault.pass.waiting.lock();
				let entry = waiting.entry(space_id).or_default();
				if entry.lessons.is_empty() {
					entry.since = clock::now_ms();
				}
				entry.lessons.insert(chat_id.to_owned());
			}
			notes_changed(app);
			send_waiting(app);
		}
		Ok(None) => {}
		Err(why) => eprintln!("[vault] pass for {chat_id} not queued: {why}"),
	}
}

/// A lesson was left: the one the window showed is not the one it shows now.
pub fn lesson_left(app: &Arc<App>, was: Option<&str>, now: Option<&str>) {
	let chat_of = |path: Option<&str>| path.and_then(|p| p.strip_prefix("/chat/")).map(str::to_owned);
	if let Some(left) = chat_of(was).filter(|id| Some(id) != chat_of(now).as_ref()) {
		queue_lesson(app, &left);
	}
}

/// Once per run of the app: every lesson that has new answers and is not open now, since the
/// app may have quit before its pass.
pub fn catch_up(app: &Arc<App>) {
	if app.vault.pass.caught_up.swap(true, Ordering::SeqCst) || !picked_vault(app) {
		return;
	}
	let open = app.bridge.window_page().and_then(|w| w.path.strip_prefix("/chat/").map(str::to_owned));
	for summary in app.stores.chats.list_chats() {
		let Some(id) = summary["id"].as_str().filter(|id| Some(*id) != open.as_deref()) else { continue };
		queue_lesson(app, id);
	}
}

/// Sends each waiting space's pass on its own when it may: no lesson turn waits, and either no
/// helper is here or the grouping that would have carried it never came.
pub fn send_waiting(app: &Arc<App>) {
	let now = clock::now_ms();
	let ready: Vec<String> = {
		let waiting = app.vault.pass.waiting.lock();
		let busy = app.vault.pass.sending.lock();
		waiting.iter().filter(|(space, w)| !busy.contains_key(*space) && now >= w.not_before && (!app.bridge.helper_here(now) || now - w.since >= GROUPING_WAIT_MS)).map(|(space, _)| space.clone()).collect()
	};
	if ready.is_empty() || app.bridge.pending_turn_count() > 0 {
		return;
	}
	for space_id in ready {
		let app = app.clone();
		detach("vault", async move {
			let Some(taken) = take(&app, &space_id).await else { return };
			let ok = run_own_item(&app, &space_id, &taken.text).await;
			taken.done(&app, ok);
		});
	}
}

/// The block for the space's next topic grouping, when a helper is here and a pass waits.
pub async fn take_for_grouping(app: &Arc<App>, space_id: &str) -> Option<Taken> {
	if !app.bridge.helper_here(clock::now_ms()) {
		return None;
	}
	take(app, space_id).await
}

async fn take(app: &Arc<App>, space_id: &str) -> Option<Taken> {
	let lessons: Vec<String> = {
		let mut waiting = app.vault.pass.waiting.lock();
		if app.vault.pass.sending.lock().contains_key(space_id) || waiting.get(space_id)?.not_before > clock::now_ms() {
			return None;
		}
		waiting.remove(space_id)?.lessons.into_iter().collect()
	};
	match build(app, space_id, &lessons).await {
		Ok(Some(built)) => {
			app.vault.pass.sending.lock().insert(space_id.to_owned(), built.topics.iter().cloned().collect());
			Some(Taken { text: built.text, topics: built.topics.len(), app: app.clone(), space_id: space_id.to_owned(), lessons, at: built.at, asks: built.asks })
		}
		Ok(None) => {
			mark_sent(app, &lessons);
			None
		}
		Err(why) => {
			eprintln!("[vault] block for {space_id} not built: {why}");
			requeue(app, space_id, lessons, clock::now_ms() + RETRY_AFTER_MS);
			None
		}
	}
}

/// A pass with nothing to write still counts as sent, so its answers are not looked at again.
fn mark_sent(app: &App, lessons: &[String]) {
	let at = time::iso_now();
	let saved = app.stores.vault_notes.update(|rec| {
		for lesson in lessons {
			set_in(rec, "passes", lesson, Json::from(at.as_str()))?;
		}
		Ok(())
	});
	if let Err(why) = saved {
		eprintln!("[vault] could not mark a pass as sent: {why}");
	}
}

/// `write_vault_note` for the space's notes block: its space is fixed.
fn notes_tool(app: &Arc<App>, space_id: &str) -> Arc<dyn Tool> {
	let (call_app, space) = (app.clone(), space_id.to_owned());
	let write: WriteVaultNote = Arc::new(move |args: &Json| {
		let mut args = args.clone();
		args.set("space_id", space.as_str());
		write_vault_note(&call_app, &args)
	});
	Arc::new(write_vault_note_tool(write))
}

async fn run_own_item(app: &Arc<App>, space_id: &str, text: &str) -> bool {
	let label = format!("Notes: {}", app.stores.spaces.get_space(space_id).map_or_else(String::new, |s| s["name"].str_or_empty().to_owned()));
	let mut run = SubagentRunOptions::new(INSTRUCTIONS, Json::from(text), 24);
	run.task_label = Some(label);
	run.asked = true;
	match run_subagent(&app.bridge, vec![notes_tool(app, space_id)], run).await {
		Ok(_) => true,
		Err(why) => {
			eprintln!("[vault] the notes item for {space_id} failed: {why}");
			false
		}
	}
}

struct Built {
	text: String,
	topics: Vec<String>,
	at: String,
	/// Per lesson, the topics to ask "My words" for.
	asks: Vec<(String, Vec<String>)>,
}

/// The learner adds "My words" (the setting's other value: the teacher writes the whole note).
fn learner_writes(words: &str) -> bool {
	words == "mine"
}

fn file_stem(path: &str) -> String {
	path.rsplit('/').next().unwrap_or(path).trim_end_matches(".md").to_owned()
}

/// The sections of an existing note that are still godspeed's, with their text.
fn godspeed_sections(vault: &Path, rel: &str, note: &Json) -> Vec<Section> {
	let Ok(text) = fsx::read_text(&vault.join(rel)) else { return Vec::new() };
	let doc = Doc::parse(&text);
	let sections = Sections::parse(&doc.body, doc.eol());
	let last = written_of(note);
	[Kind::Recall, Kind::InShort, Kind::Related, Kind::Check]
		.into_iter()
		.filter(|kind| sections.hash_of(*kind).is_some_and(|hash| last.sections.get(kind.name()) == Some(&hash)))
		.filter_map(|kind| Some(Section { name: kind.name().to_owned(), text: sections.text_of(kind)? }))
		.collect()
}

/// The block for the lessons' new answers; None when no topic needs a note.
async fn build(app: &Arc<App>, space_id: &str, lessons: &[String]) -> Result<Option<Built>, String> {
	let Some(space) = app.stores.spaces.get_space(space_id).filter(|s| !s["closed"].truthy()) else { return Ok(None) };
	let setting = setup::setting(app)?;
	let Some(vault) = setting.path else { return Ok(None) };
	let at = time::iso_now();
	let record = app.stores.vault_notes.read();
	let mut counts: Vec<(String, usize)> = Vec::new();
	let mut per_lesson: Vec<(String, Vec<String>)> = Vec::new();
	for lesson in lessons {
		let marker = record["passes"][lesson.as_str()].as_str();
		let topics = lesson_answered_topics(app, lesson, marker)?;
		per_lesson.push((lesson.clone(), topics.iter().map(|(t, _)| t.clone()).collect()));
		for (topic, n) in topics {
			match counts.iter_mut().find(|(id, _)| *id == topic) {
				Some((_, total)) => *total += n,
				None => counts.push((topic, n)),
			}
		}
	}
	counts.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
	let known = space_topics(app, space_id)?.unwrap_or_default();
	let progress = progress_for(app, space_id, None)?.unwrap_or(Json::Null);
	let mistakes = space_mistakes(app, space_id, &progress)?;
	let ctx = Context { app, vault: &vault, space_id, space: &space, mistakes: &mistakes, record: &record };
	let mut topics = Vec::new();
	for (id, _) in &counts {
		let Some(facts) = known.iter().find(|t| t.id == *id) else { continue };
		let note = &record["notes"][id.as_str()];
		if matches!(NoteState::parse(note["state"].str_or_empty()), Some(NoteState::Removed | NoteState::Yours)) {
			continue;
		}
		topics.push(ctx.topic(facts, note).await);
	}
	let kept: Vec<(String, String)> = with_reader(app, |r| r.kept_paths().into_iter().take(3).map(|p| (p.to_owned(), r.note(p).map_or_else(|| file_stem(p), |n| n.name.clone()))).collect()).unwrap_or_default();
	if topics.is_empty() {
		return Ok(None);
	}
	let included: Vec<String> = topics.iter().map(|t| t.id.clone()).collect();
	let asks = if learner_writes(setting.words) { asks_of(&per_lesson, &included, &record) } else { Vec::new() };
	let words = if learner_writes(setting.words) { Words::Mine } else { Words::Teacher };
	let block = Block { space_id: space_id.to_owned(), space_name: space["name"].str_or_empty().to_owned(), words, topics, kept };
	Ok(Some(Built { text: notes_block(&block), topics: included, at, asks }))
}

/// What the topics of one block are read from.
struct Context<'a> {
	app: &'a App,
	vault: &'a str,
	space_id: &'a str,
	space: &'a Json,
	mistakes: &'a [Json],
	record: &'a Json,
}

impl Context<'_> {
	async fn topic(&self, facts: &TopicFacts, note: &Json) -> Topic {
		let Context { app, vault, space_id, space, mistakes, record } = *self;
		let found = with_reader(app, |r| r.path_of_topic(&facts.id).map(str::to_owned)).ok().flatten().or_else(|| note["path"].as_str().filter(|p| Path::new(vault).join(p).is_file()).map(str::to_owned));
		let entry = match &found {
			Some(rel) => Entry::Update(godspeed_sections(Path::new(vault), rel, note)),
			None => Entry::New,
		};
		let sent: HashSet<&str> = note["mistakeIds"].items().iter().filter_map(Json::as_str).collect();
		let mut mine: Vec<&Json> = mistakes.iter().filter(|m| m["topicIds"].items().iter().any(|t| t.as_str() == Some(facts.id.as_str())) && !sent.contains(m["id"].str_or_empty())).collect();
		mine.sort_by(|a, b| b["at"].str_or_empty().cmp(a["at"].str_or_empty()));
		let mistakes = mine.into_iter().take(MISTAKES_PER_TOPIC).map(|m| Mistake { id: m["id"].str_or_empty().to_owned(), kind: if m["kind"].as_str() == Some("hint") { "hint" } else { "wrong" }, text: m["text"].str_or_empty().to_owned() }).collect();
		let passages = match app.search.search_space_files(space_id, space["files"].items(), &facts.name, PASSAGES_PER_TOPIC).await {
			Ok((_, rows)) => rows.iter().map(|p| (p["id"].str_or_empty().to_owned(), p["text"].str_or_empty().to_owned())).collect(),
			Err(why) => {
				eprintln!("[vault] no passages for {}: {why}", facts.name);
				Vec::new()
			}
		};
		let covering: Vec<(String, String)> = if found.is_some() {
			Vec::new()
		} else {
			with_reader(app, |r| r.search(&facts.name, 8).into_iter().filter(|h| h.owner == VaultOwner::Learner).take(COVERING_PER_TOPIC).map(|h| (h.path, h.snippet)).collect()).unwrap_or_default()
		};
		let mut links: Vec<(String, bool)> = record["notes"].as_obj().into_iter().flatten().filter(|(id, n)| id.as_str() != facts.id && n["spaceId"].as_str() == Some(space_id)).filter_map(|(_, n)| n["path"].as_str().map(|p| (file_stem(p), false))).collect();
		links.extend(covering.iter().filter_map(|(path, _)| with_reader(app, |r| r.note(path).map(|n| (note_name(&n.name), true))).ok().flatten()));
		links.truncate(LINKS_MAX);
		Topic {
			id: facts.id.clone(),
			name: facts.name.clone(),
			entry,
			standing: confidence_word(facts.status).unwrap_or("untested").to_owned(),
			answered: facts.answered.clone(),
			mistakes,
			kinds: note["kinds"].items().iter().filter_map(|k| k.as_str().map(str::to_owned)).collect(),
			passages,
			links,
			covering,
		}
	}
}

/// Per lesson, up to `ASKS_MAX` of its topics in this block whose note is new or has no "My
/// words" yet and was not skipped twice.
fn asks_of(per_lesson: &[(String, Vec<String>)], included: &[String], record: &Json) -> Vec<(String, Vec<String>)> {
	per_lesson
		.iter()
		.map(|(lesson, topics)| {
			let asked = topics.iter().filter(|t| included.contains(t)).filter(|t| askable(&record["notes"][t.as_str()])).take(ASKS_MAX).cloned().collect();
			(lesson.clone(), asked)
		})
		.filter(|(_, asked): &(String, Vec<String>)| !asked.is_empty())
		.collect()
}

fn askable(note: &Json) -> bool {
	!note["words"].truthy() && note["skips"].as_i64().unwrap_or(0) < SKIPS_BEFORE_NEVER
}

/// The lesson's pages (the shape `notes_list::page` makes, in the order the topics were
/// answered) and the asks it still owes: `{pages, asks: [{topicId, name, maxLength}]}`. None when
/// the lesson does not exist.
pub fn lesson_vault_notes(app: &App, chat_id: &str) -> Result<Option<Json>, String> {
	let Some(record) = app.stores.chats.get_chat(chat_id) else { return Ok(None) };
	let Some(space_id) = record["spaceId"].as_str().filter(|s| !s.is_empty()) else { return Ok(Some(json!({ "pages": [], "asks": [] }))) };
	let known = space_topics(app, space_id)?.unwrap_or_default();
	let saved = app.stores.vault_notes.read();
	let sending = app.vault.pass.sending.lock().get(space_id).cloned().unwrap_or_default();
	let queued = app.vault.pass.waiting.lock().get(space_id).is_some_and(|w| w.lessons.contains(chat_id));
	let marker = saved["passes"][chat_id].as_str();
	let fresh: HashSet<String> = if queued { lesson_answered_topics(app, chat_id, marker)?.into_iter().map(|(t, _)| t).collect() } else { HashSet::new() };
	let mut pages = Vec::new();
	for (id, _) in lesson_answered_topics(app, chat_id, None)? {
		let Some(facts) = known.iter().find(|t| t.id == id) else { continue };
		let note = &saved["notes"][id.as_str()];
		let waiting = !note["pending"].is_null();
		let kind = if note["path"].is_null() { None } else { NoteState::parse(note["state"].str_or_empty()).and_then(kind_of) };
		match kind {
			Some(kind) => pages.push(page(facts, note, kind, waiting)),
			None if waiting || sending.contains(&id) || fresh.contains(&id) => pages.push(page(facts, &json!({}), "godspeed", true)),
			None => {}
		}
	}
	let asks: Vec<Json> = saved["asks"][chat_id]
		.items()
		.iter()
		.filter_map(Json::as_str)
		.filter(|t| setup::setting(app).is_ok_and(|s| learner_writes(s.words)) && saved["notes"][*t]["path"].as_str().is_some() && askable(&saved["notes"][*t]))
		.filter_map(|t| known.iter().find(|k| k.id == t).map(|k| json!({ "topicId": t, "name": k.name, "maxLength": WORDS_MAX })))
		.collect();
	Ok(Some(json!({ "pages": pages, "asks": asks })))
}

/// What the learner did with an ask: typed "My words", or skipped it.
pub enum Ask {
	Words(String),
	Skip,
}

pub enum AskReply {
	Done,
	/// The lesson owes no ask for that topic.
	NotAsked,
	Refused(String),
}

/// Answers one of the lesson's "My words" asks. A skip counts against the note; after
/// `SKIPS_BEFORE_NEVER` skips it is never asked for again.
pub fn answer_ask(app: &App, chat_id: &str, topic_id: &str, ask: Ask) -> Result<AskReply, String> {
	let saved = app.stores.vault_notes.read();
	if !saved["asks"][chat_id].items().iter().any(|t| t.as_str() == Some(topic_id)) {
		return Ok(AskReply::NotAsked);
	}
	let note = &saved["notes"][topic_id];
	let space_id = note["spaceId"].str_or_empty().to_owned();
	match &ask {
		Ask::Words(words) => {
			let words = words.trim();
			if words.is_empty() || words.chars().count() > WORDS_MAX {
				return Ok(AskReply::Refused(format!("My words is 1 to {WORDS_MAX} characters.")));
			}
			if let Err(why) = write_vault_words(app, &space_id, topic_id, words) {
				return Ok(AskReply::Refused(why));
			}
		}
		Ask::Skip => {
			let skips = note["skips"].as_i64().unwrap_or(0) + 1;
			app.stores.vault_notes.update(|rec| {
				let notes = rec.get_mut("notes").and_then(Json::as_obj_mut).ok_or("vault-notes.json has no notes.")?;
				if let Some(note) = notes.get_mut(topic_id) {
					note.set("skips", skips);
				}
				Ok(())
			})?;
		}
	}
	app.stores.vault_notes.update(|rec| {
		let left: Vec<Json> = rec["asks"][chat_id].items().iter().filter(|t| t.as_str() != Some(topic_id)).cloned().collect();
		set_in(rec, "asks", chat_id, Json::Arr(left))
	})?;
	notes_changed(app);
	Ok(AskReply::Done)
}

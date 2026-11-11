//! One `<id>.json` per lesson in data/chats, with an
//! `<id>/` folder beside it for the files the learner sent.
//!
//! Only create, rename, delete and the class change announce `chats-changed`: those change the
//! list's shape. The content writers stay silent, because every list-visible change they cause
//! is already announced by turn-started and turn-settled.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::events::{EventKind, Events};
use gs_base::locks::{LockKey, Locks};
use gs_base::{fsx, ids, locale, text, time};
use gs_core::contracts::chat::{CURRENT_CHAT_VERSION, TALK_CHAT_ID};
use gs_core::graph::ports::ChatListing;
use gs_core::messages::native_messages::{active_problem_of, dangling_question_of, summary_folds_throw};
use gs_core::messages::phases::{first_phase, phase_at3_lh};
use gs_json::{Json, Obj, js_number, json, parse, stringify_pretty};
use parking_lot::Mutex;

const UNTITLED: &str = "Untitled session";

/// A summary kept while its record file's version (modified time and size) is unchanged, so a
/// sidebar refresh does not parse every lesson again. None is a record that is not a lesson.
type CachedSummary = (String, Option<Json>);

pub struct ChatStore {
	dir: PathBuf,
	events: Events,
	locks: Locks,
	summaries: Mutex<HashMap<String, CachedSummary>>,
}

impl ChatStore {
	pub fn new(paths: &Paths, events: &Events, locks: &Locks) -> ChatStore {
		ChatStore { dir: paths.chats.clone(), events: events.clone(), locks: locks.clone(), summaries: Mutex::new(HashMap::new()) }
	}

	/// The lesson's folder for files the learner sent. The id becomes a file name, so it may hold
	/// only letters, digits, `_` and `-`.
	fn chat_dir(&self, id: &str) -> Result<PathBuf, String> {
		let valid = !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
		if valid { Ok(self.dir.join(id)) } else { Err(format!("Invalid chat id: {id}")) }
	}

	fn chat_file(&self, id: &str) -> Result<PathBuf, String> {
		Ok(self.chat_dir(id)?.with_extension("json"))
	}

	/// Starts a lesson (or the Talk chat, for kind "talk"). `kind` is absent for a teach lesson,
	/// and `class_id` for "No class". Returns the record as it landed on disk.
	pub fn create_chat(&self, title: &str, kind: Option<&str>, class_id: Option<&str>, deadline_id: Option<&str>) -> Result<Json, String> {
		let now = time::iso_now();
		let kind = kind.filter(|k| !k.is_empty());
		let id = if kind == Some("talk") { TALK_CHAT_ID.to_owned() } else { ids::timed("chat") };
		let title = text::trim(title);
		let mut record = Obj::new();
		record.insert("id", id.as_str());
		record.insert("title", if title.is_empty() { UNTITLED } else { title });
		record.insert("createdAt", now.as_str());
		record.insert("updatedAt", now.as_str());
		record.insert("messages", Json::Arr(vec![]));
		for (key, value) in [("kind", kind), ("classId", class_id), ("deadlineId", deadline_id)] {
			if let Some(value) = value.filter(|v| !v.is_empty()) {
				record.insert(key, value);
			}
		}
		let mut record = Json::Obj(record);
		{
			let _guard = self.locks.lock(LockKey::Chat(&id));
			self.write_chat(&record)?;
		}
		self.events.emit(EventKind::ChatsChanged, json!({}));
		set_field(&mut record, "version", CURRENT_CHAT_VERSION);
		Ok(record)
	}

	/// Every record persist goes through here and carries the current version stamp: existing
	/// files only get stamped on their next write.
	fn write_chat(&self, record: &Json) -> Result<(), String> {
		let id = record["id"].as_str().unwrap_or_default();
		self.summaries.lock().remove(id);
		let file = self.chat_file(id)?;
		let mut stamped = record.clone();
		set_field(&mut stamped, "version", CURRENT_CHAT_VERSION);
		fsx::write_text_atomic(&file, &stringify_pretty(&stamped, "\t")).map_err(|err| fsx::node_error_message(&err, "open", &file))
	}

	/// The record, or None when it is missing, unreadable, malformed, or stamped by a newer build
	/// (a read-modify-write store must not rewrite what it does not understand).
	pub fn get_chat(&self, id: &str) -> Option<Json> {
		let raw = fsx::read_text(&self.chat_file(id).ok()?).ok()?;
		let parsed = match parse(&raw) {
			Ok(parsed) => parsed,
			Err(_) => {
				eprintln!("[chat {id}] record is not valid JSON; skipping it");
				return None;
			}
		};
		let shaped = parsed["id"].as_str().is_some() && parsed["updatedAt"].as_str().is_some() && parsed["messages"].as_arr().is_some();
		if !shaped {
			eprintln!("[chat {id}] record has the wrong shape; skipping it");
			return None;
		}
		if let Some(version) = parsed["version"].as_f64().filter(|v| *v > CURRENT_CHAT_VERSION as f64) {
			eprintln!("[chat {id}] record stamped with schema version {} > {CURRENT_CHAT_VERSION} — this app build is older; refusing to read it", js_number(version));
			return None;
		}
		Some(parsed)
	}

	/// The record file's version (modified time and size), read without parsing it: what a cache
	/// of something derived from a record keys on.
	pub fn chat_version(&self, id: &str) -> Option<String> {
		let meta = std::fs::metadata(self.chat_file(id).ok()?).ok()?;
		Some(format!("{}:{}", js_number(modified_ms(&meta)), meta.len()))
	}

	/// Every lesson's summary, newest activity first. Talk is not a lesson and never shows.
	pub fn list_chats(&self) -> Vec<Json> {
		if std::fs::create_dir_all(&self.dir).is_err() {
			return Vec::new();
		}
		let Ok(entries) = std::fs::read_dir(&self.dir) else { return Vec::new() };
		let mut names: Vec<String> = entries.flatten().filter_map(|e| e.file_name().to_string_lossy().strip_suffix(".json").map(str::to_owned)).collect();
		names.sort();
		let present: HashSet<&String> = names.iter().collect();
		self.summaries.lock().retain(|cached, _| present.contains(cached));
		let mut summaries: Vec<Json> = names.iter().filter_map(|id| self.summary_of(id)).collect();
		summaries.sort_by(|a, b| locale::compare(b["updatedAt"].as_str().unwrap_or_default(), a["updatedAt"].as_str().unwrap_or_default()));
		summaries
	}

	/// One lesson's summary through the cache; None for an unreadable record, an invalid id or Talk.
	fn summary_of(&self, id: &str) -> Option<Json> {
		let version = self.chat_version(id)?;
		if let Some((cached, summary)) = self.summaries.lock().get(id)
			&& *cached == version
		{
			return summary.clone();
		}
		let summary = self.get_chat(id).as_ref().and_then(|record| summarize(id, record));
		self.summaries.lock().insert(id.to_owned(), (version, summary.clone()));
		summary
	}

	/// Runs `change` on the saved record under the lesson's lock and saves the result.
	fn update(&self, id: &str, change: impl FnOnce(&mut Json)) -> Result<Json, String> {
		let _guard = self.locks.lock(LockKey::Chat(id));
		let mut record = self.get_chat(id).ok_or_else(|| format!("Chat not found: {id}"))?;
		change(&mut record);
		self.write_chat(&record)?;
		Ok(record)
	}

	/// Saves the whole message list: the record is the agent's state.
	pub fn save_messages(&self, id: &str, messages: &[Json]) -> Result<(), String> {
		self.update(id, |record| {
			set_field(record, "messages", messages.to_vec());
			set_field(record, "updatedAt", time::iso_now());
		})
		.map(drop)
	}

	/// Saves the session plan tree. Like a rename it is not conversation activity, so the
	/// sidebar order stays put.
	pub fn save_tree(&self, id: &str, tree: &Json) -> Result<(), String> {
		self.update(id, |record| set_field(record, "tree", tree.clone())).map(drop)
	}

	/// Adds one entry to the turn log, once per turn id: a replayed persist appends nothing new,
	/// while continuation turns that share a response message each keep their usage.
	pub fn append_turn_usage(&self, id: &str, entry: &Json) -> Result<(), String> {
		self.update(id, |record| append_once(record, "turns", entry, "id")).map(drop)
	}

	/// Adds one entry to the extraction log, once per start time, so an aborted run that reaches
	/// the append twice does not double-count its spend.
	pub fn append_extraction_usage(&self, id: &str, entry: &Json) -> Result<(), String> {
		self.update(id, |record| append_once(record, "extractions", entry, "startedAt")).map(drop)
	}

	/// Renames a lesson. Not conversation activity: `updatedAt` stays put. A blank title becomes
	/// "Untitled session".
	pub fn rename_chat(&self, id: &str, title: &str) -> Result<Json, String> {
		let title = text::trim(title);
		let record = self.update(id, |record| set_field(record, "title", if title.is_empty() { UNTITLED } else { title }))?;
		self.events.emit(EventKind::ChatsChanged, json!({}));
		Ok(record)
	}

	/// Deletes the record and its folder. False when the id is unknown. The lesson's graph traces
	/// and jobs are the route's job.
	pub fn delete_chat(&self, id: &str) -> bool {
		let _guard = self.locks.lock(LockKey::Chat(id));
		self.summaries.lock().remove(id);
		let (Ok(file), Ok(dir)) = (self.chat_file(id), self.chat_dir(id)) else { return false };
		if std::fs::remove_file(&file).is_err() {
			return false;
		}
		// Like rmSync(dir, { recursive, force }): a missing folder is fine, and a file or link in
		// its place goes too.
		let removed = match std::fs::symlink_metadata(&dir) {
			Err(err) => err.kind() == std::io::ErrorKind::NotFound,
			Ok(meta) if meta.is_dir() => std::fs::remove_dir_all(&dir).is_ok(),
			Ok(_) => std::fs::remove_file(&dir).is_ok(),
		};
		if !removed {
			return false;
		}
		// Announced only for a real removal.
		self.events.emit(EventKind::ChatsChanged, json!({}));
		true
	}

	/// Saves a file the learner sent into the lesson's folder and returns where it landed.
	pub fn save_attachment(&self, id: &str, file_name: &str, data: &[u8]) -> Result<PathBuf, String> {
		if file_name.contains('/') {
			return Err(format!("Invalid attachment name: {file_name}"));
		}
		let file = self.chat_dir(id)?.join(file_name);
		let _guard = self.locks.lock(LockKey::Chat(id));
		fsx::write_atomic(&file, data, None).map_err(|err| fsx::node_error_message(&err, "open", &file))?;
		Ok(file)
	}

	/// Sets or clears the lesson's class. Quiet like a rename (`updatedAt` stays put), but it
	/// changes which list the lesson shows in, so it announces `chats-changed`.
	pub fn set_chat_class(&self, id: &str, class_id: Option<&str>) -> Result<Json, String> {
		let record = self.update(id, |record| match class_id.filter(|c| !c.is_empty()) {
			Some(class_id) => set_field(record, "classId", class_id),
			None => {
				if let Some(o) = record.as_obj_mut() {
					o.remove("classId");
				}
			}
		})?;
		self.events.emit(EventKind::ChatsChanged, json!({}));
		Ok(record)
	}
}

/// The record's list summary: everything but the bulky parts, with the kind normalized and what
/// the session picker shows folded from the messages. Liveness is not here; the route adds it.
/// None for Talk, and for a record whose messages the folds cannot read (Node's folds throw there,
/// and the lesson stays out of the list rather than blanking it).
fn summarize(id: &str, record: &Json) -> Option<Json> {
	if record["kind"].as_str() == Some("talk") {
		return None;
	}
	let messages = record["messages"].as_arr().map_or(&[][..], Vec::as_slice);
	let start = first_phase(record["kind"].as_str());
	if summary_folds_throw(messages, start) {
		eprintln!("[chat {id}] summary projection failed");
		return None;
	}
	let mut summary: Obj = record.as_obj()?.iter().filter(|(key, _)| !matches!(key.as_str(), "messages" | "tree" | "turns" | "extractions")).map(|(key, value)| (key.clone(), value.clone())).collect();
	if summary.get("kind").is_none_or(Json::is_null) {
		summary.insert("kind", "teach");
	}
	summary.insert("messageCount", messages.len());
	summary.insert("phase", phase_at3_lh(messages, start).as_str());
	summary.insert("pendingQuestion", dangling_question_of(messages).is_some());
	summary.insert("pendingProblem", active_problem_of(messages).is_some());
	Some(Json::Obj(summary))
}

/// Sets `key` on a record, keeping its place when it already has one.
fn set_field(record: &mut Json, key: &str, value: impl Into<Json>) {
	if let Some(o) = record.as_obj_mut() {
		o.insert(key, value);
	}
}

/// Appends `entry` to the record's `log` unless an entry with the same `by` field is already there.
fn append_once(record: &mut Json, log: &str, entry: &Json, by: &str) {
	let mut entries = record[log].as_arr().cloned().unwrap_or_default();
	if !entries.iter().any(|e| e.get(by) == entry.get(by)) {
		entries.push(entry.clone());
	}
	set_field(record, log, entries);
}

/// `fs.statSync(file).mtimeMs`: seconds and nanoseconds as fractional milliseconds.
fn modified_ms(meta: &std::fs::Metadata) -> f64 {
	#[cfg(unix)]
	{
		use std::os::unix::fs::MetadataExt;
		meta.mtime() as f64 * 1000.0 + meta.mtime_nsec() as f64 / 1e6
	}
	#[cfg(not(unix))]
	{
		let since_epoch = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).unwrap_or_default();
		since_epoch.as_secs_f64() * 1000.0
	}
}

impl ChatListing for ChatStore {
	fn list_chats(&self) -> Vec<Json> {
		ChatStore::list_chats(self)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// A store over its own temp folder, removed when the test ends.
	struct Fixture {
		store: ChatStore,
		events: Events,
		root: PathBuf,
	}

	impl Fixture {
		fn new() -> Fixture {
			let root = std::env::temp_dir().join(ids::timed("chats-test"));
			let paths = Paths::new(root.clone(), root.clone(), root.clone(), root.clone());
			let events = Events::new();
			Fixture { store: ChatStore::new(&paths, &events, &Locks::new()), events, root }
		}

		/// Saves a record the way an older build left it.
		fn seed(&self, record: Json) {
			self.store.write_chat(&record).unwrap();
		}

		fn file(&self, id: &str) -> PathBuf {
			self.store.dir.join(format!("{id}.json"))
		}
	}

	impl Drop for Fixture {
		fn drop(&mut self) {
			let _ = std::fs::remove_dir_all(&self.root);
		}
	}

	fn keys(v: &Json) -> Vec<&str> {
		v.as_obj().unwrap().keys().map(String::as_str).collect()
	}

	fn old(id: &str, updated_at: &str) -> Json {
		json!({ "id": id, "title": id, "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": updated_at, "messages": [] })
	}

	#[test]
	fn a_new_lesson_lands_with_tabs_and_a_version_stamp() {
		let fx = Fixture::new();
		let mut changes = fx.events.subscribe();
		let record = fx.store.create_chat("  Limits  ", None, Some("cls_1"), Some("")).unwrap();
		assert_eq!(keys(&record), ["id", "title", "createdAt", "updatedAt", "messages", "classId", "version"]);
		assert_eq!(record["title"], json!("Limits"));
		let id = record["id"].as_str().unwrap();
		assert!(id.starts_with("chat_"));
		let raw = std::fs::read_to_string(fx.file(id)).unwrap();
		assert!(raw.starts_with(&format!("{{\n\t\"id\": \"{id}\",\n\t\"title\": \"Limits\",")));
		assert!(raw.ends_with("\"messages\": [],\n\t\"classId\": \"cls_1\",\n\t\"version\": 1\n}"));
		assert_eq!(fx.store.get_chat(id), Some(record));
		assert_eq!(changes.try_recv().unwrap().kind, EventKind::ChatsChanged);
	}

	#[test]
	fn talk_has_a_fixed_id_and_blank_titles_get_a_name() {
		let fx = Fixture::new();
		let talk = fx.store.create_chat(" ", Some("talk"), None, None).unwrap();
		assert_eq!((talk["id"].as_str(), talk["title"].as_str(), talk["kind"].as_str()), (Some("chat_talk"), Some("Untitled session"), Some("talk")));
		let renamed = fx.store.rename_chat("chat_talk", "  ").unwrap();
		assert_eq!(renamed["title"], json!("Untitled session"));
		assert!(fx.store.list_chats().is_empty());
	}

	#[test]
	fn unusable_records_read_as_missing() {
		let fx = Fixture::new();
		std::fs::create_dir_all(&fx.store.dir).unwrap();
		let put = |id: &str, text: &str| fsx::write_text_atomic(&fx.file(id), text).unwrap();
		let plain = r#"{"id":"plain","updatedAt":"x","messages":[],"version":1}"#;
		put("broken", "{ nope");
		put("shapeless", r#"{"id":"shapeless","messages":[]}"#);
		put("future", r#"{"id":"future","updatedAt":"x","messages":[],"version":2}"#);
		put("plain", plain);
		for id in ["broken", "shapeless", "future", "missing", "../escape", ""] {
			assert!(fx.store.get_chat(id).is_none(), "{id}");
		}
		assert!(fx.store.get_chat("plain").is_some());
		assert_eq!(fx.store.chat_version("../escape"), None);
		assert!(fx.store.chat_version("plain").unwrap().ends_with(&format!(":{}", plain.len())));
	}

	#[test]
	fn writers_keep_updated_at_where_the_typescript_does() {
		let fx = Fixture::new();
		fx.seed(old("chat_a", "2026-01-02T00:00:00.000Z"));
		fx.store.rename_chat("chat_a", "New").unwrap();
		fx.store.set_chat_class("chat_a", Some("cls_1")).unwrap();
		fx.store.save_tree("chat_a", &json!({ "nodes": [] })).unwrap();
		fx.store.append_turn_usage("chat_a", &json!({ "id": "t1", "tokens": 1 })).unwrap();
		fx.store.append_turn_usage("chat_a", &json!({ "id": "t1", "tokens": 2 })).unwrap();
		fx.store.append_turn_usage("chat_a", &json!({ "id": "t2" })).unwrap();
		fx.store.append_extraction_usage("chat_a", &json!({ "startedAt": "s" })).unwrap();
		fx.store.append_extraction_usage("chat_a", &json!({ "startedAt": "s" })).unwrap();
		let record = fx.store.get_chat("chat_a").unwrap();
		assert_eq!(record["updatedAt"], json!("2026-01-02T00:00:00.000Z"));
		assert_eq!((record["title"].as_str(), record["classId"].as_str()), (Some("New"), Some("cls_1")));
		assert_eq!(record["turns"], json!([{ "id": "t1", "tokens": 1 }, { "id": "t2" }]));
		assert_eq!(record["extractions"], json!([{ "startedAt": "s" }]));
		assert_eq!(keys(&record), ["id", "title", "createdAt", "updatedAt", "messages", "version", "classId", "tree", "turns", "extractions"]);
		let cleared = fx.store.set_chat_class("chat_a", None).unwrap();
		assert!(cleared.get("classId").is_none());
		fx.store.save_messages("chat_a", &[json!({ "role": "user", "content": "hi" })]).unwrap();
		let saved = fx.store.get_chat("chat_a").unwrap();
		assert_ne!(saved["updatedAt"], json!("2026-01-02T00:00:00.000Z"));
		assert_eq!(saved["messages"].as_arr().unwrap().len(), 1);
		assert_eq!(fx.store.save_messages("chat_none", &[]), Err("Chat not found: chat_none".to_owned()));
		assert_eq!(fx.store.rename_chat("../x", "t").unwrap_err(), "Chat not found: ../x");
	}

	#[test]
	fn the_list_is_newest_first_with_summaries_that_follow_writes() {
		let fx = Fixture::new();
		fx.seed(old("chat_a", "2026-01-01T00:00:00.000Z"));
		let mut newer = old("chat_b", "2026-01-03T00:00:00.000Z");
		set_field(&mut newer, "turns", vec![json!({ "id": "t" })]);
		set_field(&mut newer, "messages", vec![json!({ "role": "user", "content": "hi" })]);
		fx.seed(newer);
		fx.seed(json!({ "id": "chat_talk", "title": "Talk", "createdAt": "x", "updatedAt": "2026-02-01T00:00:00.000Z", "kind": "talk", "messages": [] }));
		fsx::write_text_atomic(&fx.file("not valid"), "x").unwrap();
		let list = fx.store.list_chats();
		assert_eq!(list.iter().map(|s| s["id"].as_str().unwrap()).collect::<Vec<_>>(), ["chat_b", "chat_a"]);
		let tail = ["messageCount", "phase", "pendingQuestion", "pendingProblem"];
		assert_eq!(keys(&list[1]), ["id", "title", "createdAt", "updatedAt", "version", "kind"].into_iter().chain(tail).collect::<Vec<_>>());
		assert_eq!(keys(&list[0]), ["id", "title", "createdAt", "updatedAt", "version", "kind"].into_iter().chain(tail).collect::<Vec<_>>());
		assert_eq!((list[0]["kind"].as_str(), list[0]["messageCount"].as_i64(), list[0]["pendingQuestion"].as_bool(), list[0]["pendingProblem"].as_bool()), (Some("teach"), Some(1), Some(false), Some(false)));
		fx.store.rename_chat("chat_a", "Renamed").unwrap();
		assert_eq!(fx.store.list_chats()[1]["title"], json!("Renamed"));
		assert!(fx.store.delete_chat("chat_a"));
		assert_eq!(fx.store.list_chats().len(), 1);
	}

	#[test]
	fn lone_surrogates_survive_a_read_and_a_write() {
		let fx = Fixture::new();
		std::fs::create_dir_all(&fx.store.dir).unwrap();
		let text = r#"{"id":"chat_s","title":"\ud800x","createdAt":"x","updatedAt":"y","messages":[{"role":"user","content":"\udfff"}]}"#;
		fsx::write_text_atomic(&fx.file("chat_s"), text).unwrap();
		fx.store.save_tree("chat_s", &json!({})).unwrap();
		let raw = std::fs::read_to_string(fx.file("chat_s")).unwrap();
		assert!(raw.contains(r#""title": "\ud800x""#) && raw.contains(r#""content": "\udfff""#), "{raw}");
	}

	#[test]
	fn lessons_whose_messages_break_the_folds_stay_out_of_the_list() {
		let fx = Fixture::new();
		let with = |id: &str, messages: Json| {
			let mut record = old(id, "2026-01-01T00:00:00.000Z");
			set_field(&mut record, "messages", messages);
			fx.seed(record);
		};
		with("chat_null", json!([null]));
		with("chat_bare", json!([{ "role": "assistant" }]));
		with("chat_odd", json!(["str", 5]));
		assert_eq!(fx.store.list_chats().iter().map(|s| s["id"].as_str().unwrap()).collect::<Vec<_>>(), ["chat_odd"]);
		assert!(fx.store.get_chat("chat_null").is_some());
	}

	#[test]
	fn delete_removes_the_record_and_its_folder_once() {
		let fx = Fixture::new();
		let id = fx.store.create_chat("t", None, None, None).unwrap()["id"].as_str().unwrap().to_owned();
		let file = fx.store.save_attachment(&id, "a.png", b"png").unwrap();
		assert_eq!(std::fs::read(&file).unwrap(), b"png");
		assert_eq!(fx.store.save_attachment(&id, "dir/a.png", b"x").unwrap_err(), "Invalid attachment name: dir/a.png");
		assert_eq!(fx.store.save_attachment("../x", "a.png", b"x").unwrap_err(), "Invalid chat id: ../x");
		let mut changes = fx.events.subscribe();
		assert!(fx.store.delete_chat(&id));
		assert_eq!(changes.try_recv().unwrap().kind, EventKind::ChatsChanged);
		assert!(!fx.file(&id).exists() && !file.exists());
		assert!(!fx.store.delete_chat(&id) && !fx.store.delete_chat("../x"));
		assert!(changes.try_recv().is_err());
		// A file where the folder would be goes with the record, as rmSync takes it.
		fx.seed(old("chat_f", "x"));
		fsx::write_text_atomic(&fx.store.dir.join("chat_f"), "file").unwrap();
		assert!(fx.store.delete_chat("chat_f"));
		assert!(!fx.store.dir.join("chat_f").exists());
	}
}

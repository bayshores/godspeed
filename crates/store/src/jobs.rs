//! One file per background sub-agent job in data/jobs,
//! named by job id. A job is a JSON record the services read and patch whole.
//!
//! Every write announces `jobs-changed` after it lands, so the window can skip polling.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::SystemTime;

use gs_base::config::Paths;
use gs_base::events::{EventKind, Events};
use gs_base::locks::{LockKey, Locks};
use gs_base::re::Re;
use gs_base::{fsx, ids, locale, time};
use gs_json::{Json, Obj, json, parse, stringify_pretty};
use parking_lot::Mutex;

/// A job's identity never changes after it is made.
const IDENTITY_KEYS: [&str; 5] = ["id", "kind", "chatId", "toolCallId", "createdAt"];

/// What a new job starts from.
pub struct CreateJobInit<'a> {
	pub kind: &'a str,
	pub chat_id: &'a str,
	pub tool_call_id: &'a str,
	/// First activity line (defaults to "starting").
	pub activity: Option<&'a str>,
	/// Saved on the job before its worker is spawned.
	pub input: Option<Json>,
}

/// A parsed record, kept while its file's modified time and size are unchanged: the activity
/// feed and every turn start list every job of every lesson, and a record holds its whole result.
struct Cached {
	version: (Option<SystemTime>, u64),
	job: Option<Arc<Json>>,
}

pub struct JobStore {
	dir: PathBuf,
	events: Events,
	locks: Locks,
	cache: Mutex<HashMap<String, Cached>>,
}

impl JobStore {
	pub fn new(paths: &Paths, events: &Events, locks: &Locks) -> JobStore {
		JobStore { dir: paths.data.join("jobs"), events: events.clone(), locks: locks.clone(), cache: Mutex::new(HashMap::new()) }
	}

	/// The file of a job; None when the id could be a path.
	fn job_file(&self, id: &str) -> Option<PathBuf> {
		static SHAPE: std::sync::LazyLock<Re> = std::sync::LazyLock::new(|| Re::new(r"^[A-Za-z0-9_-]+$", ""));
		SHAPE.test(id).then(|| self.dir.join(format!("{id}.json")))
	}

	/// A new running job, saved and announced.
	pub fn create_job(&self, init: &CreateJobInit) -> Result<Json, String> {
		let now = time::iso_now();
		let id = ids::timed("job");
		let mut record = Obj::new();
		record.insert("id", id.as_str());
		record.insert("kind", init.kind);
		record.insert("chatId", init.chat_id);
		record.insert("toolCallId", init.tool_call_id);
		if let Some(input) = &init.input {
			record.insert("input", input.clone());
		}
		record.insert("status", "running");
		record.insert("activity", init.activity.unwrap_or("starting"));
		record.insert("createdAt", now.as_str());
		record.insert("updatedAt", now.as_str());
		let record = Json::Obj(record);
		self.write_job(&id, &record)?;
		self.events.emit(EventKind::JobsChanged, json!({ "chatId": init.chat_id }));
		Ok(record)
	}

	/// The job, or None when it is unknown or its file is unreadable. Records are shared: clone
	/// before changing one.
	pub fn get_job(&self, id: &str) -> Option<Arc<Json>> {
		let Some(file) = self.job_file(id) else {
			self.cache.lock().remove(id);
			return None;
		};
		let Ok(meta) = std::fs::metadata(&file) else {
			self.cache.lock().remove(id);
			return None;
		};
		let version = (meta.modified().ok(), meta.len());
		if let Some(hit) = self.cache.lock().get(id).filter(|hit| hit.version == version) {
			return hit.job.clone();
		}
		let parsed = parse(&fsx::read_text(&file).ok()?).ok()?;
		let valid = ["id", "chatId", "updatedAt", "status"].iter().all(|key| parsed[*key].as_str().is_some());
		let job = valid.then(|| Arc::new(parsed));
		self.cache.lock().insert(id.to_owned(), Cached { version, job: job.clone() });
		job
	}

	/// Merges a patch into the job (its identity fields are skipped) and bumps `updatedAt`, unless
	/// the patch sets one. None when the id is unknown.
	pub fn update_job(&self, id: &str, patch: &Json) -> Result<Option<Json>, String> {
		self.update_job_if(id, patch, |_| true)
	}

	/// `update_job` only while `when` holds for the job as it is, checked under the job's lock, so
	/// of two writers that each expect a running job (an abort and a finish) only one writes.
	/// None when the id is unknown or `when` is false.
	pub fn update_job_if(&self, id: &str, patch: &Json, when: impl FnOnce(&Json) -> bool) -> Result<Option<Json>, String> {
		if self.job_file(id).is_none() {
			return Ok(None);
		}
		let _guard = self.locks.lock(LockKey::AppFile(&format!("jobs/{id}.json")));
		let Some(record) = self.get_job(id).filter(|job| when(job)) else { return Ok(None) };
		let mut next = record.as_obj().cloned().unwrap_or_default();
		for (key, value) in patch.as_obj().map(Obj::iter).into_iter().flatten().filter(|(k, _)| !IDENTITY_KEYS.contains(&k.as_str())) {
			next.insert(key.clone(), value.clone());
		}
		let set_by_patch = patch.get("updatedAt").filter(|v| !v.is_null());
		next.insert("updatedAt", set_by_patch.cloned().unwrap_or_else(|| Json::from(time::iso_now())));
		let next = Json::Obj(next);
		self.write_job(id, &next)?;
		// A same-size write within the clock's tick keeps the file's version.
		self.cache.lock().remove(id);
		// Every write, not just status changes: progress lines must reach the dispatch cards.
		self.events.emit(EventKind::JobsChanged, json!({ "chatId": next["chatId"].clone() }));
		Ok(Some(next))
	}

	/// Every job across all chats, newest activity first.
	pub fn list_all_jobs(&self) -> Vec<Arc<Json>> {
		if std::fs::create_dir_all(&self.dir).is_err() {
			return Vec::new();
		}
		let Ok(entries) = std::fs::read_dir(&self.dir) else { return Vec::new() };
		let mut names: Vec<String> = entries.flatten().filter_map(|e| e.file_name().to_string_lossy().strip_suffix(".json").map(str::to_owned)).collect();
		names.sort();
		let present: HashSet<&String> = names.iter().collect();
		self.cache.lock().retain(|cached, _| present.contains(cached));
		let mut jobs: Vec<Arc<Json>> = names.iter().filter_map(|id| self.get_job(id)).collect();
		jobs.sort_by(|a, b| locale::compare(b["updatedAt"].as_str().unwrap_or(""), a["updatedAt"].as_str().unwrap_or("")));
		jobs
	}

	/// All jobs for a chat, newest activity first.
	pub fn list_jobs(&self, chat_id: &str) -> Vec<Arc<Json>> {
		self.list_all_jobs().into_iter().filter(|j| j["chatId"].as_str() == Some(chat_id)).collect()
	}

	/// The job fulfilling a given tool part, if any (the spawn hook's dedup).
	pub fn find_job_by_tool_call_id(&self, chat_id: &str, tool_call_id: &str) -> Option<Arc<Json>> {
		self.list_jobs(chat_id).into_iter().find(|j| j["toolCallId"].as_str() == Some(tool_call_id))
	}

	/// Deletes every job record of a chat, running or finished, and returns how many files went.
	pub fn delete_jobs_for_chat(&self, chat_id: &str) -> usize {
		let mut removed = 0;
		for job in self.list_jobs(chat_id) {
			let id = job["id"].as_str().unwrap_or_default();
			// An update running at the same time must not write the file back.
			let _guard = self.locks.lock(LockKey::AppFile(&format!("jobs/{id}.json")));
			if self.job_file(id).is_some_and(|file| std::fs::remove_file(file).is_ok()) {
				self.cache.lock().remove(id);
				removed += 1;
			}
		}
		// A delete that removed nothing wrote nothing, so it announces nothing.
		if removed > 0 {
			self.events.emit(EventKind::JobsChanged, json!({ "chatId": chat_id }));
		}
		removed
	}

	fn write_job(&self, id: &str, record: &Json) -> Result<(), String> {
		let file = self.job_file(id).ok_or_else(|| format!("Invalid job id: {id}"))?;
		fsx::write_text_atomic(&file, &stringify_pretty(record, "\t")).map_err(|err| fsx::node_error_message(&err, "open", &file))
	}
}

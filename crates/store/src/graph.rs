//! The append-only graph ledgers and the imported-notes records.
//!
//! One graph family per scope: None is "No class" (data/graph), a class id is that class's own
//! graph (data/classes/<id>/graph). Each family holds
//!
//! - nodes.jsonl, chains.jsonl, sessions.jsonl (checkpoints), coverage.jsonl, topics.jsonl:
//!   one JSON record per line, appended and never edited. Reads skip lines that are not valid
//!   JSON or not the right shape, so a torn append never takes the graph down.
//! - sources.json: one JSON map of imported-notes records, read-modify-write.
//! - format.json: the format stamp, written with the first write. A family stamped newer than
//!   this build refuses every read, because a store must never rewrite what it does not understand.

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use gs_base::config::{GraphFiles, Paths};
use gs_base::locks::{LockKey, Locks};
use gs_base::{fsx, text};
use gs_core::contracts::class::is_class_id;
use gs_core::contracts::graph::CURRENT_GRAPH_FORMAT_VERSION;
use gs_core::records::entries;
use gs_json::{Json, Obj, js_number, json, parse, stringify, stringify_pretty};
use parking_lot::Mutex;

/// The ledgers of a graph family.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Ledger {
	Nodes,
	Chains,
	/// sessions.jsonl: the extraction checkpoints.
	Checkpoints,
	Coverage,
	/// Reads keep only the newest snapshot.
	Topics,
}

impl Ledger {
	fn file(self, files: &GraphFiles) -> &Path {
		match self {
			Ledger::Nodes => &files.nodes,
			Ledger::Chains => &files.chains,
			Ledger::Checkpoints => &files.sessions,
			Ledger::Coverage => &files.coverage,
			Ledger::Topics => &files.topics,
		}
	}

	fn is_valid(self, line: &Json) -> bool {
		match self {
			Ledger::Nodes => is_graph_node(line),
			Ledger::Chains => is_graph_chain(line),
			Ledger::Checkpoints => has_strings(line, &["chatId", "foldedAt"]),
			Ledger::Coverage => has_strings(line, &["chatId", "fp", "foldedAt"]) && line["tokens"].as_f64().is_some(),
			Ledger::Topics => is_topic_snapshot(line),
		}
	}
}

/// The valid lines of a ledger, kept while its file's modified time and size are unchanged, so a
/// graph read does not parse whole files again.
struct Cached {
	version: (Option<SystemTime>, u64),
	lines: Arc<Vec<Json>>,
}

pub struct GraphStores {
	paths: Paths,
	locks: Locks,
	cache: Mutex<HashMap<PathBuf, Cached>>,
}

impl GraphStores {
	pub fn new(paths: &Paths, locks: &Locks) -> GraphStores {
		purge_legacy_ledgers(&paths.graph);
		GraphStores { paths: paths.clone(), locks: locks.clone(), cache: Mutex::new(HashMap::new()) }
	}

	/// A scope's files; Err for a class id that could be a path.
	fn files(&self, scope: Option<&str>) -> Result<GraphFiles, String> {
		let dir = match scope {
			None => self.paths.graph.clone(),
			Some(class_id) if is_class_id(class_id) => self.paths.classes.join(class_id).join("graph"),
			Some(class_id) => return Err(format!("Invalid class id: {class_id}")),
		};
		Ok(GraphFiles::new(&dir))
	}

	/// Appends one record to a ledger. The family's format stamp is written first.
	pub fn append(&self, scope: Option<&str>, ledger: Ledger, record: &Json) -> Result<(), String> {
		let _guard = self.locks.lock(LockKey::Graph(scope));
		let files = self.files(scope)?;
		let file = ledger.file(&files);
		if let Some(dir) = file.parent() {
			std::fs::create_dir_all(dir).map_err(|err| fsx::node_error_message(&err, "mkdir", dir))?;
		}
		ensure_graph_format(&files.format)?;
		self.cache.lock().remove(file);
		let line = format!("{}\n", stringify(record));
		let appended = std::fs::OpenOptions::new().create(true).append(true).open(file).and_then(|mut f| f.write_all(&text::utf8_bytes(&line)));
		appended.map_err(|err| fsx::node_error_message(&err, "open", file))
	}

	/// The valid records of a ledger in append order. Err when the family is stamped newer than
	/// this build.
	pub fn read(&self, scope: Option<&str>, ledger: Ledger) -> Result<Arc<Vec<Json>>, String> {
		let files = self.files(scope)?;
		assert_graph_format(&files.format)?;
		let file = ledger.file(&files);
		let Ok(meta) = std::fs::metadata(file) else {
			self.cache.lock().remove(file);
			return Ok(Arc::default());
		};
		let version = (meta.modified().ok(), meta.len());
		if let Some(hit) = self.cache.lock().get(file).filter(|hit| hit.version == version) {
			return Ok(hit.lines.clone());
		}
		let lines = Arc::new(parse_ledger(file, ledger));
		self.cache.lock().insert(file.to_path_buf(), Cached { version, lines: lines.clone() });
		Ok(lines)
	}

	/// The newest topic snapshot, if any.
	pub fn read_topics(&self, scope: Option<&str>) -> Result<Option<Json>, String> {
		Ok(self.read(scope, Ledger::Topics)?.last().cloned())
	}

	/// Replaces whole ledgers, each atomically (never a torn ledger). An empty list writes an
	/// empty file, which reads as nothing emitted yet. The format stamp is left alone.
	pub fn rewrite_ledgers(&self, scope: Option<&str>, ledgers: &[(Ledger, &[Json])]) -> Result<(), String> {
		let _guard = self.locks.lock(LockKey::Graph(scope));
		let files = self.files(scope)?;
		for (ledger, records) in ledgers {
			let file = ledger.file(&files);
			self.cache.lock().remove(file);
			let lines: Vec<String> = records.iter().map(stringify).collect();
			// One record per line with a trailing newline, exactly what append would have written.
			let content = if lines.is_empty() { String::new() } else { format!("{}\n", lines.join("\n")) };
			fsx::write_text_atomic(file, &content).map_err(|err| fsx::node_error_message(&err, "open", file))?;
		}
		Ok(())
	}

	/// Adds an imported-notes record. Re-importing keeps the existing record's usage log.
	pub fn upsert_source(&self, scope: Option<&str>, source: &Json) -> Result<(), String> {
		let id = source["id"].as_str().ok_or("a notes source needs an id")?;
		let _guard = self.locks.lock(LockKey::Graph(scope));
		let files = self.files(scope)?;
		let mut all = read_source_map(&files)?;
		let mut next = source.clone();
		if let (Some(prev), Some(record)) = (all.get(id), next.as_obj_mut()) {
			match prev.get("extractions") {
				Some(extractions) => record.insert("extractions", extractions.clone()),
				None => record.remove("extractions"),
			};
		}
		all.insert(id, next);
		write_source_map(&files, &all)
	}

	/// Every imported-notes record.
	pub fn read_sources(&self, scope: Option<&str>) -> Result<Vec<Json>, String> {
		Ok(read_source_map(&self.files(scope)?)?.values().cloned().collect())
	}

	/// False when no record has that id.
	pub fn remove_source(&self, scope: Option<&str>, id: &str) -> Result<bool, String> {
		let _guard = self.locks.lock(LockKey::Graph(scope));
		let files = self.files(scope)?;
		let mut all = read_source_map(&files)?;
		if all.remove(id).is_none() {
			return Ok(false);
		}
		write_source_map(&files, &all)?;
		Ok(true)
	}

	/// Adds one extraction run to a source's usage log; a run already there (same `startedAt`) is
	/// not added twice, and an unknown source changes nothing.
	pub fn append_source_usage(&self, scope: Option<&str>, id: &str, entry: &Json) -> Result<(), String> {
		let _guard = self.locks.lock(LockKey::Graph(scope));
		let files = self.files(scope)?;
		let mut all = read_source_map(&files)?;
		let Some(source) = all.get_mut(id) else { return Ok(()) };
		let mut runs = source["extractions"].as_arr().cloned().unwrap_or_default();
		if !runs.iter().any(|run| run["startedAt"] == entry["startedAt"]) {
			runs.push(entry.clone());
			if let Some(record) = source.as_obj_mut() {
				record.insert("extractions", runs);
			}
		}
		write_source_map(&files, &all)
	}

	/// Drops a deleted class's parsed ledgers: nothing reads them again.
	pub fn forget_graph_store(&self, class_id: &str) {
		let Ok(files) = self.files(Some(class_id)) else { return };
		let mut cache = self.cache.lock();
		for file in [&files.nodes, &files.chains, &files.sessions, &files.coverage, &files.sources, &files.format, &files.topics] {
			cache.remove(file);
		}
	}
}

/// Ledgers older builds kept and nothing reads or writes now; a stale file would only mislead.
fn purge_legacy_ledgers(graph_dir: &Path) {
	for legacy in ["edges.jsonl", "events.jsonl"] {
		let file = graph_dir.join(legacy);
		if file.exists() {
			match std::fs::remove_file(&file) {
				Ok(()) => eprintln!("[graph-store] purged legacy ledger: {}", file.display()),
				Err(err) => eprintln!("[graph-store] could not purge legacy ledger {}: {err}", file.display()),
			}
		}
	}
}

/// The valid records of a ledger file; Topics keeps only the newest.
fn parse_ledger(file: &Path, ledger: Ledger) -> Vec<Json> {
	let Ok(raw) = fsx::read_text(file) else { return Vec::new() };
	let mut valid: Vec<Json> = raw.split('\n').map(text::trim).filter(|line| !line.is_empty()).filter_map(|line| parse(line).ok()).filter(|record| ledger.is_valid(record)).collect();
	if ledger == Ledger::Topics {
		valid = valid.pop().into_iter().collect();
	}
	valid
}

/// A string-keyed set of fields that are all strings.
fn has_strings(value: &Json, keys: &[&str]) -> bool {
	keys.iter().all(|key| value[*key].as_str().is_some())
}

fn all_strings(value: &Json) -> bool {
	value.as_arr().is_some_and(|list| list.iter().all(|v| v.as_str().is_some()))
}

/// A (chat, message) pair: provenance is message-granular.
fn all_provenance_points(value: &Json) -> bool {
	value.as_arr().is_some_and(|list| list.iter().all(|point| has_strings(point, &["chatId", "messageId"])))
}

fn is_graph_node(line: &Json) -> bool {
	has_strings(line, &["id", "name", "statement", "createdAt"]) && all_strings(&line["aliases"]) && all_provenance_points(&line["provenance"])
}

/// A chain is an argument, so it has at least one premise; whether its endpoints exist is the
/// derivation's concern.
fn is_graph_chain(line: &Json) -> bool {
	has_strings(line, &["id", "conclusion", "createdAt"]) && all_strings(&line["premises"]) && line["premises"].as_arr().is_some_and(|p| !p.is_empty()) && all_provenance_points(&line["provenance"])
}

fn is_topic_snapshot(line: &Json) -> bool {
	let topics_ok = line["topics"].as_arr().is_some_and(|list| list.iter().all(|t| has_strings(t, &["id", "name"]) && all_strings(&t["members"])));
	has_strings(line, &["at"]) && topics_ok
}

fn is_notes_source(value: &Json) -> bool {
	has_strings(value, &["id", "filePath", "importedAt"])
}

/// The family's stamped format version; None when there is no sidecar or it is unusable (a
/// corrupt sidecar reads as unstamped, not fatal).
fn stamped_version(file: &Path) -> Option<f64> {
	let parsed = parse(&fsx::read_text(file).ok()?).ok()?;
	parsed["version"].as_f64().filter(|v| v.is_finite() && v.fract() == 0.0)
}

/// Err when the family was written by a newer build. Never writes.
fn assert_graph_format(file: &Path) -> Result<(), String> {
	match stamped_version(file) {
		Some(v) if v > CURRENT_GRAPH_FORMAT_VERSION as f64 => Err(format!(
			"Graph data is stamped with format version {}, but this build understands only {CURRENT_GRAPH_FORMAT_VERSION}. This version of godspeed is older than your data. Update the app to open your graph.",
			js_number(v)
		)),
		_ => Ok(()),
	}
}

/// Writes the stamp with the family's first write; afterwards it does nothing.
fn ensure_graph_format(file: &Path) -> Result<(), String> {
	if stamped_version(file).is_some() {
		return Ok(());
	}
	let stamp = format!("{}\n", stringify_pretty(&json!({ "version": CURRENT_GRAPH_FORMAT_VERSION }), "\t"));
	fsx::write_text_atomic(file, &stamp).map_err(|err| fsx::node_error_message(&err, "open", file))
}

/// sources.json as a map of id to record. Anything unreadable is an empty map. A `__proto__` key
/// is lost, as in JS, where assigning it sets the prototype instead of a key.
fn read_source_map(files: &GraphFiles) -> Result<Obj, String> {
	assert_graph_format(&files.format)?;
	let parsed = fsx::read_text(&files.sources).ok().and_then(|raw| parse(&raw).ok()).unwrap_or(Json::Null);
	let mut map = Obj::new();
	for (id, value) in entries(&parsed) {
		if is_notes_source(value) && id != "__proto__" {
			map.insert(id, value.clone());
		}
	}
	Ok(map)
}

fn write_source_map(files: &GraphFiles, map: &Obj) -> Result<(), String> {
	ensure_graph_format(&files.format)?;
	fsx::write_text_atomic(&files.sources, &stringify_pretty(&Json::Obj(map.clone()), "\t")).map_err(|err| fsx::node_error_message(&err, "open", &files.sources))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn lines_are_checked_against_their_ledger() {
		let node = parse(r#"{"id":"n","name":"a","statement":"s","aliases":["x"],"createdAt":"t","provenance":[{"chatId":"c","messageId":"m"}]}"#).unwrap();
		assert!(Ledger::Nodes.is_valid(&node));
		assert!(!Ledger::Nodes.is_valid(&parse(r#"{"id":"n","name":"a","statement":"s","aliases":[1],"createdAt":"t","provenance":[]}"#).unwrap()));
		assert!(!Ledger::Nodes.is_valid(&parse(r#"{"id":"n","name":"a","statement":"s","aliases":[],"createdAt":"t","provenance":[{"chatId":"c"}]}"#).unwrap()));
		let chain = r#"{"id":"c","premises":["a"],"conclusion":"b","provenance":[],"createdAt":"t"}"#;
		assert!(Ledger::Chains.is_valid(&parse(chain).unwrap()));
		assert!(!Ledger::Chains.is_valid(&parse(&chain.replace(r#"["a"]"#, "[]")).unwrap()));
		assert!(Ledger::Coverage.is_valid(&parse(r#"{"chatId":"c","fp":"f","tokens":0,"foldedAt":"t"}"#).unwrap()));
		assert!(!Ledger::Coverage.is_valid(&parse(r#"{"chatId":"c","fp":"f","tokens":"1","foldedAt":"t"}"#).unwrap()));
		assert!(Ledger::Topics.is_valid(&parse(r#"{"at":"t","topics":[{"id":"i","name":"n","members":[]}]}"#).unwrap()));
		assert!(!Ledger::Topics.is_valid(&parse(r#"{"at":"t","topics":[{"id":"i","name":"n"}]}"#).unwrap()));
		assert!(!Ledger::Checkpoints.is_valid(&Json::Null));
	}
}

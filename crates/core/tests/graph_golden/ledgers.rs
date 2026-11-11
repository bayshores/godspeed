//! The ledgers a case starts from: a fixture class by name, or the ledgers inline (the Rust
//! twin of `fixture` and `load` in the TypeScript spec).

use std::path::PathBuf;
use std::sync::Mutex;

use gs_json::{Json, Obj, parse};

use crate::store::{Chats, MemStore, Parts};

const KEYS: [&str; 7] = ["nodes", "chains", "coverage", "checkpoints", "sources", "chats", "topics"];

fn fixtures() -> PathBuf {
	PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/graph"))
}

fn jsonl(path: PathBuf) -> Json {
	let text = std::fs::read_to_string(&path).unwrap_or_default();
	text.lines().filter(|line| !line.is_empty()).map(|line| parse(line).unwrap()).collect()
}

fn json_file(path: PathBuf) -> Json {
	parse(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// A fixture transcript.
pub fn transcript(id: &str) -> Vec<Json> {
	json_file(fixtures().join("transcripts").join(format!("{id}.json"))).as_arr().unwrap().clone()
}

/// The seven ledgers of one case: `nodes`, `chains`, `coverage`, `checkpoints`, `sources`, `chats`, `topics`.
pub struct Ledgers(pub Obj);

impl Ledgers {
	/// `spec` is a fixture name or the ledgers object.
	pub fn load(spec: &Json) -> Ledgers {
		let mut all = Obj::new();
		if let Some(name) = spec.as_str() {
			let dir = fixtures().join(name);
			all.insert("nodes", jsonl(dir.join("nodes.jsonl")));
			all.insert("chains", jsonl(dir.join("chains.jsonl")));
			all.insert("coverage", jsonl(dir.join("coverage.jsonl")));
			all.insert("checkpoints", jsonl(dir.join("sessions.jsonl")));
			all.insert("sources", json_file(dir.join("sources.json")));
			all.insert("chats", json_file(fixtures().join("chats.json")));
			all.insert("topics", jsonl(dir.join("topics.jsonl")));
		} else {
			for key in KEYS {
				all.insert(key, spec.get(key).cloned().unwrap_or_else(|| Json::Arr(Vec::new())));
			}
		}
		Ledgers(all)
	}

	pub fn part(&self, key: &str) -> Vec<Json> {
		self.0.get(key).and_then(Json::as_arr).cloned().unwrap_or_default()
	}

	pub fn store(&self) -> MemStore {
		let parts = Parts { nodes: self.part("nodes"), chains: self.part("chains"), coverage: self.part("coverage"), checkpoints: self.part("checkpoints"), sources: self.part("sources") };
		MemStore { parts: Mutex::new(parts), ..MemStore::default() }
	}

	pub fn chats(&self) -> Chats {
		Chats(self.part("chats"))
	}
}

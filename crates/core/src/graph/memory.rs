//! An in-memory graph store for this folder's unit tests.

use std::sync::Mutex;

use gs_json::{Json, json};

use super::ports::{ChatListing, GraphStore, LedgerRewrite};

#[derive(Default)]
pub struct Ledgers {
	pub nodes: Vec<Json>,
	pub chains: Vec<Json>,
	pub coverage: Vec<Json>,
	pub checkpoints: Vec<Json>,
	pub sources: Vec<Json>,
}

/// The ledgers, plus the rewrites made (which ledgers each replaced).
#[derive(Default)]
pub struct Memory {
	pub ledgers: Mutex<Ledgers>,
	pub rewrites: Mutex<Vec<Vec<&'static str>>>,
}

impl Memory {
	pub fn with(nodes: Vec<Json>, chains: Vec<Json>) -> Memory {
		Memory { ledgers: Mutex::new(Ledgers { nodes, chains, ..Ledgers::default() }), ..Memory::default() }
	}

	pub fn chains(&self) -> Vec<Json> {
		self.ledgers.lock().unwrap().chains.clone()
	}
}

impl GraphStore for Memory {
	fn append_node(&self, node: &Json) -> Result<(), String> {
		self.ledgers.lock().unwrap().nodes.push(node.clone());
		Ok(())
	}

	fn read_nodes(&self) -> Result<Vec<Json>, String> {
		Ok(self.ledgers.lock().unwrap().nodes.clone())
	}

	fn append_chain(&self, assertion: &Json) -> Result<(), String> {
		self.ledgers.lock().unwrap().chains.push(assertion.clone());
		Ok(())
	}

	fn read_chains(&self) -> Result<Vec<Json>, String> {
		Ok(self.chains())
	}

	fn append_checkpoint(&self, checkpoint: &Json) -> Result<(), String> {
		self.ledgers.lock().unwrap().checkpoints.push(checkpoint.clone());
		Ok(())
	}

	fn read_checkpoints(&self) -> Result<Vec<Json>, String> {
		Ok(self.ledgers.lock().unwrap().checkpoints.clone())
	}

	fn append_coverage(&self, entry: &Json) -> Result<(), String> {
		self.ledgers.lock().unwrap().coverage.push(entry.clone());
		Ok(())
	}

	fn read_coverage(&self) -> Result<Vec<Json>, String> {
		Ok(self.ledgers.lock().unwrap().coverage.clone())
	}

	fn read_sources(&self) -> Result<Vec<Json>, String> {
		Ok(self.ledgers.lock().unwrap().sources.clone())
	}

	fn remove_source(&self, id: &str) -> Result<bool, String> {
		let mut ledgers = self.ledgers.lock().unwrap();
		let before = ledgers.sources.len();
		ledgers.sources.retain(|s| s["id"].as_str() != Some(id));
		Ok(ledgers.sources.len() < before)
	}

	fn rewrite_ledgers(&self, next: LedgerRewrite) -> Result<(), String> {
		let mut guard = self.ledgers.lock().unwrap();
		let ledgers = &mut *guard;
		let mut log = Vec::new();
		for (name, rows, target) in [
			("nodes", next.nodes, &mut ledgers.nodes),
			("chains", next.chains, &mut ledgers.chains),
			("coverage", next.coverage, &mut ledgers.coverage),
			("checkpoints", next.checkpoints, &mut ledgers.checkpoints),
		] {
			if let Some(rows) = rows {
				*target = rows;
				log.push(name);
			}
		}
		self.rewrites.lock().unwrap().push(log);
		Ok(())
	}
}

/// A fixed lesson list.
pub struct Chats(pub Vec<Json>);

impl ChatListing for Chats {
	fn list_chats(&self) -> Vec<Json> {
		self.0.clone()
	}
}

/// A node line born in the given chats' order, one provenance point per chat.
pub fn node(id: &str, name: &str, chats: &[&str]) -> Json {
	let points: Vec<Json> = chats.iter().map(|c| json!({ "chatId": c, "messageId": "" })).collect();
	json!({ "id": id, "name": name, "statement": format!("{name} holds."), "aliases": [], "createdAt": "2026-01-01T00:00:00.000Z", "provenance": points })
}

pub fn chain(id: &str, premises: &[&str], conclusion: &str, chats: &[&str]) -> Json {
	let points: Vec<Json> = chats.iter().map(|c| json!({ "chatId": c, "messageId": "" })).collect();
	json!({ "id": id, "premises": premises, "conclusion": conclusion, "createdAt": "2026-01-01T00:00:00.000Z", "provenance": points })
}

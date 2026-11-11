//! An in-memory graph store and chat list, the Rust twin of `memoryStore` in graph-support.ts.

use std::sync::Mutex;

use gs_core::graph::ports::{ChatListing, GraphStore, LedgerRewrite};
use gs_json::{Json, Obj};

#[derive(Default)]
pub struct Parts {
	pub nodes: Vec<Json>,
	pub chains: Vec<Json>,
	pub coverage: Vec<Json>,
	pub checkpoints: Vec<Json>,
	pub sources: Vec<Json>,
}

/// The ledgers, plus a log of which ledgers each rewrite replaced.
#[derive(Default)]
pub struct MemStore {
	pub parts: Mutex<Parts>,
	pub rewrites: Mutex<Vec<Vec<&'static str>>>,
}

impl MemStore {
	/// The ledgers a run left, whole (the golden may hold them as a digest).
	pub fn marks(&self) -> Json {
		let parts = self.parts.lock().unwrap();
		let mut out = Obj::new();
		out.insert("nodes", parts.nodes.clone());
		out.insert("chains", parts.chains.clone());
		out.insert("coverage", parts.coverage.clone());
		out.insert("checkpoints", parts.checkpoints.clone());
		out.insert("sources", parts.sources.clone());
		Json::Obj(out)
	}

	pub fn rewrite_log(&self) -> Json {
		self.rewrites.lock().unwrap().iter().map(|keys| keys.iter().map(|k| Json::from(*k)).collect::<Json>()).collect()
	}
}

impl GraphStore for MemStore {
	fn append_node(&self, node: &Json) -> Result<(), String> {
		self.parts.lock().unwrap().nodes.push(node.clone());
		Ok(())
	}

	fn read_nodes(&self) -> Result<Vec<Json>, String> {
		Ok(self.parts.lock().unwrap().nodes.clone())
	}

	fn append_chain(&self, assertion: &Json) -> Result<(), String> {
		self.parts.lock().unwrap().chains.push(assertion.clone());
		Ok(())
	}

	fn read_chains(&self) -> Result<Vec<Json>, String> {
		Ok(self.parts.lock().unwrap().chains.clone())
	}

	fn append_checkpoint(&self, checkpoint: &Json) -> Result<(), String> {
		self.parts.lock().unwrap().checkpoints.push(checkpoint.clone());
		Ok(())
	}

	fn read_checkpoints(&self) -> Result<Vec<Json>, String> {
		Ok(self.parts.lock().unwrap().checkpoints.clone())
	}

	fn append_coverage(&self, entry: &Json) -> Result<(), String> {
		self.parts.lock().unwrap().coverage.push(entry.clone());
		Ok(())
	}

	fn read_coverage(&self) -> Result<Vec<Json>, String> {
		Ok(self.parts.lock().unwrap().coverage.clone())
	}

	fn read_sources(&self) -> Result<Vec<Json>, String> {
		Ok(self.parts.lock().unwrap().sources.clone())
	}

	fn remove_source(&self, id: &str) -> Result<bool, String> {
		let mut parts = self.parts.lock().unwrap();
		let Some(at) = parts.sources.iter().position(|s| s["id"].as_str() == Some(id)) else { return Ok(false) };
		parts.sources.remove(at);
		Ok(true)
	}

	fn rewrite_ledgers(&self, next: LedgerRewrite) -> Result<(), String> {
		let mut parts = self.parts.lock().unwrap();
		let mut log = Vec::new();
		if let Some(nodes) = next.nodes {
			parts.nodes = nodes;
			log.push("nodes");
		}
		if let Some(chains) = next.chains {
			parts.chains = chains;
			log.push("chains");
		}
		if let Some(coverage) = next.coverage {
			parts.coverage = coverage;
			log.push("coverage");
		}
		if let Some(checkpoints) = next.checkpoints {
			parts.checkpoints = checkpoints;
			log.push("checkpoints");
		}
		self.rewrites.lock().unwrap().push(log);
		Ok(())
	}
}

pub struct Chats(pub Vec<Json>);

impl ChatListing for Chats {
	fn list_chats(&self) -> Vec<Json> {
		self.0.clone()
	}
}

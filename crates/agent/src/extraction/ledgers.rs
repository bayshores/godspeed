//! The graph code's storage ports (gs_core::graph::ports) over the stores: one scope's ledgers
//! (graphStoreFor in server/stores.ts) and the chat list.

use gs_core::graph::ports::{ChatListing, GraphStore, LedgerRewrite};
use gs_json::Json;
use gs_store::chats::ChatStore;
use gs_store::graph::{GraphStores, Ledger};

/// One graph family: `None` is "No class", a class id that class's own graph.
pub struct ScopedGraph<'a> {
	pub graphs: &'a GraphStores,
	pub scope: Option<&'a str>,
}

impl<'a> ScopedGraph<'a> {
	pub fn new(graphs: &'a GraphStores, scope: Option<&'a str>) -> ScopedGraph<'a> {
		ScopedGraph { graphs, scope }
	}

	fn read(&self, ledger: Ledger) -> Result<Vec<Json>, String> {
		Ok(self.graphs.read(self.scope, ledger)?.as_ref().clone())
	}
}

impl GraphStore for ScopedGraph<'_> {
	fn append_node(&self, node: &Json) -> Result<(), String> {
		self.graphs.append(self.scope, Ledger::Nodes, node)
	}
	fn read_nodes(&self) -> Result<Vec<Json>, String> {
		self.read(Ledger::Nodes)
	}
	fn append_chain(&self, assertion: &Json) -> Result<(), String> {
		self.graphs.append(self.scope, Ledger::Chains, assertion)
	}
	fn read_chains(&self) -> Result<Vec<Json>, String> {
		self.read(Ledger::Chains)
	}
	fn append_checkpoint(&self, checkpoint: &Json) -> Result<(), String> {
		self.graphs.append(self.scope, Ledger::Checkpoints, checkpoint)
	}
	fn read_checkpoints(&self) -> Result<Vec<Json>, String> {
		self.read(Ledger::Checkpoints)
	}
	fn append_coverage(&self, entry: &Json) -> Result<(), String> {
		self.graphs.append(self.scope, Ledger::Coverage, entry)
	}
	fn read_coverage(&self) -> Result<Vec<Json>, String> {
		self.read(Ledger::Coverage)
	}
	fn read_sources(&self) -> Result<Vec<Json>, String> {
		self.graphs.read_sources(self.scope)
	}
	fn remove_source(&self, id: &str) -> Result<bool, String> {
		self.graphs.remove_source(self.scope, id)
	}
	fn rewrite_ledgers(&self, next: LedgerRewrite) -> Result<(), String> {
		let parts = [(Ledger::Nodes, next.nodes), (Ledger::Chains, next.chains), (Ledger::Coverage, next.coverage), (Ledger::Checkpoints, next.checkpoints)];
		let present: Vec<(Ledger, &[Json])> = parts.iter().filter_map(|(ledger, lines)| lines.as_deref().map(|l| (*ledger, l))).collect();
		self.graphs.rewrite_ledgers(self.scope, &present)
	}
}

/// The chat list, for session titles.
pub struct ChatList<'a>(pub &'a ChatStore);

impl ChatListing for ChatList<'_> {
	fn list_chats(&self) -> Vec<Json> {
		self.0.list_chats()
	}
}

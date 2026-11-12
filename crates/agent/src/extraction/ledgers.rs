//! The graph code's storage ports (gs_core::graph::ports) over the stores: one scope's ledgers
//! (graphStoreFor in server/stores.ts).

use std::sync::Arc;

use gs_core::graph::ports::{GraphStore, LedgerRewrite};
use gs_json::Json;
use gs_store::graph::{GraphStores, Ledger};

/// One graph family: `None` is "No space", a space id that space's own graph. It shares the
/// stores, so a graph can live as long as a turn.
pub struct ScopedGraph {
	graphs: Arc<GraphStores>,
	scope: Option<String>,
}

impl ScopedGraph {
	pub fn new(graphs: &Arc<GraphStores>, scope: Option<&str>) -> ScopedGraph {
		ScopedGraph { graphs: graphs.clone(), scope: scope.map(str::to_owned) }
	}

	fn read(&self, ledger: Ledger) -> Result<Vec<Json>, String> {
		Ok(self.graphs.read(self.scope.as_deref(), ledger)?.as_ref().clone())
	}
}

impl GraphStore for ScopedGraph {
	fn append_node(&self, node: &Json) -> Result<(), String> {
		self.graphs.append(self.scope.as_deref(), Ledger::Nodes, node)
	}
	fn read_nodes(&self) -> Result<Vec<Json>, String> {
		self.read(Ledger::Nodes)
	}
	fn append_chain(&self, assertion: &Json) -> Result<(), String> {
		self.graphs.append(self.scope.as_deref(), Ledger::Chains, assertion)
	}
	fn read_chains(&self) -> Result<Vec<Json>, String> {
		self.read(Ledger::Chains)
	}
	fn append_checkpoint(&self, checkpoint: &Json) -> Result<(), String> {
		self.graphs.append(self.scope.as_deref(), Ledger::Checkpoints, checkpoint)
	}
	fn read_checkpoints(&self) -> Result<Vec<Json>, String> {
		self.read(Ledger::Checkpoints)
	}
	fn append_coverage(&self, entry: &Json) -> Result<(), String> {
		self.graphs.append(self.scope.as_deref(), Ledger::Coverage, entry)
	}
	fn read_coverage(&self) -> Result<Vec<Json>, String> {
		self.read(Ledger::Coverage)
	}
	fn read_sources(&self) -> Result<Vec<Json>, String> {
		self.graphs.read_sources(self.scope.as_deref())
	}
	fn remove_source(&self, id: &str) -> Result<bool, String> {
		self.graphs.remove_source(self.scope.as_deref(), id)
	}
	fn rewrite_ledgers(&self, next: LedgerRewrite) -> Result<(), String> {
		let parts = [(Ledger::Nodes, next.nodes), (Ledger::Chains, next.chains), (Ledger::Coverage, next.coverage), (Ledger::Checkpoints, next.checkpoints)];
		let present: Vec<(Ledger, &[Json])> = parts.iter().filter_map(|(ledger, lines)| lines.as_deref().map(|l| (*ledger, l))).collect();
		self.graphs.rewrite_ledgers(self.scope.as_deref(), &present)
	}
}

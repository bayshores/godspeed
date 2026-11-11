//! The storage ports the graph code reads and writes through (ports.ts GraphStore, and the one
//! ChatStore method the snapshot needs). The store crate implements them over the ledger files.
//!
//! Ledger lines are `Json` records the store has already shape-checked: bad lines never reach here.

use gs_json::Json;

/// What a rewrite replaces. A ledger left `None` is untouched; the others are written whole, in
/// this field order, one atomic file replace each.
#[derive(Default)]
pub struct LedgerRewrite {
	pub nodes: Option<Vec<Json>>,
	pub chains: Option<Vec<Json>>,
	pub coverage: Option<Vec<Json>>,
	pub checkpoints: Option<Vec<Json>>,
}

/// One graph family's append-only ledgers (the "No class" graph or one class's).
pub trait GraphStore: Send + Sync {
	fn append_node(&self, node: &Json) -> Result<(), String>;
	/// Raw node lines in append order.
	fn read_nodes(&self) -> Result<Vec<Json>, String>;
	fn append_chain(&self, assertion: &Json) -> Result<(), String>;
	fn read_chains(&self) -> Result<Vec<Json>, String>;
	fn append_checkpoint(&self, checkpoint: &Json) -> Result<(), String>;
	fn read_checkpoints(&self) -> Result<Vec<Json>, String>;
	fn append_coverage(&self, entry: &Json) -> Result<(), String>;
	fn read_coverage(&self) -> Result<Vec<Json>, String>;
	/// Every imported-notes source record.
	fn read_sources(&self) -> Result<Vec<Json>, String>;
	/// Drops one source record; false when it was unknown.
	fn remove_source(&self, id: &str) -> Result<bool, String>;
	fn rewrite_ledgers(&self, next: LedgerRewrite) -> Result<(), String>;
}

/// The lesson list, for session titles.
pub trait ChatListing: Send + Sync {
	/// Every chat summary (`id`, `title`, `createdAt`, `updatedAt`, ...).
	fn list_chats(&self) -> Vec<Json>;
}

/// The ports one graph read needs.
pub struct GraphDeps<'a> {
	pub chat_store: &'a dyn ChatListing,
	pub graph_store: &'a dyn GraphStore,
}

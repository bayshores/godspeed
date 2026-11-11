//! The server's one extraction pipeline (server/extraction.ts): every front door (lesson runs,
//! notes imports, class files) shares its registry. A lesson's facts land in its class's graph,
//! a run that wrote a class graph queues a topic grouping, and every stage runs on the outside
//! agent with related ideas from the local search.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_agent::extraction::extraction::{Extraction, ExtractionHost, ExtractionState};
use gs_base::events::Events;
use gs_base::locks::Locks;
use gs_engine::bridge::Bridge;
use gs_json::Json;
use gs_store::chats::ChatStore;
use gs_store::graph::GraphStores;

use super::topics::schedule_topic_grouping;
use crate::App;

pub use gs_agent::extraction::extraction::{ImportOutcome, NotesImportError, NotesImportInput};

struct AppHost(Arc<App>);

impl ExtractionHost for AppHost {
	fn chats(&self) -> &ChatStore {
		&self.0.stores.chats
	}
	fn graphs(&self) -> &Arc<GraphStores> {
		&self.0.stores.graphs
	}
	fn events(&self) -> &Events {
		&self.0.events
	}
	fn locks(&self) -> &Locks {
		&self.0.locks
	}
	fn bridge(&self) -> &Bridge {
		&self.0.bridge
	}
	fn state(&self) -> &ExtractionState {
		&self.0.graph.extraction
	}
	fn on_graph_written(&self, scope: Option<&str>) {
		// "No class" has no topics.
		if let Some(class_id) = scope {
			schedule_topic_grouping(&self.0, class_id);
		}
	}
	fn related_facts<'a>(&'a self, scope: Option<&'a str>, nodes: &'a [Json], text: &'a str, limit: usize) -> BoxFuture<'a, Result<Vec<String>, String>> {
		Box::pin(self.0.search.related_facts(scope, nodes, text, limit))
	}
}

/// The pipeline (`extraction.runExtraction`, `extraction.importNotes`).
pub fn extraction(app: &Arc<App>) -> Extraction {
	Extraction::new(Arc::new(AppHost(app.clone())))
}

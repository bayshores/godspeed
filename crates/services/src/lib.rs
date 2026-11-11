//! The server's services (src/backend/server): what the routes and the MCP endpoint call.

pub mod turns;
pub mod jobs;
pub mod classes;
pub mod cheat_sheets;
pub mod graph;
pub mod app;

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::events::Events;
use gs_base::locks::Locks;
use gs_store::Stores;

/// The whole server's state: every route and the MCP endpoint get an `Arc<App>`. Each service
/// area owns its own field's type.
pub struct App {
	pub paths: Paths,
	pub events: Events,
	pub locks: Locks,
	pub stores: Stores,
	pub pdf: gs_pdf::worker::Pdf,
	pub search: gs_search::index::Search,
	pub bridge: gs_engine::bridge::Bridge,
	pub turns: turns::TurnsState,
	pub jobs: jobs::JobsState,
	pub classes: classes::ClassesState,
	pub cheat_sheets: cheat_sheets::CheatSheetsState,
	pub graph: graph::GraphState,
	pub misc: app::MiscState,
}

impl App {
	pub fn new(paths: Paths) -> Arc<App> {
		let events = Events::new();
		let locks = Locks::new();
		let stores = Stores::new(&paths, &events, &locks);
		let app = Arc::new(App {
			bridge: gs_engine::bridge::Bridge::new(&events, stores.agent_seen.clone()),
			stores,
			pdf: gs_pdf::worker::Pdf::new(&paths.resources),
			search: gs_search::index::Search::new(&paths),
			turns: Default::default(),
			jobs: Default::default(),
			classes: Default::default(),
			cheat_sheets: Default::default(),
			graph: Default::default(),
			misc: Default::default(),
			paths,
			events,
			locks,
		});
		turns::chat_handler::wire(&app);
		app
	}
}

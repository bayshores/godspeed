//! The server's services: what the routes and the MCP endpoint call.

pub mod turns;
pub mod jobs;
pub mod spaces;
pub mod vault;
pub mod cheat_sheets;
pub mod graph;
pub mod app;
pub mod mocks;
pub mod plugins;
pub mod outcome;

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
	/// The agents in godspeed's terminals and outside it, for the terminal's free talk.
	pub terminals: app::terminal_state::TerminalState,
	/// The learner's agent program, which runs the lessons.
	pub agents: app::agents::AgentsState,
	pub turns: turns::TurnsState,
	pub jobs: jobs::JobsState,
	pub spaces: spaces::SpacesState,
	pub vault: vault::VaultState,
	pub cheat_sheets: cheat_sheets::CheatSheetsState,
	pub graph: graph::GraphState,
	pub misc: app::MiscState,
	pub mocks: mocks::MocksState,
	pub plugins: plugins::PluginsState,
	/// The desktop shell, when it started us (`LH_SHELL=1`): demo checks and window logins go through it.
	pub shell: Option<gs_shell_rpc::ShellLink>,
}

impl App {
	pub fn new(paths: Paths, shell: Option<gs_shell_rpc::ShellLink>) -> Arc<App> {
		let events = Events::new();
		let locks = Locks::new();
		let stores = Stores::new(&paths, &events, &locks);
		let app = Arc::new(App {
			terminals: app::terminal_state::TerminalState::new(&events),
			stores,
			pdf: gs_pdf::worker::Pdf::from_env(&paths.resources),
			search: gs_search::index::Search::new(&paths),
			agents: Default::default(),
			turns: Default::default(),
			jobs: Default::default(),
			spaces: Default::default(),
			vault: Default::default(),
			cheat_sheets: Default::default(),
			graph: Default::default(),
			misc: Default::default(),
			mocks: Default::default(),
			plugins: Default::default(),
			shell,
			paths,
			events,
			locks,
		});
		turns::chat_handler::wire(&app);
		app
	}
}

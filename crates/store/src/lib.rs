//! The data files, read and written exactly as the Node server does (src/backend/store).

pub mod settings;
pub mod prompt_overrides;
pub mod agent_notes;
pub mod agent_rules;
pub mod agent_seen;
pub mod agent_actions;
pub mod mcp_token;
pub mod jobs;
pub mod graph;
pub mod chats;
pub mod classes;
pub mod cheat_sheets;

use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::events::Events;
use gs_base::locks::Locks;

/// Every store, built once at start-up and shared by the services.
pub struct Stores {
	pub settings: settings::SettingsStore,
	pub prompt_overrides: prompt_overrides::PromptOverrides,
	pub agent_notes: agent_notes::AgentNotesStore,
	pub agent_rules: agent_rules::AgentRulesStore,
	/// Shared with the bridge, which saves what each agent has seen.
	pub agent_seen: Arc<agent_seen::AgentSeenStore>,
	pub agent_actions: agent_actions::AgentActionsStore,
	pub mcp_token: mcp_token::McpTokenStore,
	/// The lesson tools hold these for a whole turn, so they are shared.
	pub jobs: Arc<jobs::JobStore>,
	pub graphs: Arc<graph::GraphStores>,
	pub chats: Arc<chats::ChatStore>,
	pub classes: classes::ClassStore,
	pub cheat_sheets: cheat_sheets::CheatSheetStore,
}

impl Stores {
	pub fn new(paths: &Paths, events: &Events, locks: &Locks) -> Stores {
		Stores {
			settings: settings::SettingsStore::new(paths, locks),
			prompt_overrides: prompt_overrides::PromptOverrides::new(paths),
			agent_notes: agent_notes::AgentNotesStore::new(paths, locks),
			agent_rules: agent_rules::AgentRulesStore::new(paths, locks),
			agent_seen: Arc::new(agent_seen::AgentSeenStore::new(paths, locks)),
			agent_actions: agent_actions::AgentActionsStore::new(paths, locks),
			mcp_token: mcp_token::McpTokenStore::new(paths),
			jobs: Arc::new(jobs::JobStore::new(paths, events, locks)),
			graphs: Arc::new(graph::GraphStores::new(paths, locks)),
			chats: Arc::new(chats::ChatStore::new(paths, events, locks)),
			classes: classes::ClassStore::new(paths, events, locks),
			cheat_sheets: cheat_sheets::CheatSheetStore::new(paths, locks),
		}
	}
}

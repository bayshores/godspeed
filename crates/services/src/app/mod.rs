//! App-level services: boot, onboarding, welcome, what's new, settings bodies, the agent folder,
//! the agent's checks, sign-in and models, old setups, agent memory, agent rules, agent actions,
//! today's note, reading pages, the web search key, deadline reminders, the menu bar countdown
//! and the pages the agent opens.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use gs_json::Json;
use parking_lot::Mutex;

pub mod agent_actions;
pub mod agent_folder;
pub mod agent_health;
pub mod agent_login;
pub mod agent_memory;
pub mod agent_models;
pub mod agent_rules;
pub mod agent_update;
pub mod agents;
pub mod boot;
pub mod deadline_reminder;
pub mod menu_bar_countdown;
pub(crate) mod disk;
mod folder_files;
pub mod old_setup;
pub mod old_talk;
pub mod open_page;
mod onboarding;
pub mod prompt_segments;
pub mod reading_pages;
pub mod settings_body;
mod settings_put;
pub(crate) mod settings_record;
pub mod terminal_state;
pub mod terminal_lines;
pub mod vault_settings;
#[cfg(test)]
pub(crate) mod test_support;
pub mod today_note;
pub mod web_search;
mod welcome;
mod whats_new;

pub use settings_put::{patch_settings_section, put_settings_section};

/// This service's live state inside `App` (registries, timers, caches).
#[derive(Default)]
pub struct MiscState {
	/// The first boot read has run (the one-time start-up work is done).
	first_load_done: AtomicBool,
	/// The godspeed folder was brought up to this version since the app started.
	folder_refreshed: AtomicBool,
	/// The recent agent actions, loaded from disk on first use.
	actions: Mutex<Option<Vec<Json>>>,
	/// Rendered PDF pages for the reading view, oldest first.
	pages: Mutex<VecDeque<(String, Arc<Vec<u8>>)>>,
	/// Drawn pieces of cited PDF pages, held by their size.
	pieces: Mutex<reading_pages::PieceCache>,
	/// Where quoted words sit on cited PDF pages, oldest first.
	pub(crate) quote_boxes: Mutex<VecDeque<(String, Json)>>,
	/// Lines from the teacher's terminal waiting for the window to send them.
	lines: terminal_lines::Lines,
	/// Poked when a settings section is saved, so the menu bar countdown reads its switch again.
	pub(crate) settings_saved: tokio::sync::Notify,
}

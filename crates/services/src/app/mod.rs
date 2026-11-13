//! App-level services: boot, onboarding, welcome, what's new, settings bodies, the agent folder,
//! old setups, agent memory, agent rules, agent actions, today's note, reading pages and the web
//! search key.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use gs_json::Json;
use parking_lot::Mutex;

pub mod agent_actions;
pub mod agent_folder;
pub mod agent_memory;
pub mod agent_rules;
pub mod boot;
pub(crate) mod disk;
mod folder_files;
pub mod old_setup;
mod onboarding;
pub mod prompt_segments;
pub mod reading_pages;
pub mod settings_body;
mod settings_put;
mod settings_record;
#[cfg(test)]
pub(crate) mod test_support;
pub mod today_note;
pub mod web_search;
mod welcome;
mod whats_new;

pub use settings_put::put_settings_section;

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
}

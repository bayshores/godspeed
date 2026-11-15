//! Plugins: small pages a learner adds to godspeed, each a folder in `<data>/plugins/<id>/` with
//! a `manifest.json`, its files and its own stored JSON in `data/`. The window shows a plugin's
//! page in a sandboxed frame; model work it asks for goes to the learner's agent as a submit job.
//! On/off and setting values live in the `plugins` section of settings.json.

mod ask;
mod csp;
mod install;
mod installed;
mod manifest;
mod state;
mod storage;
#[cfg(test)]
mod test_plugin;

use std::collections::HashMap;

use gs_json::Json;
use parking_lot::Mutex;

pub use ask::{ask_agent, plugin_ask_rows};
pub use csp::{FILES_PREFIX, FONTS_PREFIX, plugin_csp, plugin_files_port};
pub use install::{install_from_folder, install_from_github};
pub use installed::{installed_manifest, list_plugins, plugin_view, remove_plugin, served_file};
pub use state::set_state;
pub use storage::{storage_get, storage_set};

/// The live state inside `App`.
#[derive(Default)]
pub struct PluginsState {
	/// Plugins whose `ask_agent` request the agent is working on, each with its activity feed row.
	pub(crate) asking: Mutex<HashMap<String, Json>>,
}

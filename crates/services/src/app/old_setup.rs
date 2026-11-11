//! The old ways godspeed loaded, which work in every folder instead of only the godspeed folder:
//! the retired Claude Code plugin and the server block once pasted into Codex's config. Finding
//! what is left of them, and removing it. `claude plugin uninstall` leaves the plugin's files
//! behind, and a project that switched the plugin on still loads them, so the app removes the
//! files and the plugin's entries itself.

use std::path::{Path, PathBuf};

use gs_base::fsx;
use gs_core::classes::old_setup::{without_json_entry, without_old_codex_server};
use gs_json::{Json, json};

use super::disk::{remove_all, write_file_atomic};
use crate::App;

const PLUGIN: &str = "godspeed@godspeed";
const MARKETPLACE: &str = "godspeed";

/// What is left of each old setup.
#[derive(Debug, PartialEq)]
pub struct OldSetup {
	pub plugin: bool,
	pub codex: bool,
}

impl OldSetup {
	pub fn to_json(&self) -> Json {
		json!({ "plugin": self.plugin, "codex": self.codex })
	}
}

/// Where the old setups live: Claude Code's plugins folder and Codex's config file.
pub struct Locations {
	plugins: PathBuf,
	codex_config: PathBuf,
}

fn env_or_home(key: &str, home: &Path, folder: &str) -> PathBuf {
	std::env::var_os(key).map_or_else(|| home.join(folder), PathBuf::from)
}

impl Locations {
	pub fn of(app: &App) -> Locations {
		Locations {
			plugins: env_or_home("CLAUDE_CONFIG_DIR", &app.paths.home, ".claude").join("plugins"),
			codex_config: env_or_home("CODEX_HOME", &app.paths.home, ".codex").join("config.toml"),
		}
	}

	/// Claude Code's plugin lists, each with where godspeed's entry sits.
	fn plugin_lists(&self) -> [(PathBuf, Vec<&'static str>); 2] {
		[(self.plugins.join("installed_plugins.json"), vec!["plugins", PLUGIN]), (self.plugins.join("known_marketplaces.json"), vec![MARKETPLACE])]
	}

	/// The plugin's downloaded files and its marketplace copy.
	fn plugin_folders(&self) -> [PathBuf; 2] {
		[self.plugins.join("cache").join(MARKETPLACE), self.plugins.join("marketplaces").join(MARKETPLACE)]
	}

	pub fn old_setup(&self) -> OldSetup {
		let listed = self.plugin_lists().iter().any(|(file, keys)| fsx::read_text(file).ok().is_some_and(|text| without_json_entry(&text, keys).is_some()));
		let codex = fsx::read_text(&self.codex_config).ok().is_some_and(|text| without_old_codex_server(&text).is_some());
		OldSetup { plugin: listed || self.plugin_folders().iter().any(|dir| dir.exists()), codex }
	}

	/// Remove what is left of both. Open chats keep the plugin until they restart. Err is the
	/// first thing that could not be removed, worded like Node's.
	pub fn remove_old_setup(&self) -> Result<(), String> {
		for dir in self.plugin_folders() {
			remove_all(&dir)?;
		}
		for (file, keys) in self.plugin_lists() {
			if let Some(kept) = fsx::read_text(&file).ok().and_then(|text| without_json_entry(&text, &keys)) {
				write_file_atomic(&file, &kept)?;
			}
		}
		if let Some(kept) = fsx::read_text(&self.codex_config).ok().and_then(|text| without_old_codex_server(&text)) {
			write_file_atomic(&self.codex_config, &kept)?;
		}
		Ok(())
	}
}

pub fn old_setup(app: &App) -> OldSetup {
	Locations::of(app).old_setup()
}

pub fn remove_old_setup(app: &App) -> Result<(), String> {
	Locations::of(app).remove_old_setup()
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::app::test_support::scratch_dir;

	const CODEX: &str = "model = \"x\"\n\n[mcp_servers.godspeed]\nurl = \"http://127.0.0.1:47613/api/mcp\"\n\n[other]\nb = 2\n";

	fn lay_out(root: &Path) -> Locations {
		let locations = Locations { plugins: root.join("claude/plugins"), codex_config: root.join("codex/config.toml") };
		write_file_atomic(&locations.plugins.join("cache/godspeed/a.txt"), "x").unwrap();
		write_file_atomic(&locations.plugins.join("installed_plugins.json"), r#"{"plugins":{"godspeed@godspeed":[1],"b":2}}"#).unwrap();
		write_file_atomic(&locations.plugins.join("known_marketplaces.json"), r#"{"godspeed":{},"other":{}}"#).unwrap();
		write_file_atomic(&locations.codex_config, CODEX).unwrap();
		locations
	}

	#[test]
	fn nothing_left_reads_as_nothing() {
		let root = scratch_dir("old-setup-none");
		let locations = Locations { plugins: root.join("p"), codex_config: root.join("c.toml") };
		assert_eq!(locations.old_setup(), OldSetup { plugin: false, codex: false });
		locations.remove_old_setup().unwrap();
	}

	#[test]
	fn the_old_plugin_and_codex_block_are_found_and_removed() {
		let root = scratch_dir("old-setup-found");
		let locations = lay_out(&root);
		assert_eq!(locations.old_setup(), OldSetup { plugin: true, codex: true });
		locations.remove_old_setup().unwrap();
		assert_eq!(locations.old_setup(), OldSetup { plugin: false, codex: false });
		assert_eq!(std::fs::read_to_string(locations.plugins.join("installed_plugins.json")).unwrap(), "{\n  \"plugins\": {\n    \"b\": 2\n  }\n}");
		assert_eq!(std::fs::read_to_string(&locations.codex_config).unwrap(), "model = \"x\"\n\n[other]\nb = 2\n");
	}
}

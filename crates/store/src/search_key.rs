//! The person's Tavily key, one secret in data/search-key (mode 0600), beside the MCP token.
//! It stays out of settings.json, which the window reads whole.

use std::io::ErrorKind;
use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::{fsx, text};

pub struct SearchKeyStore {
	file: PathBuf,
}

impl SearchKeyStore {
	pub fn new(paths: &Paths) -> SearchKeyStore {
		SearchKeyStore { file: paths.data.join("search-key") }
	}

	/// The key, or None when there is no file or it holds only whitespace.
	pub fn read_search_key(&self) -> Option<String> {
		let raw = fsx::read_text(&self.file).ok()?;
		let key = text::trim(&raw);
		(!key.is_empty()).then(|| key.to_owned())
	}

	pub fn write_search_key(&self, key: &str) -> Result<(), String> {
		fsx::write_atomic(&self.file, key.as_bytes(), Some(0o600)).map_err(|err| fsx::node_error_message(&err, "open", &self.file))
	}

	/// Removing a key that is not there is fine.
	pub fn remove_search_key(&self) -> Result<(), String> {
		match std::fs::remove_file(&self.file) {
			Err(err) if err.kind() != ErrorKind::NotFound => Err(fsx::node_error_message(&err, "unlink", &self.file)),
			_ => Ok(()),
		}
	}
}

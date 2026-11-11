//! The MCP access token, one secret in
//! data/mcp-token (mode 0600). It is made on the first page load and again whenever the file is
//! missing; Settings can rotate it.

use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::{fsx, ids, text};
use parking_lot::Mutex;

/// A token is 64 hex characters; anything shorter is not one.
const TOKEN_MIN_LEN: usize = 32;

pub struct McpTokenStore {
	file: PathBuf,
	/// Makes "read, else write a new one" a single step, so two first requests share one token.
	writing: Mutex<()>,
}

impl McpTokenStore {
	pub fn new(paths: &Paths) -> McpTokenStore {
		McpTokenStore { file: paths.data.join("mcp-token"), writing: Mutex::new(()) }
	}

	pub fn read_mcp_token(&self) -> Option<String> {
		let raw = fsx::read_text(&self.file).ok()?;
		let token = text::trim(&raw);
		(text::len16(token) >= TOKEN_MIN_LEN).then(|| token.to_owned())
	}

	/// Writes a fresh token (first start, or rotating it).
	pub fn write_new_mcp_token(&self) -> Result<String, String> {
		let _writing = self.writing.lock();
		self.write_new()
	}

	/// The token, made first if the file is missing.
	pub fn ensure_mcp_token(&self) -> Result<String, String> {
		let _writing = self.writing.lock();
		match self.read_mcp_token() {
			Some(token) => Ok(token),
			None => self.write_new(),
		}
	}

	fn write_new(&self) -> Result<String, String> {
		let token = ids::hex(&ids::random_bytes(32));
		fsx::write_atomic(&self.file, token.as_bytes(), Some(0o600)).map_err(|err| fsx::node_error_message(&err, "open", &self.file))?;
		Ok(token)
	}
}

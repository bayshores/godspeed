//! Stand-in agent programs for tests: shell scripts that print what the real `claude`, `codex`
//! and `node` print. No test starts a real agent.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;

use crate::process::AgentEnv;
use crate::session::Runtime;

/// A folder of stand-in programs, each a shell script, made fresh for one test.
pub(crate) struct Programs(pub(crate) PathBuf);

impl Programs {
	pub(crate) fn new(name: &str) -> Programs {
		let dir = std::env::temp_dir().join(format!("gs-runtime-{name}-{}", gs_base::ids::uuid()));
		std::fs::create_dir_all(&dir).unwrap();
		Programs(dir)
	}

	pub(crate) fn add(self, name: &str, script: &str) -> Programs {
		use std::os::unix::fs::PermissionsExt;
		let file = self.0.join(name);
		gs_base::fsx::write_text_atomic(&file, &format!("#!/bin/sh\n{script}")).unwrap();
		std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
		self
	}

	pub(crate) fn node(self, version: &str) -> Programs {
		self.add("node", &format!("echo {version}\n"))
	}

	/// `claude` printing `version` and the account `status`; `auth status` ends with 1 when
	/// signed out, as the real one does.
	pub(crate) fn claude(self, version: &str, status: &str) -> Programs {
		let code = if status.contains("\"loggedIn\": false") { 1 } else { 0 };
		self.add("claude", &format!("if [ \"$1\" = --version ]; then echo '{version} (Claude Code)'; exit 0; fi\ncat <<'EOF'\n{status}\nEOF\nexit {code}\n"))
	}

	/// `codex` printing `version`, and as `app-server` answering the handshake and
	/// `account/read` with `account`.
	pub(crate) fn codex(self, version: &str, account: &str) -> Programs {
		let answers = format!("read -r _; echo '{{\"id\":1,\"result\":{{}}}}'\nread -r _\nread -r _; echo '{{\"id\":2,\"result\":{account}}}'\ncat > /dev/null\n");
		self.add("codex", &format!("if [ \"$1\" = --version ]; then echo 'codex-cli {version}'; exit 0; fi\n{answers}"))
	}

	pub(crate) fn env(&self) -> Arc<AgentEnv> {
		let path = format!("{}:/usr/bin:/bin", self.0.display());
		Arc::new(AgentEnv::fixed(vec![(OsString::from("PATH"), OsString::from(path)), (OsString::from("HOME"), self.0.clone().into_os_string())]))
	}

	/// A helper file that is there.
	pub(crate) fn helper(&self) -> PathBuf {
		let helper = self.0.join("claude-helper.mjs");
		gs_base::fsx::write_text_atomic(&helper, "").unwrap();
		helper
	}

	pub(crate) fn claude_runtime(&self, own: Option<&str>) -> Runtime {
		Runtime::claude(self.env(), self.helper(), own.map(str::to_owned))
	}

	pub(crate) fn codex_runtime(&self, own: Option<&str>) -> Runtime {
		Runtime::codex(self.env(), self.0.join("codex-home"), own.map(str::to_owned))
	}
}

impl Drop for Programs {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.0);
	}
}

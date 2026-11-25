//! Stand-in agent programs for the setup card's flows: shell scripts that print what the real
//! `claude` and `node` print, and an app whose lessons run on them. No test starts a real agent.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{clock, fsx, ids};
use gs_json::Json;
use gs_runtime::Runtime;
use gs_runtime::process::AgentEnv;
use gs_services::App;
use gs_services::app::agent_health::health_view;
use gs_services::app::agents::use_runtime;

/// What `claude auth status` prints for a Max plan.
pub const MAX: &str = r#"{ "loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "max", "storedClaudeAiLogin": true, "planTier": "max_20x" }"#;

/// A fresh folder for one test's stand-ins.
pub fn folder(name: &str) -> PathBuf {
	let dir = std::env::temp_dir().join(format!("gs-{name}-{}", ids::uuid()));
	std::fs::create_dir_all(&dir).unwrap();
	dir
}

/// A stand-in program `name` in `dir`; its script knows its folder as `$dir`.
pub fn program(dir: &Path, name: &str, body: &str) {
	use std::os::unix::fs::PermissionsExt;
	let file = dir.join(name);
	fsx::write_text_atomic(&file, &format!("#!/bin/sh\ndir='{}'\n{body}", dir.display())).unwrap();
	std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
}

/// An app whose Claude Code is the stand-ins in `dir`, with Node and godspeed's helper there.
pub fn app(dir: &Path) -> Arc<App> {
	program(dir, "node", "echo v26.9.0\n");
	fsx::write_text_atomic(&dir.join("claude-helper.mjs"), "").unwrap();
	let app = App::new(Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), dir.to_path_buf()), None);
	let env = AgentEnv::fixed(vec![(OsString::from("PATH"), OsString::from(format!("{}:/usr/bin:/bin", dir.display())))]);
	use_runtime(&app, Runtime::claude(Arc::new(env), dir.join("claude-helper.mjs"), None));
	app
}

/// The health view once `ready` says it is.
pub async fn view_when(app: &Arc<App>, ready: impl Fn(&Json) -> bool) -> Json {
	for _ in 0..1000 {
		let view = health_view(app);
		if ready(&view) {
			return view;
		}
		clock::sleep(10).await;
	}
	panic!("never ready: {}", gs_json::stringify(&health_view(app)));
}

pub fn alive(pid: &str) -> bool {
	std::process::Command::new("/bin/kill").args(["-0", pid.trim()]).stderr(std::process::Stdio::null()).status().is_ok_and(|status| status.success())
}

/// Waits until the process `pid` names has ended.
pub async fn ended(pid: &str) -> bool {
	for _ in 0..500 {
		if !alive(pid) {
			return true;
		}
		clock::sleep(10).await;
	}
	false
}

//! The setup card's checks on stand-in programs that print what the real ones print: versions,
//! `claude auth status` for each kind of account, and Codex's `account/read` through a stand-in
//! app-server. No test starts a real agent.

use super::*;

#[test]
fn the_version_is_read_from_each_programs_own_line() {
	assert_eq!(version("2.1.331 (Claude Code)\n"), Some("2.1.331".into()));
	assert_eq!(version("codex-cli 0.169.0\n"), Some("0.169.0".into()));
	assert_eq!(version("codex-cli 0.42.0-alpha.3"), Some("0.42.0".into()));
	assert_eq!(version("v26.9.0\n"), Some("26.9.0".into()), "Node's");
	assert_eq!(version("command not found"), None);
	assert_eq!(version("v2.1"), None);
}

#[test]
fn versions_compare_by_number_not_by_text() {
	assert!(at_least("2.1.331", CLAUDE_FLOOR));
	assert!(at_least("2.2.0", CLAUDE_FLOOR));
	assert!(!at_least("2.1.327", CLAUDE_FLOOR), "the Windows PC's Claude Code");
	assert!(at_least("0.169.0", CODEX_FLOOR));
	assert!(at_least("0.1000.0", CODEX_FLOOR));
	assert!(!at_least("0.42.0", CODEX_FLOOR), "the Windows PC's Codex");
	assert!(at_least("18.0.0", NODE_FLOOR));
	assert!(!at_least("16.20.2", NODE_FLOOR));
}

/// What `claude auth status` prints (`JSON.stringify(status, null, 2)`) for each kind of account.
mod status {
	pub const MAX: &str = r#"{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "/Users/learner/.claude/projects",
  "configDirectory": "/Users/learner/.claude",
  "loginExpiresAt": "2026-12-14T03:52:02.805Z",
  "email": "learner@example.com",
  "orgId": "00000000-0000-0000-0000-000000000000",
  "orgName": "learner@example.com's Organization",
  "subscriptionType": "max",
  "storedClaudeAiLogin": true,
  "planTier": "max_20x"
}"#;
	pub const PRO: &str = r#"{ "loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "email": "learner@example.com", "subscriptionType": "pro", "storedClaudeAiLogin": true, "planTier": "pro" }"#;
	pub const FREE: &str = r#"{ "loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "email": "learner@example.com", "subscriptionType": null, "storedClaudeAiLogin": true, "planTier": "other" }"#;
	pub const CONSOLE: &str = r#"{ "loggedIn": true, "authMethod": "api_key", "apiProvider": "firstParty", "loginExpiresAt": null, "apiKeySource": "/login managed key", "email": "learner@example.com", "orgId": "o", "orgName": "Lab" }"#;
	pub const BEDROCK: &str = r#"{ "loggedIn": true, "authMethod": "third_party", "apiProvider": "bedrock", "loginExpiresAt": null }"#;
	pub const TOKEN: &str = r#"{ "loggedIn": true, "authMethod": "oauth_token", "apiProvider": "firstParty", "loginExpiresAt": null }"#;
	pub const SIGNED_OUT: &str = r#"{
  "loggedIn": false,
  "authMethod": "none",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "loginExpiresAt": null
}"#;
}

#[test]
fn the_claude_login_is_read_from_auth_status() {
	assert_eq!(claude_login(status::MAX), Ok(Some("Max plan".into())));
	assert_eq!(claude_login(status::PRO), Ok(Some("Pro plan".into())));
	assert_eq!(claude_login(status::FREE), Err(Problem::FreeAccount));
	assert_eq!(claude_login(status::CONSOLE), Err(Problem::BillsByUse));
	assert_eq!(claude_login(status::BEDROCK), Err(Problem::BillsByUse));
	assert_eq!(claude_login(status::TOKEN), Ok(None), "a plan's long-lived token names no plan");
	assert_eq!(claude_login(status::SIGNED_OUT), Err(Problem::SignedOut));
	assert_eq!(claude_login("Not logged in. Run claude auth login to authenticate."), Err(Problem::Failed("claude auth status printed no JSON".into())));
}

#[test]
fn a_plan_gets_its_words_and_an_unknown_one_none() {
	assert_eq!(plan_words("plus").as_deref(), Some("Plus plan"));
	assert_eq!(plan_words("max").as_deref(), Some("Max plan"));
	assert_eq!(plan_words("self_serve_business_usage_based"), None);
}

#[tokio::test]
async fn a_fake_agent_is_always_ready() {
	let health = crate::fake::FakeAgent::new(Vec::new()).runtime().health().await;
	assert!(health.rows.iter().all(|row| row.outcome == Outcome::Passed));
	assert_eq!(health.failing(), None);
}

#[cfg(unix)]
mod stand_ins {
	use std::ffi::OsString;
	use std::path::PathBuf;
	use std::sync::Arc;

	use super::*;
	use crate::process::AgentEnv;

	/// A folder of stand-in programs, each a shell script, made fresh for one test.
	struct Programs(PathBuf);

	impl Programs {
		fn new(name: &str) -> Programs {
			let dir = std::env::temp_dir().join(format!("gs-health-{name}-{}", gs_base::ids::uuid()));
			std::fs::create_dir_all(&dir).unwrap();
			Programs(dir)
		}

		fn add(self, name: &str, script: &str) -> Programs {
			use std::os::unix::fs::PermissionsExt;
			let file = self.0.join(name);
			gs_base::fsx::write_text_atomic(&file, &format!("#!/bin/sh\n{script}")).unwrap();
			std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
			self
		}

		fn node(self, version: &str) -> Programs {
			self.add("node", &format!("echo {version}\n"))
		}

		/// `claude` printing `version` and the account `status`; `auth status` ends with 1 when
		/// signed out, as the real one does.
		fn claude(self, version: &str, status: &str) -> Programs {
			let code = if status.contains("\"loggedIn\": false") { 1 } else { 0 };
			self.add("claude", &format!("if [ \"$1\" = --version ]; then echo '{version} (Claude Code)'; exit 0; fi\ncat <<'EOF'\n{status}\nEOF\nexit {code}\n"))
		}

		/// `codex` printing `version`, and as `app-server` answering the handshake and
		/// `account/read` with `account`.
		fn codex(self, version: &str, account: &str) -> Programs {
			let answers = format!("read -r _; echo '{{\"id\":1,\"result\":{{}}}}'\nread -r _\nread -r _; echo '{{\"id\":2,\"result\":{account}}}'\ncat > /dev/null\n");
			self.add("codex", &format!("if [ \"$1\" = --version ]; then echo 'codex-cli {version}'; exit 0; fi\n{answers}"))
		}

		fn env(&self) -> Arc<AgentEnv> {
			let path = format!("{}:/usr/bin:/bin", self.0.display());
			Arc::new(AgentEnv::fixed(vec![(OsString::from("PATH"), OsString::from(path)), (OsString::from("HOME"), self.0.clone().into_os_string())]))
		}

		/// A helper file that is there.
		fn helper(&self) -> PathBuf {
			let helper = self.0.join("claude-helper.mjs");
			gs_base::fsx::write_text_atomic(&helper, "").unwrap();
			helper
		}

		fn claude_runtime(&self, own: Option<&str>) -> Runtime {
			Runtime::claude(self.env(), self.helper(), own.map(str::to_owned))
		}

		fn codex_runtime(&self, own: Option<&str>) -> Runtime {
			Runtime::codex(self.env(), self.0.join("codex-home"), own.map(str::to_owned))
		}
	}

	impl Drop for Programs {
		fn drop(&mut self) {
			let _ = std::fs::remove_dir_all(&self.0);
		}
	}

	fn rows(health: &AgentHealth) -> Vec<(&'static str, Outcome, Option<&str>)> {
		health.rows.iter().map(|row| (row.check.name(), row.outcome.clone(), row.fact.as_deref())).collect()
	}

	const PASSED: Outcome = Outcome::Passed;
	const UNCHECKED: Outcome = Outcome::Unchecked;

	fn failed(problem: Problem) -> Outcome {
		Outcome::Failed(problem)
	}

	#[tokio::test]
	async fn claude_code_on_a_plan_passes_every_check_with_its_version_and_plan() {
		let programs = Programs::new("claude-max").node("v26.9.0").claude("2.1.332", status::MAX);
		let health = programs.claude_runtime(None).health().await;
		assert_eq!(rows(&health), [("installed", PASSED, Some("2.1.332")), ("node", PASSED, Some("26.9.0")), ("upToDate", PASSED, None), ("loggedIn", PASSED, Some("Max plan"))]);
		assert_eq!((health.failing(), health.own_command), (None, false));
		let pro = Programs::new("claude-pro").node("v22.1.0").claude("2.1.332", status::PRO);
		assert_eq!(rows(&pro.claude_runtime(None).health().await)[3], ("loggedIn", PASSED, Some("Pro plan")));
	}

	#[tokio::test]
	async fn each_claude_account_that_cant_run_says_why() {
		for (name, status, problem) in [("signed-out", status::SIGNED_OUT, Problem::SignedOut), ("free", status::FREE, Problem::FreeAccount), ("console", status::CONSOLE, Problem::BillsByUse)] {
			let programs = Programs::new(name).node("v26.9.0").claude("2.1.332", status);
			let health = programs.claude_runtime(None).health().await;
			assert_eq!(rows(&health)[3], ("loggedIn", failed(problem.clone()), None), "{name}");
			assert_eq!(health.failing(), Some((Check::LoggedIn, problem)), "{name}");
		}
	}

	#[tokio::test]
	async fn an_old_claude_code_is_too_old_and_its_login_still_read() {
		let programs = Programs::new("claude-old").node("v26.9.0").claude("2.1.327", status::MAX);
		let health = programs.claude_runtime(None).health().await;
		assert_eq!(rows(&health), [("installed", PASSED, Some("2.1.327")), ("node", PASSED, Some("26.9.0")), ("upToDate", failed(Problem::TooOld), Some("2.1.327")), ("loggedIn", PASSED, Some("Max plan"))]);
		assert_eq!(health.failing(), Some((Check::UpToDate, Problem::TooOld)));
	}

	#[tokio::test]
	async fn claude_code_not_installed_leaves_the_checks_after_it_unasked() {
		let programs = Programs::new("claude-none").node("v26.9.0");
		let health = programs.claude_runtime(None).health().await;
		assert_eq!(rows(&health), [("installed", failed(Problem::NotInstalled), None), ("node", PASSED, Some("26.9.0")), ("upToDate", UNCHECKED, None), ("loggedIn", UNCHECKED, None)]);
		assert_eq!(health.failing(), Some((Check::Installed, Problem::NotInstalled)));
	}

	#[tokio::test]
	async fn an_old_node_is_the_first_failure_after_an_installed_claude_code() {
		let programs = Programs::new("claude-node").node("v16.20.2").claude("2.1.332", status::MAX);
		let health = programs.claude_runtime(None).health().await;
		assert_eq!(rows(&health)[1], ("node", failed(Problem::NoNode), Some("16.20.2")));
		assert_eq!(health.failing(), Some((Check::Node, Problem::NoNode)));
	}

	#[tokio::test]
	async fn a_missing_helper_comes_after_every_row() {
		let programs = Programs::new("claude-helper").node("v26.9.0").claude("2.1.332", status::MAX);
		let runtime = Runtime::claude(programs.env(), programs.0.join("no-such-helper.mjs"), None);
		let health = runtime.health().await;
		assert!(health.rows.iter().all(|row| row.outcome == PASSED));
		assert_eq!(health.failing(), Some((Check::Helper, Problem::NoHelper)));
	}

	#[tokio::test]
	async fn a_check_that_cannot_read_its_answer_fails_with_the_reason() {
		let programs = Programs::new("claude-garbled").node("v26.9.0").claude("2.1.332", "Not logged in. Run claude auth login to authenticate.");
		let health = programs.claude_runtime(None).health().await;
		assert_eq!(health.failing(), Some((Check::LoggedIn, Problem::Failed("claude auth status printed no JSON".into()))));
		let silent = Programs::new("claude-silent").node("v26.9.0").add("claude", "exit 0\n");
		assert_eq!(silent.claude_runtime(None).health().await.failing(), Some((Check::Installed, Problem::Failed("claude --version printed no version".into()))));
	}

	#[tokio::test]
	async fn the_learners_own_command_is_asked_nothing() {
		// The command would fail every check; it is never run.
		let programs = Programs::new("own").node("v26.9.0");
		let claude = programs.claude_runtime(Some("false")).health().await;
		assert_eq!((claude.own_command, rows(&claude)), (true, vec![("node", PASSED, Some("26.9.0"))]), "the helper still runs on Node");
		let codex = programs.codex_runtime(Some("false")).health().await;
		assert_eq!((codex.own_command, codex.rows.len(), codex.failing()), (true, 0, None));
	}

	#[tokio::test]
	async fn codex_reads_its_plan_from_godspeeds_own_folder() {
		let plus = r#"{"account":{"type":"chatgpt","email":"learner@example.com","planType":"plus","workspaceName":null},"userId":"u","requiresOpenaiAuth":true,"workspaceRouting":null}"#;
		let programs = Programs::new("codex-plus").codex("0.169.0", plus);
		let health = programs.codex_runtime(None).health().await;
		assert_eq!(rows(&health), [("installed", PASSED, Some("0.169.0")), ("upToDate", PASSED, None), ("loggedIn", PASSED, Some("Plus plan"))]);
	}

	#[tokio::test]
	async fn each_codex_account_that_cant_run_says_why() {
		let signed_out = r#"{"account":null,"userId":null,"requiresOpenaiAuth":true,"workspaceRouting":null}"#;
		let api_key = r#"{"account":{"type":"apiKey"},"userId":null,"requiresOpenaiAuth":true,"workspaceRouting":null}"#;
		for (name, account, problem) in [("codex-out", signed_out, Problem::SignedOut), ("codex-key", api_key, Problem::BillsByUse)] {
			let programs = Programs::new(name).codex("0.169.0", account);
			assert_eq!(programs.codex_runtime(None).health().await.failing(), Some((Check::LoggedIn, problem)), "{name}");
		}
	}

	#[tokio::test]
	async fn an_old_codex_is_not_asked_who_is_signed_in() {
		let programs = Programs::new("codex-old").codex("0.42.0", "{}");
		let health = programs.codex_runtime(None).health().await;
		assert_eq!(rows(&health), [("installed", PASSED, Some("0.42.0")), ("upToDate", failed(Problem::TooOld), Some("0.42.0")), ("loggedIn", UNCHECKED, None)]);
		let none = Programs::new("codex-none");
		assert_eq!(none.codex_runtime(None).health().await.failing(), Some((Check::Installed, Problem::NotInstalled)));
	}
}

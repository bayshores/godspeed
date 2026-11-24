//! Whether an agent can run in godspeed: installed, new enough, signed in, and on which plan.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use gs_base::clock;
use gs_core::spaces::agent_folder::FolderAgent;
use gs_json::Json;
use tokio::process::Command;

use crate::codex::wire;
use crate::process::{AgentEnv, Launch, hide_window};
use crate::session::{Runtime, codex_vars};

/// The oldest Claude Code the pinned Agent SDK was built with.
const CLAUDE_FLOOR: &str = "2.1.331";
/// The oldest Codex whose app-server has client tools as godspeed uses them.
const CODEX_FLOOR: &str = "0.169.0";

/// What stops the agent from running, the first one found.
#[derive(Clone, Debug, PartialEq)]
pub enum Problem {
	NotInstalled,
	TooOld,
	/// Node.js runs godspeed's Claude helper.
	NoNode,
	NoHelper,
	SignedOut,
	/// A check could not run; the text says why.
	Failed(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct AgentHealth {
	pub agent: FolderAgent,
	pub path: Option<PathBuf>,
	pub version: Option<String>,
	pub new_enough: bool,
	pub signed_in: bool,
	pub plan: Option<String>,
	pub problem: Option<Problem>,
}

impl AgentHealth {
	fn new(agent: FolderAgent) -> AgentHealth {
		AgentHealth { agent, path: None, version: None, new_enough: false, signed_in: false, plan: None, problem: None }
	}

	/// Keeps the first problem found.
	fn found(&mut self, problem: Problem) {
		self.problem.get_or_insert(problem);
	}
}

/// A check that takes longer than this has failed.
const CHECK_MS: i64 = 15_000;

impl Runtime {
	pub async fn health(&self) -> AgentHealth {
		let Some(env) = self.env() else {
			// The fake agent is always ready.
			return AgentHealth { new_enough: true, signed_in: true, ..AgentHealth::new(self.agent()) };
		};
		match self.agent() {
			FolderAgent::Claude => claude_health(self, env).await,
			FolderAgent::Codex => codex_health(self, env).await,
		}
	}
}

async fn claude_health(runtime: &Runtime, env: &AgentEnv) -> AgentHealth {
	let mut health = AgentHealth::new(FolderAgent::Claude);
	let Some(helper) = runtime.claude_helper() else { return health };
	if runtime.own_command().is_some() {
		// A launcher may not pass `--version` or `auth status` on, so it is not asked, as the
		// start scripts never asked it.
		health.new_enough = true;
		health.signed_in = true;
	} else {
		match env.find("claude").await {
			None => health.found(Problem::NotInstalled),
			Some(claude) => {
				health.path = Some(claude.clone());
				match env.launch(claude).await {
					Ok(launch) => {
						read_version(&mut health, run(&launch, &["--version"], env.vars().await).await, CLAUDE_FLOOR);
						match run(&launch, &["auth", "status"], env.vars().await).await {
							Ok(out) => {
								(health.signed_in, health.plan) = claude_login(&out);
								if !health.signed_in {
									health.found(Problem::SignedOut);
								}
							}
							Err(err) => health.found(Problem::Failed(err)),
						}
					}
					Err(err) => health.found(Problem::Failed(err)),
				}
			}
		}
	}
	if env.find("node").await.is_none() {
		health.found(Problem::NoNode);
	}
	if !helper.is_file() {
		health.found(Problem::NoHelper);
	}
	health
}

/// Asks Codex in godspeed's own settings folder, where the learner signs in through godspeed.
async fn codex_health(runtime: &Runtime, env: &AgentEnv) -> AgentHealth {
	let mut health = AgentHealth::new(FolderAgent::Codex);
	let Some(home) = runtime.codex_home() else { return health };
	if runtime.own_command().is_some() {
		// A launcher may not pass `--version` on; the sign-in is still asked through it.
		health.new_enough = true;
	} else {
		let Some(codex) = env.find("codex").await else {
			health.found(Problem::NotInstalled);
			return health;
		};
		health.path = Some(codex.clone());
		match env.launch(codex).await {
			Ok(launch) => read_version(&mut health, run(&launch, &["--version"], &codex_vars(env.vars().await, home)).await, CODEX_FLOOR),
			Err(err) => health.found(Problem::Failed(err)),
		}
		if health.problem.is_some() {
			return health;
		}
	}
	match runtime.codex_account().await {
		Ok(account) => {
			health.plan = wire::account_plan(&account);
			health.signed_in = health.plan.is_some();
			if !health.signed_in {
				health.found(Problem::SignedOut);
			}
		}
		Err(err) => health.found(Problem::Failed(err)),
	}
	health
}

fn read_version(health: &mut AgentHealth, out: Result<String, String>, floor: &str) {
	match out.map(|out| version(&out)) {
		Ok(Some(found)) => {
			health.new_enough = at_least(&found, floor);
			health.version = Some(found);
			if !health.new_enough {
				health.found(Problem::TooOld);
			}
		}
		Ok(None) => health.found(Problem::Failed("it printed no version".to_owned())),
		Err(err) => health.found(Problem::Failed(err)),
	}
}

/// What the program prints with `args`, whatever its exit code (`auth status` ends with 1 when
/// signed out).
async fn run(launch: &Launch, args: &[&str], vars: &[(OsString, OsString)]) -> Result<String, String> {
	let mut command = Command::new(&launch.program);
	command.args(&launch.args).args(args).env_clear().envs(vars.iter().map(|(key, value)| (key, value)));
	command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
	hide_window(&mut command);
	let name = Path::new(&launch.program).file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
	let output = clock::within(CHECK_MS, command.output()).await.ok_or_else(|| format!("{name} {} took too long", args.join(" ")))?.map_err(|err| format!("{name} {}: {err}", args.join(" ")))?;
	Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// The first `x.y.z` in a program's version line.
fn version(text: &str) -> Option<String> {
	text.split(|c: char| !(c.is_ascii_digit() || c == '.')).find_map(|word| {
		let parts: Vec<&str> = word.split('.').take(3).collect();
		(parts.len() == 3 && parts.iter().all(|part| !part.is_empty())).then(|| parts.join("."))
	})
}

fn at_least(version: &str, floor: &str) -> bool {
	let numbers = |text: &str| text.split('.').map(|part| part.parse::<u64>().unwrap_or(0)).collect::<Vec<_>>();
	numbers(version) >= numbers(floor)
}

/// Signed in, and the plan, from `claude auth status`'s JSON.
fn claude_login(out: &str) -> (bool, Option<String>) {
	let status = gs_json::parse(out.trim()).unwrap_or(Json::Null);
	(status["loggedIn"].as_bool() == Some(true), status["subscriptionType"].as_str().map(str::to_owned))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_version_is_read_from_each_programs_own_line() {
		assert_eq!(version("2.1.331 (Claude Code)\n"), Some("2.1.331".into()));
		assert_eq!(version("codex-cli 0.169.0\n"), Some("0.169.0".into()));
		assert_eq!(version("codex-cli 0.42.0-alpha.3"), Some("0.42.0".into()));
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
	}

	#[test]
	fn the_claude_login_is_read_from_auth_status() {
		let signed_in = r#"{ "loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "subscriptionType": "max", "planTier": "max_20x" }"#;
		assert_eq!(claude_login(signed_in), (true, Some("max".into())));
		assert_eq!(claude_login(r#"{ "loggedIn": false }"#), (false, None));
		assert_eq!(claude_login("Not logged in"), (false, None));
	}

	#[tokio::test]
	async fn a_fake_agent_is_always_ready() {
		let health = crate::fake::FakeAgent::new(Vec::new()).runtime().health().await;
		assert_eq!((health.new_enough, health.signed_in, health.problem), (true, true, None));
	}
}

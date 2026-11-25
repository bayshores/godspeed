//! Whether an agent can run in godspeed: each check of the setup card, in the card's order, with
//! the fact it found (a version, the plan) and why it failed. A check makes no model call and the
//! whole of it takes 15 seconds at most.

use std::ffi::OsString;
use std::path::Path;
use std::process::Stdio;

use gs_base::clock;
use gs_core::spaces::agent_folder::FolderAgent;
use tokio::process::Command;

use crate::codex::wire::{self, Account};
use crate::process::{AgentEnv, Launch, hide_window};
use crate::session::{Runtime, codex_vars, debug_helper, helper_to_run};

/// The oldest Claude Code the pinned Agent SDK was built with.
const CLAUDE_FLOOR: &str = "2.1.331";
/// The oldest Codex whose app-server has client tools as godspeed uses them.
const CODEX_FLOOR: &str = "0.169.0";
/// The oldest Node.js the Claude helper runs on.
const NODE_FLOOR: &str = "18.0.0";

/// The whole check takes at most this long.
const CHECK_MS: i64 = 15_000;

/// One check, in the order the card shows them. `Helper` is godspeed's own part and has no row.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Check {
	Installed,
	/// Node.js runs godspeed's Claude helper; Claude Code only.
	Node,
	UpToDate,
	LoggedIn,
	Helper,
}

impl Check {
	pub fn name(self) -> &'static str {
		match self {
			Check::Installed => "installed",
			Check::Node => "node",
			Check::UpToDate => "upToDate",
			Check::LoggedIn => "loggedIn",
			Check::Helper => "helper",
		}
	}
}

/// Why a check failed.
#[derive(Clone, Debug, PartialEq)]
pub enum Problem {
	NotInstalled,
	NoNode,
	TooOld,
	SignedOut,
	/// Signed in a way that bills by use (a Console account's key, a cloud platform, an API key)
	/// instead of a plan.
	BillsByUse,
	/// A free Claude account, which Claude Code does not run on.
	FreeAccount,
	NoHelper,
	/// The check could not run; the text says why.
	Failed(String),
}

impl Problem {
	pub fn name(&self) -> &'static str {
		match self {
			Problem::NotInstalled => "notInstalled",
			Problem::NoNode => "noNode",
			Problem::TooOld => "tooOld",
			Problem::SignedOut => "signedOut",
			Problem::BillsByUse => "billsByUse",
			Problem::FreeAccount => "freeAccount",
			Problem::NoHelper => "noHelper",
			Problem::Failed(_) => "failed",
		}
	}

	pub fn reason(&self) -> Option<&str> {
		match self {
			Problem::Failed(why) => Some(why),
			_ => None,
		}
	}
}

#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
	Passed,
	Failed(Problem),
	/// Not checked: an earlier check failed in a way that leaves it nothing to ask.
	Unchecked,
}

/// One row of the card. `fact` is the version found, or the plan's words.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
	pub check: Check,
	pub outcome: Outcome,
	pub fact: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct AgentHealth {
	pub agent: FolderAgent,
	/// The learner starts the agent with their own command, which is asked nothing.
	pub own_command: bool,
	pub rows: Vec<Row>,
	pub helper_missing: bool,
}

/// The card's rows for `agent`, in order. The learner's own command is asked nothing, but Claude
/// Code's helper still runs on Node.js.
fn checks_of(agent: FolderAgent, own_command: bool) -> &'static [Check] {
	match (agent, own_command) {
		(FolderAgent::Claude, false) => &[Check::Installed, Check::Node, Check::UpToDate, Check::LoggedIn],
		(FolderAgent::Claude, true) => &[Check::Node],
		(FolderAgent::Codex, false) => &[Check::Installed, Check::UpToDate, Check::LoggedIn],
		(FolderAgent::Codex, true) => &[],
	}
}

impl AgentHealth {
	/// The card before any check has run.
	pub fn unchecked(agent: FolderAgent, own_command: bool) -> AgentHealth {
		AgentHealth { agent, own_command, rows: checks_of(agent, own_command).iter().map(|check| unchecked(*check)).collect(), helper_missing: false }
	}

	/// The first check that failed, in the card's order, and why.
	pub fn failing(&self) -> Option<(Check, Problem)> {
		let row = self.rows.iter().find_map(|row| match &row.outcome {
			Outcome::Failed(problem) => Some((row.check, problem.clone())),
			_ => None,
		});
		row.or_else(|| self.helper_missing.then_some((Check::Helper, Problem::NoHelper)))
	}
}

fn row(check: Check, outcome: Outcome, fact: Option<String>) -> Row {
	Row { check, outcome, fact }
}

fn unchecked(check: Check) -> Row {
	row(check, Outcome::Unchecked, None)
}

/// The time left of the check's 15 seconds.
struct Deadline(i64);

impl Deadline {
	fn left(&self) -> i64 {
		(self.0 - clock::now_ms()).max(0)
	}
}

impl Runtime {
	pub async fn health(&self) -> AgentHealth {
		let deadline = Deadline(clock::now_ms() + CHECK_MS);
		let agent = self.agent();
		let own_command = self.own_command().is_some();
		let Some(env) = self.env() else {
			// The fake agent is always ready.
			let rows = checks_of(agent, own_command).iter().map(|check| row(*check, Outcome::Passed, None)).collect();
			return AgentHealth { agent, own_command, rows, helper_missing: false };
		};
		let (rows, helper_missing) = match agent {
			FolderAgent::Claude => {
				let helper = self.claude_helper().is_some_and(|helper| helper_to_run(helper, debug_helper()).is_file());
				(claude_rows(env, own_command, &deadline).await, !helper)
			}
			FolderAgent::Codex => (if own_command { Vec::new() } else { codex_rows(self, env, &deadline).await }, false),
		};
		AgentHealth { agent, own_command, rows, helper_missing }
	}
}

/// Claude Code's rows, in `checks_of`'s order.
async fn claude_rows(env: &AgentEnv, own_command: bool, deadline: &Deadline) -> Vec<Row> {
	let node = node_row(env, deadline).await;
	if own_command {
		return vec![node];
	}
	let Some(claude) = env.find("claude").await else {
		return vec![row(Check::Installed, Outcome::Failed(Problem::NotInstalled), None), node, unchecked(Check::UpToDate), unchecked(Check::LoggedIn)];
	};
	let launch = match env.launch(claude).await {
		Ok(launch) => launch,
		Err(err) => return vec![row(Check::Installed, Outcome::Failed(Problem::Failed(err)), None), node, unchecked(Check::UpToDate), unchecked(Check::LoggedIn)],
	};
	let vars = env.vars().await;
	let (installed, up_to_date) = version_rows("claude", run(&launch, &["--version"], vars, deadline).await, CLAUDE_FLOOR);
	let logged_in = if installed.outcome == Outcome::Passed {
		let (outcome, fact) = match run(&launch, &["auth", "status"], vars, deadline).await.and_then(|out| claude_login(&out)) {
			Ok(plan) => (Outcome::Passed, plan),
			Err(problem) => (Outcome::Failed(problem), None),
		};
		row(Check::LoggedIn, outcome, fact)
	} else {
		unchecked(Check::LoggedIn)
	};
	vec![installed, node, up_to_date, logged_in]
}

async fn node_row(env: &AgentEnv, deadline: &Deadline) -> Row {
	let Some(node) = env.find("node").await else { return row(Check::Node, Outcome::Failed(Problem::NoNode), None) };
	let launch = Launch { program: node, args: Vec::new() };
	match run(&launch, &["--version"], env.vars().await, deadline).await.map(|out| version(&out)) {
		Ok(Some(found)) => {
			let outcome = if at_least(&found, NODE_FLOOR) { Outcome::Passed } else { Outcome::Failed(Problem::NoNode) };
			row(Check::Node, outcome, Some(found))
		}
		Ok(None) => row(Check::Node, Outcome::Failed(Problem::Failed("node --version printed no version".to_owned())), None),
		Err(problem) => row(Check::Node, Outcome::Failed(problem), None),
	}
}

/// Codex's rows, in `checks_of`'s order. Its sign-in is read from godspeed's own Codex settings
/// folder, where the learner signs in through godspeed; an app-server older than the floor is
/// not asked.
async fn codex_rows(runtime: &Runtime, env: &AgentEnv, deadline: &Deadline) -> Vec<Row> {
	let Some(home) = runtime.codex_home() else { return Vec::new() };
	let Some(codex) = env.find("codex").await else {
		return vec![row(Check::Installed, Outcome::Failed(Problem::NotInstalled), None), unchecked(Check::UpToDate), unchecked(Check::LoggedIn)];
	};
	let launch = match env.launch(codex).await {
		Ok(launch) => launch,
		Err(err) => return vec![row(Check::Installed, Outcome::Failed(Problem::Failed(err)), None), unchecked(Check::UpToDate), unchecked(Check::LoggedIn)],
	};
	let (installed, up_to_date) = version_rows("codex", run(&launch, &["--version"], &codex_vars(env.vars().await, home), deadline).await, CODEX_FLOOR);
	if up_to_date.outcome != Outcome::Passed {
		return vec![installed, up_to_date, unchecked(Check::LoggedIn)];
	}
	let logged_in = match clock::within(deadline.left(), runtime.codex_account()).await {
		None => row(Check::LoggedIn, Outcome::Failed(Problem::Failed("Codex took too long to say who is signed in".to_owned())), None),
		Some(Err(err)) => row(Check::LoggedIn, Outcome::Failed(Problem::Failed(err)), None),
		Some(Ok(result)) => match wire::account(&result) {
			Account::None => row(Check::LoggedIn, Outcome::Failed(Problem::SignedOut), None),
			Account::ByUse => row(Check::LoggedIn, Outcome::Failed(Problem::BillsByUse), None),
			Account::Plan(plan) => row(Check::LoggedIn, Outcome::Passed, plan.as_deref().and_then(plan_words)),
		},
	};
	vec![installed, up_to_date, logged_in]
}

/// The Installed and Up to date rows from what `<name> --version` printed.
fn version_rows(name: &str, out: Result<String, Problem>, floor: &str) -> (Row, Row) {
	match out.map(|out| version(&out)) {
		Ok(Some(found)) => {
			let new_enough = at_least(&found, floor);
			let up_to_date = if new_enough { row(Check::UpToDate, Outcome::Passed, None) } else { row(Check::UpToDate, Outcome::Failed(Problem::TooOld), Some(found.clone())) };
			(row(Check::Installed, Outcome::Passed, Some(found)), up_to_date)
		}
		Ok(None) => (row(Check::Installed, Outcome::Failed(Problem::Failed(format!("{name} --version printed no version"))), None), unchecked(Check::UpToDate)),
		Err(problem) => (row(Check::Installed, Outcome::Failed(problem), None), unchecked(Check::UpToDate)),
	}
}

/// What the program prints with `args`, whatever its exit code (`auth status` ends with 1 when
/// signed out), within the check's time.
async fn run(launch: &Launch, args: &[&str], vars: &[(OsString, OsString)], deadline: &Deadline) -> Result<String, Problem> {
	let mut command = Command::new(&launch.program);
	command.args(&launch.args).args(args).env_clear().envs(vars.iter().map(|(key, value)| (key, value)));
	command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
	hide_window(&mut command);
	let name = Path::new(&launch.program).file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
	let said = format!("{name} {}", args.join(" "));
	let output = clock::within(deadline.left(), command.output()).await.ok_or_else(|| Problem::Failed(format!("{said} took too long")))?.map_err(|err| Problem::Failed(format!("{said}: {err}")))?;
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

/// The words for each plan the agents name; another plan passes with no words.
const PLAN_WORDS: [(&str, &str); 9] = [
	("free", "Free plan"),
	("go", "Go plan"),
	("plus", "Plus plan"),
	("pro", "Pro plan"),
	("max", "Max plan"),
	("team", "Team plan"),
	("business", "Business plan"),
	("enterprise", "Enterprise plan"),
	("edu", "Edu plan"),
];

fn plan_words(plan: &str) -> Option<String> {
	PLAN_WORDS.iter().find(|(name, _)| *name == plan).map(|(_, words)| (*words).to_owned())
}

/// The plan's words from `claude auth status`'s JSON, or why Claude Code can't run on it.
fn claude_login(out: &str) -> Result<Option<String>, Problem> {
	let status = gs_json::parse(out.trim()).map_err(|_| Problem::Failed("claude auth status printed no JSON".to_owned()))?;
	if status["loggedIn"].as_bool() != Some(true) {
		return Err(Problem::SignedOut);
	}
	match status["authMethod"].as_str() {
		Some("claude.ai") => match status["subscriptionType"].as_str() {
			None | Some("free") => Err(Problem::FreeAccount),
			Some(plan) => Ok(plan_words(plan)),
		},
		// A key from a Console account, a key helper, or a cloud platform such as Bedrock.
		Some("api_key" | "api_key_helper" | "third_party") => Err(Problem::BillsByUse),
		// CLAUDE_CODE_OAUTH_TOKEN, a plan's long-lived token, which names no plan.
		_ => Ok(None),
	}
}

#[cfg(test)]
mod tests;

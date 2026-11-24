//! Everything `codex app-server` names: its methods and the shapes of what goes each way, from
//! its generated types (`codex app-server generate-ts --experimental`, v2). Client tools are an
//! experimental part of that protocol, so what may change is kept in this one file.

use gs_json::{Json, Obj, json};

use crate::event::{Ask, Part, ToolCall, ToolReply, Usage, Verdict};
use crate::session::SessionSpec;

pub const INITIALIZE: &str = "initialize";
pub const INITIALIZED: &str = "initialized";
pub const ACCOUNT_READ: &str = "account/read";
pub const LOGIN_START: &str = "account/login/start";
pub const LOGIN_CANCEL: &str = "account/login/cancel";
pub const THREAD_START: &str = "thread/start";
pub const THREAD_RESUME: &str = "thread/resume";
pub const THREAD_UNSUBSCRIBE: &str = "thread/unsubscribe";
pub const TURN_START: &str = "turn/start";
pub const TURN_STEER: &str = "turn/steer";
pub const TURN_INTERRUPT: &str = "turn/interrupt";

/// Codex's usual Auto: commands run without asking and may write only in the session's folder
/// (the thread's cwd), and Codex asks the learner before it needs more than that.
const SANDBOX: &str = "workspace-write";
const APPROVAL_POLICY: &str = "on-request";

/// Client tools (`dynamicTools`) are behind the experimental flag.
pub fn initialize(version: &str) -> Json {
	json!({
		"clientInfo": { "name": "godspeed", "title": "godspeed", "version": version },
		"capabilities": { "experimentalApi": true, "requestAttestation": false },
	})
}

/// What godspeed's threads leave out, as Claude Code runs with no setting sources. godspeed's own
/// settings folder holds none of the learner's setup, but Codex still adds by default: the ChatGPT
/// apps of the account signed in, sub-agents, a list of skills (the learner's `~/.agents/skills`
/// among them), and the folder's AGENTS.md.
fn thread_config() -> Json {
	json!({
		"features.apps": false,
		"agents.enabled": false,
		"skills.include_instructions": false,
		"project_doc_max_bytes": 0,
	})
}

pub fn account_read() -> Json {
	json!({ "refreshToken": false })
}

/// A ChatGPT sign-in into godspeed's own Codex folder; Codex answers with a page to open.
pub fn login_start() -> Json {
	json!({ "type": "chatgpt" })
}

/// The sign-in's id and the page to open, from `account/login/start`'s answer.
pub fn login_started(result: &Json) -> Option<(String, String)> {
	Some((result["loginId"].as_str()?.to_owned(), result["authUrl"].as_str()?.to_owned()))
}

pub fn login_cancel(login: &str) -> Json {
	json!({ "loginId": login })
}

fn tools(spec: &SessionSpec) -> Json {
	spec.tools.iter().map(|tool| json!({ "type": "function", "name": tool.name, "description": tool.description, "inputSchema": tool.input_schema })).collect()
}

/// The settings a thread starts and resumes with. The tools are kept with a thread, so a resume
/// cannot name them.
fn settings(spec: &SessionSpec) -> Obj {
	let mut settings = Obj::new();
	settings.insert("cwd", spec.cwd.to_string_lossy().into_owned());
	settings.insert("model", spec.model.clone());
	settings.insert("sandbox", SANDBOX);
	settings.insert("approvalPolicy", APPROVAL_POLICY);
	settings.insert("developerInstructions", spec.instructions.clone());
	settings.insert("config", thread_config());
	settings
}

pub fn thread_start(spec: &SessionSpec) -> Json {
	let mut params = settings(spec);
	params.insert("dynamicTools", tools(spec));
	params.insert("ephemeral", !spec.persist);
	Json::Obj(params)
}

pub fn thread_resume(thread: &str, spec: &SessionSpec) -> Json {
	let mut params = Obj::new();
	params.insert("threadId", thread);
	params.extend(settings(spec));
	// Only new turns matter; the history stays with Codex.
	params.insert("excludeTurns", true);
	Json::Obj(params)
}

/// The thread id in a `thread/start` or `thread/resume` result.
pub fn thread_id(result: &Json) -> Option<String> {
	result["thread"]["id"].as_str().map(str::to_owned)
}

pub fn thread_unsubscribe(thread: &str) -> Json {
	json!({ "threadId": thread })
}

fn input(parts: &[Part]) -> Json {
	parts
		.iter()
		.map(|part| match part {
			Part::Text(text) => json!({ "type": "text", "text": text, "text_elements": [] }),
			Part::Image { mime, base64 } => json!({ "type": "image", "url": format!("data:{mime};base64,{base64}") }),
		})
		.collect()
}

/// A model picked since the last turn goes with the next one, and stays for the turns after.
pub fn turn_start(thread: &str, parts: &[Part], model: Option<&str>) -> Json {
	let mut params = json!({ "threadId": thread, "input": input(parts) });
	if let Some(model) = model {
		params.set("model", model);
	}
	params
}

/// The turn id in a `turn/start` result.
pub fn turn_id(result: &Json) -> Option<String> {
	result["turn"]["id"].as_str().map(str::to_owned)
}

pub fn turn_steer(thread: &str, turn: &str, parts: &[Part]) -> Json {
	json!({ "threadId": thread, "input": input(parts), "expectedTurnId": turn })
}

pub fn turn_interrupt(thread: &str, turn: &str) -> Json {
	json!({ "threadId": thread, "turnId": turn })
}

/// The answer to `item/tool/call`.
pub fn tool_result(reply: &ToolReply) -> Json {
	let items: Json = reply
		.content
		.iter()
		.map(|part| match part {
			Part::Text(text) => json!({ "type": "inputText", "text": text }),
			Part::Image { mime, base64 } => json!({ "type": "inputImage", "imageUrl": format!("data:{mime};base64,{base64}") }),
		})
		.collect();
	json!({ "contentItems": items, "success": !reply.is_error })
}

/// Who is signed in, from an `account/read` result: the plan, or None when no one is.
pub fn account_plan(result: &Json) -> Option<String> {
	let account = &result["account"];
	let kind = account["type"].as_str()?;
	Some(account["planType"].as_str().unwrap_or(kind).to_owned())
}

/// One item of a turn, as godspeed tells them apart.
#[derive(Debug, PartialEq)]
pub enum Item {
	/// A reply, whole once the item completes.
	Message { text: String },
	/// A call of one of godspeed's tools.
	ToolCall { id: String, tool: String },
	/// One of Codex's own tools; the item itself is passed on.
	Own { id: String, kind: String, item: Json },
	/// The learner's own message, reasoning, plans and the like.
	Other,
}

/// Codex's own tools, by item type.
const OWN_ITEMS: [&str; 5] = ["commandExecution", "fileChange", "mcpToolCall", "webSearch", "imageView"];

fn item(item: &Json) -> Item {
	let id = item["id"].str_or_empty().to_owned();
	match item["type"].as_str() {
		Some("agentMessage") => Item::Message { text: item["text"].str_or_empty().to_owned() },
		Some("dynamicToolCall") => Item::ToolCall { id, tool: item["tool"].str_or_empty().to_owned() },
		Some(kind) if OWN_ITEMS.contains(&kind) => Item::Own { id, kind: kind.to_owned(), item: item.clone() },
		_ => Item::Other,
	}
}

#[derive(Debug, PartialEq)]
pub enum TurnStatus {
	Completed,
	Interrupted,
	Failed,
}

/// A notification from app-server, read once here.
#[derive(Debug, PartialEq)]
pub enum Note {
	TurnStarted { thread: String, turn: String },
	TextDelta { thread: String, text: String },
	Item { thread: String, turn: String, item: Item, done: bool },
	Usage { thread: String, usage: Usage },
	Compacted { thread: String },
	TurnCompleted { thread: String, status: TurnStatus, error: Option<String> },
	Error { thread: String, message: String, will_retry: bool },
	/// A sign-in ended: done, cancelled or failed (the text says why).
	LoginEnded { login: String, result: Result<(), String> },
	/// Notifications godspeed has no use for.
	Other,
}

fn count(value: &Json) -> u64 {
	value.as_f64().map_or(0, |n| n.max(0.0) as u64)
}

fn text(value: &Json) -> String {
	value.str_or_empty().to_owned()
}

pub fn note(method: &str, params: &Json) -> Note {
	let thread = text(&params["threadId"]);
	match method {
		"turn/started" => Note::TurnStarted { thread, turn: text(&params["turn"]["id"]) },
		"item/agentMessage/delta" => Note::TextDelta { thread, text: text(&params["delta"]) },
		"item/started" | "item/completed" => Note::Item { thread, turn: text(&params["turnId"]), item: item(&params["item"]), done: method == "item/completed" },
		"thread/tokenUsage/updated" => {
			let last = &params["tokenUsage"]["last"];
			Note::Usage { thread, usage: Usage { input: count(&last["inputTokens"]), cached: count(&last["cachedInputTokens"]), output: count(&last["outputTokens"]) } }
		}
		"thread/compacted" => Note::Compacted { thread },
		"turn/completed" => {
			let turn = &params["turn"];
			let status = match turn["status"].as_str() {
				Some("completed") => TurnStatus::Completed,
				Some("interrupted") => TurnStatus::Interrupted,
				_ => TurnStatus::Failed,
			};
			let error = turn["error"]["message"].as_str().map(str::to_owned).or_else(|| (status == TurnStatus::Failed).then(|| format!("the turn ended as {}", turn["status"].as_str().unwrap_or("unknown"))));
			Note::TurnCompleted { thread, status, error }
		}
		"error" => Note::Error { thread, message: text(&params["error"]["message"]), will_retry: params["willRetry"].truthy() },
		"account/login/completed" => {
			let result = if params["success"].truthy() { Ok(()) } else { Err(params["error"].as_str().unwrap_or("the sign-in did not finish").to_owned()) };
			Note::LoginEnded { login: text(&params["loginId"]), result }
		}
		_ => Note::Other,
	}
}

/// How an approval's answer is written: each request has its own shape.
#[derive(Debug, PartialEq)]
pub enum AnswerForm {
	/// `{decision}`, for commands and file changes.
	Decision,
	/// The asked-for permissions, granted for this turn, or none.
	Permissions(Json),
	/// One answer per question id.
	Answers(Vec<String>),
	Elicitation,
}

/// A request app-server sends godspeed.
#[derive(Debug, PartialEq)]
pub enum ServerRequest {
	ToolCall { thread: String, call: ToolCall },
	Approval { thread: String, ask: Ask, form: AnswerForm },
	/// Requests godspeed does not answer (login token refresh, attestation, the old v1 approvals).
	Unknown,
}

fn reason(params: &Json) -> Option<String> {
	params["reason"].as_str().map(str::to_owned)
}

pub fn server_request(method: &str, params: &Json) -> ServerRequest {
	let thread = text(&params["threadId"]);
	let approval = |ask: Ask, form: AnswerForm| ServerRequest::Approval { thread: thread.clone(), ask, form };
	match method {
		"item/tool/call" => ServerRequest::ToolCall { thread: thread.clone(), call: ToolCall { id: text(&params["callId"]), name: text(&params["tool"]), args: params["arguments"].clone() } },
		"item/commandExecution/requestApproval" => approval(Ask::Command { command: text(&params["command"]), cwd: text(&params["cwd"]), reason: reason(params) }, AnswerForm::Decision),
		"item/fileChange/requestApproval" => approval(Ask::FileChange { reason: reason(params) }, AnswerForm::Decision),
		"item/permissions/requestApproval" => approval(Ask::Permissions { reason: reason(params), permissions: params["permissions"].clone() }, AnswerForm::Permissions(params["permissions"].clone())),
		"item/tool/requestUserInput" => {
			let ids = params["questions"].items().iter().map(|question| text(&question["id"])).collect();
			approval(Ask::Question { questions: params["questions"].clone() }, AnswerForm::Answers(ids))
		}
		"mcpServer/elicitation/request" => {
			let message = params["message"].as_str().or_else(|| params["description"].as_str()).unwrap_or_default().to_owned();
			approval(Ask::Elicitation { server: text(&params["serverName"]), message }, AnswerForm::Elicitation)
		}
		_ => ServerRequest::Unknown,
	}
}

pub fn approval_answer(form: &AnswerForm, verdict: &Verdict) -> Json {
	let allow = verdict.allow;
	match form {
		AnswerForm::Decision => json!({ "decision": if allow { "accept" } else { "decline" } }),
		AnswerForm::Permissions(asked) => json!({ "permissions": if allow { asked.clone() } else { json!({}) }, "scope": "turn" }),
		AnswerForm::Answers(ids) => {
			let answer = verdict.message.clone().unwrap_or_default();
			let answers: Obj = if allow { ids.iter().map(|id| (id.clone(), json!({ "answers": [answer] }))).collect() } else { Obj::new() };
			json!({ "answers": Json::Obj(answers) })
		}
		AnswerForm::Elicitation => json!({ "action": if allow { "accept" } else { "decline" }, "content": null, "_meta": null }),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_sign_in_is_read_from_its_answer_and_its_end() {
		let started = json!({ "type": "chatgpt", "loginId": "l1", "authUrl": "https://auth.openai.com/oauth/authorize?state=s" });
		assert_eq!(login_started(&started), Some(("l1".into(), "https://auth.openai.com/oauth/authorize?state=s".into())));
		assert_eq!(login_started(&json!({ "type": "apiKey" })), None);
		let ended = |params: Json| match note("account/login/completed", &params) {
			Note::LoginEnded { login, result } => (login, result),
			other => panic!("not a sign-in: {other:?}"),
		};
		assert_eq!(ended(json!({ "loginId": "l1", "success": true, "error": null })), ("l1".into(), Ok(())));
		assert_eq!(ended(json!({ "loginId": "l1", "success": false, "error": "Login server error: Login was not completed" })), ("l1".into(), Err("Login server error: Login was not completed".into())));
	}

	#[test]
	fn an_approval_is_answered_in_its_own_shape() {
		let allow = Verdict { allow: true, message: Some("x = 2".into()) };
		let deny = Verdict { allow: false, message: None };
		assert_eq!(approval_answer(&AnswerForm::Decision, &allow), json!({ "decision": "accept" }));
		assert_eq!(approval_answer(&AnswerForm::Decision, &deny), json!({ "decision": "decline" }));
		let asked = json!({ "network": { "enabled": true }, "fileSystem": null });
		assert_eq!(approval_answer(&AnswerForm::Permissions(asked.clone()), &allow), json!({ "permissions": asked, "scope": "turn" }));
		assert_eq!(approval_answer(&AnswerForm::Permissions(asked), &deny), json!({ "permissions": {}, "scope": "turn" }));
		assert_eq!(approval_answer(&AnswerForm::Answers(vec!["q1".into()]), &allow), json!({ "answers": { "q1": { "answers": ["x = 2"] } } }));
		assert_eq!(approval_answer(&AnswerForm::Answers(vec!["q1".into()]), &deny), json!({ "answers": {} }));
		assert_eq!(approval_answer(&AnswerForm::Elicitation, &deny), json!({ "action": "decline", "content": null, "_meta": null }));
	}

	#[test]
	fn the_plan_is_read_from_the_account() {
		assert_eq!(account_plan(&json!({ "account": { "type": "chatgpt", "planType": "plus" }, "requiresOpenaiAuth": true })), Some("plus".into()));
		assert_eq!(account_plan(&json!({ "account": { "type": "apiKey" } })), Some("apiKey".into()));
		assert_eq!(account_plan(&json!({ "account": null, "requiresOpenaiAuth": true })), None);
	}
}

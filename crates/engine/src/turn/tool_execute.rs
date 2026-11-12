//! What every server-side tool shares (src/backend/agent/tool-execute.ts): the per-call timeout
//! and abort guard, the result mapping and the fixed results of the question, problem and
//! conclude tools.

use std::future::Future;

use gs_base::clock;
use gs_core::contracts::chat::CONCLUDE_ACK_TEXT;
use gs_json::{Json, json, stringify};

use super::messages::text_block;
use super::tool::ToolContext;

/// A call that runs longer is aborted: the run's abort only lands between steps, so a stuck
/// local tool would otherwise hold the turn.
const TOOL_TIMEOUT_MS: i64 = 30_000;

/// How long an aborted or timed-out call may take to return its partial result (the fs tools
/// check the abort per file) before it is dropped.
const TOOL_ABORT_GRACE_MS: i64 = 250;

/// pi's tool execute for a tool body: runs `run` under the guard (the run's abort plus the
/// timeout, as `ctx.abort` of the context it gets) and maps its value with `to_tool_result`.
/// The body's `Err` and the guard's own failures reach the model as error results.
pub async fn server_execute<F, Fut>(tool_name: &str, ctx: ToolContext, run: F) -> Result<Json, String>
where
	F: FnOnce(ToolContext) -> Fut,
	Fut: Future<Output = Result<Json, String>>,
{
	let guard = ctx.abort.child();
	let body = run(ToolContext { tool_call_id: ctx.tool_call_id.clone(), abort: guard.clone() });
	tokio::pin!(body);
	let stopped = async {
		tokio::select! {
			() = guard.aborted() => {}
			() = clock::sleep(TOOL_TIMEOUT_MS) => guard.abort(),
		}
	};
	let value = tokio::select! {
		biased;
		value = &mut body => value,
		() = stopped => tokio::select! {
			biased;
			value = &mut body => value,
			() = clock::sleep(TOOL_ABORT_GRACE_MS) => Err(if ctx.abort.is_aborted() {
				"Operation aborted".to_owned()
			} else {
				format!("Tool \"{tool_name}\" timed out after {}s — the result was discarded", TOOL_TIMEOUT_MS / 1000)
			}),
		},
	}?;
	Ok(to_tool_result(&value))
}

/// A tool body's value as pi's result: a string goes to the model as it is, anything else as
/// JSON with the value as `details`; an object with a string `text` is an image result (see
/// `ImageFileResult`).
pub fn to_tool_result(value: &Json) -> Json {
	if let Some(text) = value["text"].as_str().filter(|_| value.as_obj().is_some()) {
		let mut content = vec![text_block(text)];
		content.extend(value["images"].as_arr().into_iter().flatten().map(|img| json!({ "type": "image", "data": img["data"].clone(), "mimeType": img["mimeType"].clone() })));
		return json!({ "content": content, "details": value["details"].clone() });
	}
	let text = value.as_str().map_or_else(|| stringify(value), str::to_owned);
	json!({ "content": [text_block(&text)], "details": value.clone() })
}

/// One image a tool shows the model.
pub struct Image {
	pub data: String,
	pub mime_type: String,
}

/// A tool result with images (the read tool reading a picture): `to_tool_result` turns it into
/// a text part plus image parts, and `details` goes to the record untouched.
pub struct ImageFileResult {
	pub text: String,
	pub images: Vec<Image>,
	pub details: Option<Json>,
}

impl From<ImageFileResult> for Json {
	fn from(r: ImageFileResult) -> Json {
		let images: Vec<Json> = r.images.into_iter().map(|i| json!({ "data": i.data, "mimeType": i.mime_type })).collect();
		let mut v = json!({ "text": r.text, "images": images });
		if let Some(details) = r.details {
			v.as_obj_mut().expect("an object").insert("details", details);
		}
		v
	}
}

/// The authoring-failure result: an error the model retries, with the problems kept as
/// `details` for the record and the window.
pub fn invalid_input_result(tool_name: &str, problems: &[String]) -> Json {
	let listed: Vec<String> = problems.iter().map(|p| format!("- {p}")).collect();
	json!({
		"content": [text_block(&format!("Invalid tool input for tool \"{tool_name}\":\n{}", listed.join("\n")))],
		"isError": true,
		"details": { "tool": tool_name, "problems": problems },
	})
}

/// The question tools' placeholder (quiz, ask_user_question): never saved; the learner's
/// answer arrives as this call's result. It ends a batch of questions.
pub fn question_result() -> Json {
	json!({
		"content": [text_block("Question posed — the turn ends here; the learner's graded answer arrives as this call's result.")],
		"details": null,
		"terminate": true,
	})
}

/// The practice pose's result: saved, since the learner's work arrives as messages (`arrives`
/// says how).
pub fn problem_result(arrives: &str) -> Json {
	json!({
		"content": [text_block(&format!("Problem posed — the turn ends here; {arrives}"))],
		"details": null,
		"terminate": true,
	})
}

/// The conclude ack: not terminating, so the agent can add closing words.
pub fn conclude_result() -> Json {
	json!({ "content": [text_block(CONCLUDE_ACK_TEXT)], "details": null })
}

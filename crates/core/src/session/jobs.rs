//! Ported from src/shared/core/contracts/jobs.ts: sub-agent job usage and the steer messages
//! that hand a finished (or aborted) job's result back to the teacher.

use gs_base::{clock, re::Re};
use gs_json::{Json, Obj, json};

use super::js_text::{field_text, js_string};

fn number(v: &Json, key: &str) -> Option<f64> {
	v.get(key).and_then(Json::as_f64)
}

/// Adds `key` only when the value exists, as JSON.stringify leaves out `undefined`.
fn put(out: &mut Obj, key: &str, value: Option<f64>) {
	if let Some(n) = value {
		out.insert(key, n);
	}
}

/// `piUsageToStep`: pi-ai's usage (input, output, cacheRead, cacheWrite, cacheWrite1h, reasoning)
/// as the per-call shape `accumulate_job_usage` folds.
pub fn pi_usage_to_step(usage: &Json) -> Json {
	let mut out = Obj::new();
	put(&mut out, "inputTokens", number(usage, "input"));
	put(&mut out, "outputTokens", number(usage, "output"));
	let mut input = Obj::new();
	put(&mut input, "cacheReadTokens", number(usage, "cacheRead"));
	put(&mut input, "cacheWriteTokens", number(usage, "cacheWrite"));
	input.insert("cacheWrite1hTokens", number(usage, "cacheWrite1h").unwrap_or(0.0));
	out.insert("inputTokenDetails", input);
	if let Some(reasoning) = number(usage, "reasoning") {
		out.insert("outputTokenDetails", json!({ "reasoningTokens": reasoning }));
	}
	Json::Obj(out)
}

/// Sums two counts where "neither reported" stays unreported.
fn add(a: Option<f64>, b: Option<f64>) -> Option<f64> {
	if a.is_none() && b.is_none() { None } else { Some(a.unwrap_or(0.0) + b.unwrap_or(0.0)) }
}

/// `accumulateJobUsage`: folds one model call's usage into the run's running total.
pub fn accumulate_job_usage(total: Option<&Json>, model: &str, step: &Json) -> Json {
	let details = &step["inputTokenDetails"];
	let mut call = Obj::new();
	put(&mut call, "inputTokens", number(step, "inputTokens"));
	put(&mut call, "outputTokens", number(step, "outputTokens"));
	put(&mut call, "cacheReadTokens", number(details, "cacheReadTokens"));
	put(&mut call, "cacheWriteTokens", number(details, "cacheWriteTokens"));
	put(&mut call, "cacheWrite1hTokens", number(details, "cacheWrite1hTokens"));
	put(&mut call, "reasoningTokens", number(&step["outputTokenDetails"], "reasoningTokens"));
	let call = Json::Obj(call);

	let before = |key: &str| total.and_then(|t| number(t, key));
	let unknown_split = |writes: Option<f64>, split: Option<f64>| writes.unwrap_or(0.0) > 0.0 && split.is_none();

	let mut out = Obj::new();
	out.insert("model", model);
	put(&mut out, "inputTokens", add(before("inputTokens"), number(step, "inputTokens")));
	put(&mut out, "outputTokens", add(before("outputTokens"), number(step, "outputTokens")));
	put(&mut out, "cacheReadTokens", add(before("cacheReadTokens"), number(details, "cacheReadTokens")));
	put(&mut out, "cacheWriteTokens", add(before("cacheWriteTokens"), number(details, "cacheWriteTokens")));
	put(&mut out, "reasoningTokens", add(before("reasoningTokens"), number(&step["outputTokenDetails"], "reasoningTokens")));
	let split = if unknown_split(before("cacheWriteTokens"), before("cacheWrite1hTokens")) || unknown_split(number(&call, "cacheWriteTokens"), number(&call, "cacheWrite1hTokens")) {
		None
	} else {
		add(before("cacheWrite1hTokens"), number(&call, "cacheWrite1hTokens"))
	};
	put(&mut out, "cacheWrite1hTokens", split);
	out.insert("steps", before("steps").unwrap_or(0.0) + 1.0);
	let calls = total.and_then(|t| t.get("calls"));
	if total.is_none() || calls.is_some_and(Json::truthy) {
		let mut all = calls.and_then(Json::as_arr).cloned().unwrap_or_default();
		all.push(call.clone());
		out.insert("calls", all);
	}
	out.insert("lastStep", call);
	Json::Obj(out)
}

/// `setSteerUiInverted`: the messages with one demo or visual steer's invert switch set; every
/// other message comes back as it was.
pub fn set_steer_ui_inverted(messages: &[Json], message_id: &str, inverted: bool) -> Vec<Json> {
	messages
		.iter()
		.map(|m| {
			let details = &m["details"];
			if m["id"].as_str() != Some(message_id) || !matches!(details["kind"].as_str(), Some("demo" | "visual")) {
				return m.clone();
			}
			let mut ui = details["ui"].as_obj().cloned().unwrap_or_default();
			ui.insert("inverted", inverted);
			let mut details = details.clone();
			details.as_obj_mut().expect("kind was read from an object").insert("ui", ui);
			let mut out = m.clone();
			out.as_obj_mut().expect("id was read from an object").insert("details", details);
			out
		})
		.collect()
}

/// Whether a job's result is the failure shape (nothing built, or a failure brief).
pub fn is_subagent_failure(kind: &str, result: &Json) -> bool {
	let failed_brief = |prefix: &str| Re::new(&format!("^{prefix}"), "i").test(&field_text(result, "brief"));
	let empty = |key: &str| result[key].as_str().is_none_or(str::is_empty);
	match kind {
		"research" => result["sources"].as_arr().is_some_and(Vec::is_empty) && failed_brief("Research failed:"),
		"demo" => empty("html"),
		"pdf" => failed_brief("PDF failed:"),
		_ => empty("svg"),
	}
}

/// `notes ?? fallback` printed.
fn notes_or(result: &Json, fallback: &str) -> String {
	match result.get("notes") {
		None | Some(Json::Null) => fallback.to_owned(),
		notes => js_string(notes),
	}
}

/// The model-facing text of a steer: what the result is and what to do with it.
fn steer_text(kind: &str, result: &Json) -> String {
	let brief = field_text(result, "brief");
	if is_subagent_failure(kind, result) {
		return match kind {
			"research" => format!("{brief}\n\nContinue with what you can establish and flag the uncertainty to the learner."),
			"demo" => format!("The demo \"{}\" could not be built: {}. Fall back to explaining in prose; if the brief was the problem, re-call demo with a tighter one.", field_text(result, "title"), notes_or(result, "unknown reason")),
			"pdf" => format!("{brief}\n\nContinue with what you can establish from the session and flag the gap to the learner."),
			_ => format!("The figure could not be made: {}. Fall back to prose or mermaid, or re-call visual with a tighter brief.", notes_or(result, "unknown reason")),
		};
	}
	match kind {
		"research" => format!("Research complete \u{2014} the researcher's full brief follows. Weave it into the lesson and cite its sources when you use its findings:\n\n{brief}"),
		"pdf" => format!("PDF reading complete \u{2014} the reader's brief on \"{}\" follows, with page citations. Weave it into the lesson and cite pages when you use it:\n\n{brief}", field_text(result, "path")),
		"demo" => format!("The demo \"{}\" is built, headlessly tested, and rendered in the lesson. Builder notes: {}.\nTeach with it \u{2014} reference its controls by name and point the learner at what to try.", field_text(result, "title"), notes_or(result, "(none)")),
		_ => format!("The figure is drawn, verified by inspection, and rendered in the lesson. Maker notes: {}.\nReference its elements as you teach.", notes_or(result, "(none)")),
	}
}

/// What the teacher reads when the learner aborted a job.
fn abort_text(kind: &str) -> &'static str {
	match kind {
		"research" => "Research aborted \u{2014} the learner aborted the research job, so no brief is coming. Acknowledge it in one line and continue teaching without it (or offer to re-dispatch it).",
		"demo" => "The demo job was aborted by the learner \u{2014} no demo is coming. Acknowledge it in one line and teach the topic in prose instead (a re-dispatch is fine if the learner wants it).",
		"pdf" => "The PDF reading job was aborted by the learner \u{2014} no brief is coming. Acknowledge it in one line and continue without it (a re-dispatch is fine if the learner wants it).",
		_ => "The figure job was aborted by the learner \u{2014} no figure is coming. Acknowledge it in one line and teach without it (a re-dispatch is fine if the learner wants it).",
	}
}

/// A job field kept only when the job has it.
fn put_field(out: &mut Obj, job: &Json, key: &str) {
	if let Some(v) = job.get(key) {
		out.insert(key, v.clone());
	}
}

/// The steer for a finished job. Its id is per job (`steer_<jobId>`), so a second delivery is
/// recognized by `steer_delivered`.
pub fn build_subagent_steer(job: &Json, result: &Json) -> Json {
	let kind = job["kind"].as_str().unwrap_or_default();
	let mut details = Obj::new();
	if let Some(id) = job.get("id") {
		details.insert("jobId", id.clone());
	}
	put_field(&mut details, job, "kind");
	put_field(&mut details, job, "toolCallId");
	details.insert("result", result.clone());
	json!({
		"id": format!("steer_{}", field_text(job, "id")),
		"role": "custom",
		"customType": "subagent-steer",
		"content": steer_text(kind, result),
		"display": true,
		"details": Json::Obj(details),
		"timestamp": clock::now_ms(),
	})
}

/// The steer for an aborted job, in the same id space as the result steer so exactly one lands.
pub fn build_abort_steer(job: &Json) -> Json {
	let kind = job["kind"].as_str().unwrap_or_default();
	let mut details = Obj::new();
	if let Some(id) = job.get("id") {
		details.insert("jobId", id.clone());
	}
	put_field(&mut details, job, "kind");
	put_field(&mut details, job, "toolCallId");
	details.insert("aborted", true);
	json!({
		"id": format!("steer_{}", field_text(job, "id")),
		"role": "custom",
		"customType": "subagent-abort",
		"content": abort_text(kind),
		"display": true,
		"details": Json::Obj(details),
		"timestamp": clock::now_ms(),
	})
}

/// Whether the transcript already carries this steer.
pub fn steer_delivered(messages: &[Json], steer_id: &str) -> bool {
	messages.iter().any(|m| m["id"].as_str() == Some(steer_id))
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;

	#[test]
	fn usage_folds_and_keeps_unreported_fields_absent() {
		let step = pi_usage_to_step(&json!({ "input": 10, "output": 5, "cacheRead": 0, "cacheWrite": 0 }));
		assert_eq!(stringify(&step), r#"{"inputTokens":10,"outputTokens":5,"inputTokenDetails":{"cacheReadTokens":0,"cacheWriteTokens":0,"cacheWrite1hTokens":0}}"#);
		let first = accumulate_job_usage(None, "agent:x", &step);
		let second = accumulate_job_usage(Some(&first), "agent:x", &step);
		assert_eq!(second["inputTokens"].as_f64(), Some(20.0));
		assert_eq!(second["steps"].as_f64(), Some(2.0));
		assert_eq!(second["calls"].as_arr().map(Vec::len), Some(2));
		assert!(second.get("reasoningTokens").is_none());
	}

	#[test]
	fn a_write_without_the_one_hour_split_stays_unknown() {
		let step = json!({ "inputTokens": 1, "inputTokenDetails": { "cacheWriteTokens": 4 } });
		let out = accumulate_job_usage(None, "m", &step);
		assert!(out.get("cacheWrite1hTokens").is_none());
		assert_eq!(out["cacheWriteTokens"].as_f64(), Some(4.0));
	}

	#[test]
	fn steers_say_what_to_do_and_flip_the_invert_switch() {
		let job = json!({ "id": "j1", "kind": "demo", "toolCallId": "c1" });
		let ok = build_subagent_steer(&job, &json!({ "title": "T", "html": "<p/>", "notes": null }));
		assert_eq!(ok["id"].as_str(), Some("steer_j1"));
		assert!(ok["content"].as_str().unwrap().contains("Builder notes: (none)."));
		let failed = build_subagent_steer(&job, &json!({ "title": "T", "html": "" }));
		assert!(failed["content"].as_str().unwrap().starts_with("The demo \"T\" could not be built: unknown reason."));
		assert_eq!(build_abort_steer(&job)["details"]["aborted"], Json::Bool(true));
		assert!(steer_delivered(std::slice::from_ref(&ok), "steer_j1"));
		let flipped = set_steer_ui_inverted(&[ok, json!({ "id": "x" })], "steer_j1", true);
		assert_eq!(flipped[0]["details"]["ui"]["inverted"], Json::Bool(true));
		assert!(flipped[1]["details"].is_null());
		assert!(is_subagent_failure("research", &json!({ "sources": [], "brief": "research failed: no" })));
	}
}

//! Parity with Node for the lesson-record rules (tests/golden/messages.json, made by
//! scripts/golden.ts from messages.golden.ts). Ids and clock stamps the constructors make are
//! masked the same way on both sides.

use std::collections::HashSet;

use gs_core::messages::attachments::{attachment_refusal, base64_bytes, content_text, keeps_png, pdf_file_name, pdf_note, pdf_note_of};
use gs_core::messages::input_events::{ChatInput, DismissInput, dismiss_appends, input_appends, parse_chat_input, parse_dismiss_input, parse_user_steer_input};
use gs_core::messages::native_messages::{
	active_problem_of, space_card_text, space_files_text, concluded_by_dismissal_pair, dangling_question_of, ends_in_dismissal, failed_output_call_ids, has_probe_done, is_side_turn, new_answer_result, new_app_request_message,
	new_space_context_message, new_graph_context_message, new_handoff_message, new_next_message, new_plan_block_message, new_problem_dismissed_marker, new_side_question, new_study_context_message,
	new_today_context_message, new_user_message, new_user_steer, pending_problem_dismissal_of, problem_input_for_conclude, retry_context, send_to_user_text, side_held_questions,
	to_llm_messages, user_facing_text_of,
};
use gs_core::messages::phases::{Phase3, first_phase, phase_at3_lh};
use gs_json::{Json, Obj, json, parse, stringify};

fn golden(case: &str) -> Json {
	let all = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/messages.json")).unwrap()).unwrap();
	let found = all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(case)).unwrap_or_else(|| panic!("no golden case {case}"));
	assert!(found.get("error").is_none(), "{case}: {:?}", found["error"]);
	found["output"].clone()
}

/// Same masking as `norm` in messages.golden.ts.
fn norm(value: &Json) -> Json {
	match value {
		Json::Arr(items) => items.iter().map(norm).collect(),
		Json::Obj(o) => Json::Obj(
			o.iter()
				.map(|(key, v)| {
					let masked = match (key.as_str(), v) {
						("timestamp", Json::Num(_)) => Json::from(0),
						("id", Json::Str(id)) if is_generated_id(id) => Json::from("<id>"),
						_ => norm(v),
					};
					(key.clone(), masked)
				})
				.collect::<Obj>(),
		),
		other => other.clone(),
	}
}

/// `^(msg|pb)_[0-9a-z]+_[0-9a-f]{8}$`
fn is_generated_id(id: &str) -> bool {
	let parts: Vec<&str> = id.split('_').collect();
	let [prefix, stamp, rand] = parts[..] else { return false };
	matches!(prefix, "msg" | "pb") && !stamp.is_empty() && stamp.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase()) && rand.len() == 8 && rand.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn same(got: &Json, want: &Json, what: &str) {
	let (got, want) = (stringify(got), stringify(want));
	assert_eq!(got, want, "{what}");
}

fn strs<S: AsRef<str>>(items: impl IntoIterator<Item = S>) -> Json {
	items.into_iter().map(|s| Json::from(s.as_ref())).collect()
}

fn opt<T: Into<Json>>(v: Option<T>) -> Json {
	v.map_or(Json::Null, Into::into)
}

fn arr(v: &Json) -> &[Json] {
	v.as_arr().unwrap().as_slice()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

#[test]
fn folds_match_node() {
	for case in arr(&golden("folds over saved lessons")) {
		let name = s(&case["name"]);
		let messages = arr(&case["messages"]);
		let active = active_problem_of(messages).map(|a| json!({ "toolCallId": a.tool_call_id, "input": a.input }));
		let dangling = dangling_question_of(messages).map(|d| json!({ "toolCallId": d.tool_call_id, "tool": d.tool, "input": d.input }));
		let check = |field: &str, got: Json| same(&got, &case[field], &format!("{name}: {field}"));
		check("active", opt(active));
		check("dangling", opt(dangling));
		check("endsInDismissal", ends_in_dismissal(messages).into());
		check("hasProbeDone", has_probe_done(messages).into());
		check("pendingDismissal", opt(pending_problem_dismissal_of(messages)));
		check("retry", retry_context(messages).iter().map(|m| opt(m["id"].as_str())).collect());
		check("phases", strs([Phase3::Probe, Phase3::Plan, Phase3::Teach].map(|start| phase_at3_lh(messages, start).as_str())));
		let mut failed: Vec<String> = failed_output_call_ids(messages).into_iter().collect();
		failed.sort();
		check("failed", strs(failed));
		check("sideTurn", is_side_turn(messages).into());
		let mut held: Vec<_> = side_held_questions(messages).into_iter().collect();
		held.sort_by(|a, b| a.0.cmp(&b.0));
		check("held", held.into_iter().map(|(id, h)| json!([id, { "callAt": h.call_at, "sideAt": h.side_at }])).collect());
		let conclude_ids = messages.iter().filter(|m| m["role"].as_str() == Some("assistant")).flat_map(|m| arr(&m["content"])).filter(|b| b["type"].as_str() == Some("toolCall") && b["name"].as_str() == Some("conclude")).map(|b| s(&b["id"]));
		check("concludeInputs", conclude_ids.map(|id| opt(problem_input_for_conclude(messages, id))).collect());
		check("missingConclude", opt(problem_input_for_conclude(messages, "nope")));
		check("llm", to_llm_messages(messages).into_iter().collect());
	}
}

#[test]
fn first_phase_matches_node() {
	for case in arr(&golden("first phase")) {
		assert_eq!(first_phase(case["kind"].as_str()).as_str(), s(&case["phase"]), "{:?}", case["kind"]);
	}
}

#[test]
fn text_for_the_learner_matches_node() {
	for case in arr(&golden("user facing text")) {
		let content = &case["content"];
		same(&strs(user_facing_text_of(content, None)), &case["all"], "all");
		let failed: HashSet<String> = HashSet::from(["s2".to_owned()]);
		same(&strs(user_facing_text_of(content, Some(&failed))), &case["failed"], "failed");
	}
	for case in arr(&golden("send to user text")) {
		same(&opt(send_to_user_text(&case["block"])), &case["text"], &stringify(&case["block"]));
	}
}

#[test]
fn constructors_match_node() {
	let image = json!({ "type": "image", "data": "QUJD", "mimeType": "image/png" });
	let pdf = json!({ "type": "text", "text": "[Attached PDF]" });
	let built = |name: &str| -> Json {
		match name {
			"user" => new_user_message("hello", &[]),
			"user with files" => new_user_message("hello", &[pdf.clone(), image.clone()]),
			"side" => new_side_question("why?", &[]),
			"side with files" => new_side_question("why?", std::slice::from_ref(&image)),
			"steer" => new_user_steer("keep going", "steer_1"),
			"answer" => new_answer_result("q1", "quiz", &json!({ "kind": "quiz", "picked": 2 }), &[]),
			"answer with files" => new_answer_result("q1", "explain", &json!({ "kind": "explain", "text": "t" }), std::slice::from_ref(&image)),
			"handoff" => new_handoff_message("chat_abc"),
			"plan block" => new_plan_block_message("plan_1", json!({ "steps": ["a"] })),
			"today" => new_today_context_message("[Today] Tuesday", "2026-11-10"),
			"app request" => new_app_request_message("Add the deadlines", vec![json!({ "id": "d1", "title": "Quiz" })]),
			"next" => new_next_message(),
			"dismissed marker" => new_problem_dismissed_marker("p1"),
			"dismissal pair" => concluded_by_dismissal_pair("p1").into_iter().collect(),
			other => panic!("no constructor for {other}"),
		}
	};
	let cases = golden("new messages");
	assert_eq!(arr(&cases).len(), 14);
	for case in arr(&cases) {
		same(&norm(&built(s(&case["name"]))), &case["built"], s(&case["name"]));
	}
}

#[test]
fn context_cards_match_node() {
	for case in arr(&golden("context cards")) {
		if case.get("card").is_some() {
			same(&Json::from(space_card_text(&case["card"])), &case["text"], &stringify(&case["card"]));
			same(&Json::from(space_files_text(&case["card"])), &case["files"], &stringify(&case["card"]));
			same(&norm(&new_space_context_message(&case["card"])), &case["message"], "space card");
		} else if case.get("picks").is_some() {
			let chains: Vec<String> = arr(&case["chains"]).iter().map(|c| s(c).to_owned()).collect();
			same(&norm(&new_graph_context_message(arr(&case["picks"]), &chains)), &case["message"], "graph card");
		} else {
			same(&norm(&new_study_context_message("[Study] topics", "study-context")), &case["study"], "study card");
			same(&norm(&new_study_context_message("[Homework] problems", "homework-context")), &case["homework"], "homework card");
		}
	}
}

fn files_json(files: &Option<Vec<gs_core::messages::attachments::ChatAttachment>>) -> Option<Json> {
	files.as_ref().map(|files| files.iter().map(|f| json!({ "name": f.name, "mimeType": f.mime_type, "data": f.data })).collect())
}

fn with_files(mut event: Obj, files: &Option<Vec<gs_core::messages::attachments::ChatAttachment>>) -> Json {
	if let Some(files) = files_json(files) {
		event.insert("attachments", files);
	}
	Json::Obj(event)
}

fn event(kind: &str, fields: Vec<(&str, Json)>) -> Obj {
	std::iter::once(("type", Json::from(kind))).chain(fields).map(|(k, v)| (k.to_owned(), v)).collect()
}

fn chat_input_json(input: &ChatInput) -> Json {
	match input {
		ChatInput::Text { text, attachments } => with_files(event("text", vec![("text", text.as_str().into())]), attachments),
		ChatInput::Answer { tool_call_id, answer, attachments } => with_files(event("answer", vec![("toolCallId", tool_call_id.as_str().into()), ("answer", answer.clone())]), attachments),
		ChatInput::Continue => Json::Obj(event("continue", vec![])),
		ChatInput::Side { text, attachments } => with_files(event("side", vec![("text", text.as_str().into())]), attachments),
		ChatInput::Next => Json::Obj(event("next", vec![])),
	}
}

/// `{ ok: value }` or `{ error: message }`, as the spec's `outcome` writes it.
fn outcome<T, E: std::fmt::Display>(result: Result<T, E>, show: impl FnOnce(&T) -> Json) -> Json {
	match result {
		Ok(v) => json!({ "ok": show(&v) }),
		Err(e) => json!({ "error": e.to_string() }),
	}
}

#[test]
fn input_events_match_node() {
	for case in arr(&golden("chat inputs")) {
		let got = outcome(parse_chat_input(&case["raw"]), chat_input_json);
		same(&got, &Json::Obj(event_pick(case)), &stringify(&case["raw"]));
	}
	for case in arr(&golden("dismiss inputs")) {
		let got = outcome(parse_dismiss_input(&case["raw"]), |d| match d {
			DismissInput::Dismiss { tool_call_id, answer } => json!({ "type": "dismiss", "toolCallId": tool_call_id, "answer": answer }),
			DismissInput::DismissProblem { problem_call_id } => json!({ "type": "dismiss-problem", "problemCallId": problem_call_id }),
		});
		same(&got, &Json::Obj(event_pick(case)), &stringify(&case["raw"]));
	}
	for case in arr(&golden("steer inputs")) {
		let got = outcome(parse_user_steer_input(&case["raw"]), |i| json!({ "type": "steer", "id": i.id, "text": i.text }));
		same(&got, &Json::Obj(event_pick(case)), &stringify(&case["raw"]));
	}
}

/// The `ok` or `error` field of a case.
fn event_pick(case: &Json) -> Obj {
	["ok", "error"].iter().filter_map(|k| case.get(k).map(|v| ((*k).to_owned(), v.clone()))).collect()
}

#[test]
fn appends_match_node() {
	let output = golden("appends for inputs");
	let records = &output["records"];
	let cases = arr(&output["cases"]);
	assert!(cases.len() > 100, "{} cases", cases.len());
	for case in cases {
		let record = &records[s(&case["record"])];
		let got = if let Some(raw) = case.get("dismiss") {
			let parsed = parse_dismiss_input(raw).unwrap();
			outcome(dismiss_appends(record, &parsed), |a| norm(&a.iter().cloned().collect()))
		} else {
			let parsed = parse_chat_input(&case["input"]).unwrap();
			outcome(input_appends(record, &parsed, arr(&case["stored"])), |a| norm(&a.iter().cloned().collect()))
		};
		same(&got, &Json::Obj(event_pick(case)), &format!("{} {}", s(&case["record"]), stringify(case.get("input").unwrap_or(&case["dismiss"]))));
	}
}

#[test]
fn attachment_rules_match_node() {
	let rules = golden("attachment rules");
	for c in arr(&rules["refusals"]) {
		same(&opt(attachment_refusal(s(&c["name"]), s(&c["type"]), c["size"].as_f64().unwrap() as u64)), &c["refusal"], &stringify(c));
	}
	for c in arr(&rules["base64"]) {
		assert_eq!(base64_bytes(s(&c["data"])) as f64, c["bytes"].as_f64().unwrap(), "{:?}", c["data"]);
	}
	for c in arr(&rules["png"]) {
		let bytes = c["pngBytes"].as_f64().unwrap() as u64;
		assert_eq!(keeps_png(c["transparent"].truthy(), c["sourcePng"].truthy(), bytes), c["keeps"].truthy(), "{c:?}");
	}
	for c in arr(&rules["pdfNames"]) {
		assert_eq!(pdf_file_name(s(&c["name"]), s(&c["hash"])), s(&c["file"]), "{c:?}");
	}
	for c in arr(&rules["notes"]) {
		let note = pdf_note(s(&c["name"]), s(&c["path"]));
		same(&note, &c["note"], "note");
		let back = pdf_note_of(s(&note["text"])).map(|(name, path)| json!({ "name": name, "path": path }));
		same(&opt(back), &c["back"], "note back");
	}
	for c in arr(&rules["notesBack"]) {
		let back = pdf_note_of(s(&c["t"])).map(|(name, path)| json!({ "name": name, "path": path }));
		same(&opt(back), &c["back"], &stringify(&c["t"]));
	}
	for c in arr(&rules["contentText"]) {
		assert_eq!(content_text(&c["content"]), s(&c["text"]), "{:?}", c["content"]);
	}
}

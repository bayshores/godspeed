//! Parity with Node for the session logic (tests/golden/session.json, made by scripts/golden.ts
//! from session.golden.ts in America/Los_Angeles and en-US). Every case lists its inputs beside
//! the answer; the real-chat case recomputes everything from tests/fixtures/session_chats.json.
//! Ids and clock stamps the constructors make are masked the same way on both sides.

use gs_base::text;
use gs_core::session::argument_heal::heal_encoded_arguments;
use gs_core::session::code_question::{fenced_code, write_code_input_problems, write_code_input_schema};
use gs_core::session::compaction::{
	ContextTokenEstimate, KEEP_RECENT_TOKENS, build_compaction_prompt, calculate_context_tokens, compaction_cut_index, compaction_span, effective_threshold_tokens, estimate_context_tokens,
	estimate_message_tokens, estimate_tokens, local_summary, new_compaction_marker, plan_tree_to_text, serialize_for_summary,
};
use gs_core::session::cost_summary::graph_cost_summary;
use gs_core::session::jobs::{accumulate_job_usage, build_abort_steer, build_subagent_steer, is_subagent_failure, pi_usage_to_step, set_steer_ui_inverted, steer_delivered};
use gs_core::session::plan::{derive_plan_statuses_lh, derived_node_status};
use gs_core::session::plan_blocks::plan_blocks_for;
use gs_core::session::plan_step_bar::{plan_position_lh, step_position};
use gs_core::session::plan_tree::create_tree;
use gs_core::session::practice_outcomes::practice_outcomes;
use gs_core::session::prices::{CallUsage, is_subscription_model, session_cost, subscription_labels, sum_steps};
use gs_core::session::probe::{PROBE_DONE_ACK_TEXT, probe_done_input_schema};
use gs_core::session::question_core::{
	ask_input_schema, ask_option_problems, coerce_correct_answer, compact_answer_for_model, confidence_level, explain_input_base, explain_input_object, explain_input_problems, level_percent,
	parse_options_if_string, probe_quiz_input_schema, quiz_input_object, quiz_input_problems,
};
use gs_core::session::session_markdown::session_markdown;
use gs_core::session::tool_switches::{TOGGLEABLE_TOOLS, WRITABLE_TOOL_KEYS, filter_enabled_tools, switched_off_tools_note};
use gs_core::session::work_pages::{WORK_PAGE_BYTES, page_blocks, split_pages};
use gs_json::{Json, Obj, json, parse, stringify};

fn golden(case: &str) -> Json {
	let all = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/session.json")).unwrap()).unwrap();
	let found = all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(case)).unwrap_or_else(|| panic!("no golden case {case}"));
	assert!(found.get("error").is_none(), "{case}: {:?}", found["error"]);
	found["output"].clone()
}

fn fixture_chats() -> Vec<Json> {
	let all = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/session_chats.json")).unwrap()).unwrap();
	all["chats"].as_arr().unwrap().clone()
}

fn arr(v: &Json) -> &[Json] {
	v.as_arr().unwrap().as_slice()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

fn strs(v: &Json) -> Vec<String> {
	arr(v).iter().map(|x| s(x).to_owned()).collect()
}

/// A JSON null reads as no value, like the `undefined` it came from.
fn present(v: &Json) -> Option<&Json> {
	Some(v).filter(|v| !v.is_null())
}

fn short(text: &str) -> String {
	text.chars().take(300).collect()
}

fn same(got: &Json, want: &Json, what: &str) {
	assert_eq!(stringify(got), stringify(want), "{what}");
}

/// Runs `run` on the `input` of every `{input, output}` case and compares with its `output`.
fn each(cases: &Json, what: &str, run: impl Fn(&Json) -> Json) {
	let cases = arr(cases);
	assert!(!cases.is_empty(), "{what}: no cases");
	for case in cases {
		same(&run(&case["input"]), &case["output"], &format!("{what}: {}", short(&stringify(&case["input"]))));
	}
}

/// `^(msg|pb)_[0-9a-z]+_[0-9a-f]{8}$`
fn is_generated_id(id: &str) -> bool {
	let parts: Vec<&str> = id.split('_').collect();
	let [prefix, stamp, rand] = parts[..] else { return false };
	matches!(prefix, "msg" | "pb") && !stamp.is_empty() && stamp.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_lowercase()) && rand.len() == 8 && rand.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Same masking as `maskMarker` in session.golden.ts.
fn mask_marker(message: &Json) -> Json {
	let Some(object) = message.as_obj() else { return message.clone() };
	Json::Obj(
		object
			.iter()
			.map(|(key, v)| {
				let masked = match (key.as_str(), v) {
					("id", Json::Str(id)) if is_generated_id(id) => Json::from("<id>"),
					("timestamp", Json::Num(_)) => Json::from("<now>"),
					_ => v.clone(),
				};
				(key.clone(), masked)
			})
			.collect::<Obj>(),
	)
}

/// Same masking as `maskBlock` in session.golden.ts.
fn mask_block(message: &Json) -> Json {
	let mut out = mask_marker(message);
	if let Some(at) = out.get_mut("details").and_then(|d| d.get_mut("block")).and_then(|b| b.get_mut("at"))
		&& at.as_str().is_some()
	{
		*at = Json::from("<iso>");
	}
	out
}

fn context_json(e: &ContextTokenEstimate) -> Json {
	let mut out = Obj::new();
	out.insert("tokens", e.tokens);
	out.insert("usageTokens", e.usage_tokens);
	out.insert("trailingTokens", e.trailing_tokens);
	out.insert("lastUsageIndex", e.last_usage_index);
	Json::Obj(out)
}

fn object(fields: Vec<(&str, Json)>) -> Json {
	Json::Obj(fields.into_iter().collect::<Obj>())
}

fn check_chat(chat: &Json, want: &Json) {
	let id = s(&chat["id"]);
	let messages = arr(&chat["messages"]);
	let tree = chat.get("tree").and_then(present);
	let check = |field: &str, got: Json| same(&got, &want[field], &format!("chat {id}: {field}"));
	check("id", chat["id"].clone());
	check("messageTokens", messages.iter().map(estimate_message_tokens).collect());
	check("estimateTokens", estimate_tokens(messages).into());
	check("context", context_json(&estimate_context_tokens(messages)));
	check("cuts", [KEEP_RECENT_TOKENS, 5000.0, 1000.0, 100.0, 1.0, 0.0].iter().map(|keep| compaction_cut_index(messages, *keep)).collect());
	let serialized = serialize_for_summary(messages);
	let plan_text = plan_tree_to_text(tree, messages);
	check("serialized", serialized.clone().into());
	check("planText", plan_text.clone().into());
	let span = text::slice16(&serialized, 0, Some(300));
	check("prompts", ["teach", "practice", "probe", "talk"].iter().map(|kind| build_compaction_prompt(&span, plan_text.as_deref(), kind)).collect());
	check("markdown", session_markdown(messages, None).into());
	check("markdownTitled", text::slice16(&session_markdown(messages, chat["title"].as_str()), 0, Some(200)).into());
	check("outcomes", practice_outcomes(messages).into());
	check("position", tree.map(|t| plan_position_lh(t, messages)).into());
	let statuses = tree.map(|t| derive_plan_statuses_lh(t, messages));
	check("current", statuses.as_ref().and_then(|st| st.current.clone()).into());
	let node_statuses = match (tree, &statuses) {
		(Some(t), Some(st)) => arr(&t["nodes"]).iter().map(|n| derived_node_status(st, n["id"].as_str().unwrap_or_default())).collect(),
		_ => Json::Null,
	};
	check("nodeStatuses", node_statuses);
	check("cost", session_cost(chat));
	check("blocks", plan_blocks_for(&[], messages, tree, messages).iter().map(mask_block).collect());
	check("blocksAgain", plan_blocks_for(messages, messages, tree, messages).iter().map(mask_block).collect());
}

#[test]
fn real_chats_match_node() {
	let want = golden("chats");
	let chats = fixture_chats();
	assert_eq!(chats.len(), arr(&want).len());
	for (chat, want) in chats.iter().zip(arr(&want)) {
		check_chat(chat, want);
	}
}

#[test]
fn work_pages_match_node() {
	for case in arr(&golden("work pages: split")) {
		if let Some(value) = case.get("value") {
			assert_eq!(value.as_i64(), Some(WORK_PAGE_BYTES as i64));
			continue;
		}
		let lengths = |text: &str| -> Json { split_pages(text, WORK_PAGE_BYTES).iter().map(|p| text::len16(p)).collect() };
		if let Some(max) = case.get("max") {
			let max = max.as_i64().map_or(WORK_PAGE_BYTES, |m| m as usize);
			same(&split_pages(s(&case["text"]), max).into(), &case["pages"], &format!("split {} at {max}", short(&stringify(&case["text"]))));
			continue;
		}
		let big = match s(&case["text"]) {
			"huge ascii" => "x".repeat(100_000),
			"huge cjk" => "\u{6f22}".repeat(30_000),
			"huge lines" => "some words on a line\n".repeat(5000),
			other => panic!("unknown big case {other}"),
		};
		same(&lengths(&big), &case["pages"], s(&case["text"]));
	}
}

#[test]
fn work_page_blocks_match_node() {
	for case in arr(&golden("work pages: blocks")) {
		if let Some(label) = case["blocks"].as_str() {
			assert_eq!(label, "huge");
			let blocks = ["x".repeat(60_000), "tail".to_owned(), "\u{6f22}".repeat(20_000)];
			let lengths: Json = page_blocks(&blocks, WORK_PAGE_BYTES).iter().map(|page| page.iter().map(|b| text::len16(b)).collect::<Json>()).collect();
			same(&lengths, &case["pages"], "huge blocks");
			continue;
		}
		let max = case["max"].as_i64().map_or(WORK_PAGE_BYTES, |m| m as usize);
		same(&page_blocks(&strs(&case["blocks"]), max).into(), &case["pages"], &format!("blocks {} at {max}", short(&stringify(&case["blocks"]))));
	}
}

#[test]
fn compaction_thresholds_and_usage_match_node() {
	let case = golden("compaction: thresholds and usage");
	each(&case["thresholds"], "threshold", |i| effective_threshold_tokens(i[0].as_f64(), i[1].as_f64()).into());
	each(&case["usage"], "usage", |i| calculate_context_tokens(i).into());
}

#[test]
fn compaction_messages_match_node() {
	let case = golden("compaction: messages");
	let messages = arr(&case["messages"]);
	same(&messages.iter().map(estimate_message_tokens).collect(), &case["each"], "each message");
	same(&estimate_tokens(messages).into(), &case["total"], "total");
	each(&case["contexts"], "context", |i| context_json(&estimate_context_tokens(arr(i))));
}

#[test]
fn compaction_cuts_and_markers_match_node() {
	let case = golden("compaction: cut and marker");
	each(&case["cuts"], "cut", |i| {
		let list = arr(i);
		object(vec![
			("byKeep", [20_000.0, 1000.0, 250.0, 100.0, 10.0, 1.0, 0.0].iter().map(|keep| compaction_cut_index(list, *keep)).collect()),
			("byDefault", compaction_cut_index(list, KEEP_RECENT_TOKENS).into()),
		])
	});
	each(&case["markers"], "marker", |i| mask_marker(&new_compaction_marker(s(&i[0]), &i[1])));
}

#[test]
fn compaction_text_matches_node() {
	let case = golden("compaction: serialize and plan text");
	same(&serialize_for_summary(arr(&case["messages"])).into(), &case["serialized"], "serialized");
	same(&serialize_for_summary(&[]).into(), &case["empty"], "empty");
	each(&case["plans"], "plan text", |i| plan_tree_to_text(present(&i[0]), arr(&i[1])).into());
	each(&case["prompts"], "prompt", |i| build_compaction_prompt(s(&i["spanText"]), i["planTreeText"].as_str(), s(&i["kind"])).into());
}

#[test]
fn compaction_local_summary_and_span_match_node() {
	let case = golden("compaction: local summary and span");
	each(&case["summaries"], "local summary", |i| local_summary(arr(&i["span"]), i["priorSummary"].as_str(), i["planTreeText"].as_str()).into());
	each(&case["spans"], "span", |i| match compaction_span(arr(&i[0]), &i[1]) {
		Some(found) => object(vec![("span", found.span.to_vec().into()), ("priorSummary", found.prior_summary.map_or(Json::Null, Json::from))]),
		None => Json::Null,
	});
}

#[test]
fn plan_statuses_and_step_bar_match_node() {
	let case = golden("plan: derived statuses and step bar");
	let tree = &case["tree"];
	each(&case["runs"], "statuses", |i| {
		let messages = arr(i);
		let statuses = derive_plan_statuses_lh(tree, messages);
		object(vec![
			("current", statuses.current.clone().into()),
			("statuses", arr(&tree["nodes"]).iter().map(|n| derived_node_status(&statuses, s(&n["id"]))).collect()),
			("position", plan_position_lh(tree, messages)),
		])
	});
	each(&case["positions"], "position", |i| plan_position_lh(&i["tree"], arr(&i["messages"])));
	each(&case["stepPosition"], "step position", |i| step_position(&arr(i).iter().map(|x| s(&x["status"])).collect::<Vec<_>>()).into());
}

#[test]
fn plan_trees_match_node() {
	each(&golden("plan: tree"), "tree", |i| match create_tree(arr(&i[0]), arr(&i[1])) {
		Ok(tree) => object(vec![("tree", tree)]),
		Err(error) => object(vec![("error", error.into())]),
	});
}

#[test]
fn plan_blocks_match_node() {
	let case = golden("plan: blocks");
	let transcript = arr(&case["transcript"]);
	each(&case["blocks"], "plan blocks", |i| plan_blocks_for(arr(&i["record"]), arr(&i["fresh"]), i.get("tree").and_then(present), transcript).iter().map(mask_block).collect());
}

#[test]
fn practice_outcomes_match_node() {
	each(&golden("practice outcomes"), "outcomes", |i| practice_outcomes(arr(i)).into());
}

#[test]
fn session_markdown_matches_node() {
	each(&golden("session markdown"), "markdown", |i| {
		let messages = arr(i);
		object(vec![
			("plain", session_markdown(messages, None).into()),
			("titled", session_markdown(messages, Some("My lesson")).into()),
			("emptyTitle", session_markdown(messages, Some("")).into()),
		])
	});
}

#[test]
fn question_core_matches_node() {
	let case = golden("question core");
	each(&case["parseOptions"], "parse options", |i| parse_options_if_string(present(i)).into());
	each(&case["askProblems"], "ask options", |i| ask_option_problems(arr(i)).into());
	each(&case["coerce"], "coerce", |i| coerce_correct_answer(&i["answer"], &strs(&i["keys"])).into());
	each(&case["quizProblems"], "quiz problems", |i| quiz_input_problems(i).into());
	each(&case["explainProblems"], "explain problems", |i| explain_input_problems(&json!({ "correctAnswer": s(i) })).into());
	each(&case["compactAnswers"], "compact answer", compact_answer_for_model);
	each(&case["levels"], "level percent", |i| level_percent(i.as_i64().unwrap() as u8).into());
	each(&case["percents"], "confidence level", |i| u32::from(confidence_level(i.as_f64().unwrap())).into());
	let schemas = &case["schemas"];
	for (name, got) in [
		("quiz", quiz_input_object()),
		("probeQuiz", probe_quiz_input_schema()),
		("explainBase", explain_input_base()),
		("explain", explain_input_object()),
		("ask", ask_input_schema()),
		("writeCode", write_code_input_schema()),
		("probeDone", probe_done_input_schema()),
	] {
		same(&got, &schemas[name], &format!("schema {name}"));
	}
	assert_eq!(case["ack"].as_str(), Some(PROBE_DONE_ACK_TEXT));
}

#[test]
fn code_questions_match_node() {
	let case = golden("code question");
	each(&case["problems"], "write code problems", |i| write_code_input_problems(&json!({ "question": s(i) })).into());
	each(&case["fences"], "fences", |i| fenced_code(s(&i[0]), s(&i[1])).into());
}

#[test]
fn argument_heal_matches_node() {
	let case = golden("argument heal");
	each(&case["healed"], "heal", |i| heal_encoded_arguments(i, &case["schema"]));
	each(&case["bare"], "heal bare schema", |i| heal_encoded_arguments(&i[0], &i[1]));
}

#[test]
fn jobs_match_node() {
	let case = golden("jobs");
	each(&case["stepFromPi"], "pi usage", pi_usage_to_step);
	each(&case["folded"], "job usage", |i| {
		let mut total: Option<Json> = None;
		let mut trail = Vec::new();
		for (n, step) in arr(i).iter().enumerate() {
			let next = accumulate_job_usage(total.as_ref(), if n % 2 == 0 { "agent:x" } else { "agent:y" }, step);
			trail.push(next.clone());
			total = Some(next);
		}
		trail.into()
	});
	each(&case["failures"], "failure", |i| is_subagent_failure(s(&i[0]), &i[1]).into());
	each(&case["steers"], "steer", |i| mask_marker(&build_subagent_steer(&i["job"], &i["result"])));
	each(&case["aborts"], "abort", |i| mask_marker(&build_abort_steer(i)));
	each(&case["inverted"], "inverted", |i| set_steer_ui_inverted(arr(&i["messages"]), s(&i["id"]), i["flag"].as_bool().unwrap()).into());
	each(&case["delivered"], "delivered", |i| steer_delivered(&[json!({ "id": s(&i[0]) })], s(&i[1])).into());
}

#[test]
fn prices_match_node() {
	let case = golden("prices");
	each(&case["subscription"], "subscription", |i| is_subscription_model(i.as_str()).into());
	each(&case["labels"], "labels", |i| subscription_labels(&arr(i).iter().map(Json::as_str).collect::<Vec<_>>()).into());
	each(&case["sums"], "sum", |i| sum_steps(&arr(i).iter().map(CallUsage::from_json).collect::<Vec<_>>()).to_json());
	each(&case["costs"], "cost", session_cost);
}

#[test]
fn cost_summary_matches_node() {
	let case = golden("cost summary");
	each(&case["made"], "cost summary", graph_cost_summary);
	let chats: Vec<Json> = fixture_chats().iter().map(|c| object(vec![("title", c["title"].clone()), ("extractions", c.get("extractions").and_then(present).cloned().unwrap_or_else(|| Json::Arr(vec![])))])).collect();
	let input = object(vec![("chats", chats.into()), ("sources", Json::Arr(vec![]))]);
	same(&graph_cost_summary(&input), &case["seeded"], "seeded cost summary");
}

#[test]
fn tool_switches_match_node() {
	let case = golden("tool switches");
	same(&TOGGLEABLE_TOOLS.iter().copied().collect(), &case["toggleable"], "toggleable");
	same(&WRITABLE_TOOL_KEYS.iter().copied().collect(), &case["writable"], "writable");
	let tools = || ["research", "demo", "visual", "pdf", "quiz", "explain"].iter().zip(1_i64..).map(|(name, n)| ((*name).to_owned(), n)).collect::<Vec<_>>();
	each(&case["filtered"], "filter tools", |i| Json::Obj(filter_enabled_tools(tools(), present(i)).into_iter().collect::<Obj>()));
	each(&case["notes"], "switched off note", |i| {
		let carried = strs(&i["carried"]);
		switched_off_tools_note(i.get("enabled").and_then(present), &carried.iter().map(String::as_str).collect::<Vec<_>>()).into()
	});
}

//! Places to stop: the end of a Study topic and the end of a long problem (topic-end.ts). A stop
//! rides the result details of the call that made it (a conclude or topic_done); Keep going is a
//! UI-only marker naming that call; the next topic's opener rides topic_done. Everything here is
//! derived from the record. `lesson_stop` and `shown_openers` have twins in the window; both
//! copies replay tests/golden/topic_end.json.

use std::collections::{HashMap, HashSet};

use gs_base::time;
use gs_json::js_text::js_string;
use gs_json::{Json, Obj, json};

use super::items;
use crate::contracts::chat::TOPIC_DONE_TOOL;
use crate::messages::native_messages::{ActiveProblem, PRACTICE_CONCLUDE_TOOL, PRACTICE_PROBLEM_TOOL};
use crate::session::plan::derive_plan_statuses_lh;
use crate::session::plan_step_bar::ordered_plan_ids;

const MINUTE_MS: f64 = 60_000.0;
/// A longer gap between lesson events counts as this long.
const GAP_CAP_MS: f64 = 5.0 * MINUTE_MS;
/// A gap this long or longer starts a new sitting.
const SITTING_GAP_MS: f64 = 30.0 * MINUTE_MS;

/// A problem that took this many active minutes ends on a stop.
pub const LONG_PROBLEM_MINUTES: i64 = 25;

/// Active minutes over lesson event times (ms) up to `now_ms`: each gap counts at most 5 minutes,
/// and a gap of 30 minutes or more starts a new sitting, which counts from zero. The caller passes
/// the times since the last stop (its `at` first), so the count runs from the sitting start or the
/// last stop, whichever is later. Whole minutes, rounded down.
pub fn active_minutes(timestamps: &[f64], now_ms: f64) -> i64 {
	let mut points: Vec<f64> = timestamps.iter().copied().filter(|t| *t <= now_ms).collect();
	points.sort_by(f64::total_cmp);
	points.push(now_ms);
	let mut ms = 0.0;
	for pair in points.windows(2) {
		let gap = pair[1] - pair[0];
		ms = if gap >= SITTING_GAP_MS { 0.0 } else { ms + gap.min(GAP_CAP_MS) };
	}
	(ms / MINUTE_MS).floor() as i64
}

/// Whether Keep going came in a later sitting than its stop: a gap of 30 minutes or more somewhere
/// between the two (all times in ms).
pub fn resumed_after_stop(stop_at: f64, keep_going_at: f64, timestamps: &[f64]) -> bool {
	let mut between: Vec<f64> = timestamps.iter().copied().filter(|t| *t > stop_at && *t < keep_going_at).collect();
	between.sort_by(f64::total_cmp);
	let points: Vec<f64> = std::iter::once(stop_at).chain(between).chain(std::iter::once(keep_going_at)).collect();
	points.windows(2).any(|pair| pair[1] - pair[0] >= SITTING_GAP_MS)
}

/// The topic a study conclude finishes, or none: outcome solved, or solvedWithHints at rung R0, R1
/// or R2, on a problem that names its topic. `open_problem` is the problem it concludes.
pub fn ends_topic(conclude_args: &Json, open_problem: Option<&ActiveProblem>) -> Option<String> {
	let node_id = open_problem?.input["nodeId"].as_str().filter(|id| !id.is_empty())?;
	let ends = match conclude_args["outcome"].as_str() {
		Some("solved") => true,
		Some("solvedWithHints") => matches!(conclude_args["rung"].as_str(), Some("R0" | "R1" | "R2")),
		_ => false,
	};
	ends.then(|| node_id.to_owned())
}

/// The lesson's stop, or none when it never stopped (every lesson from before stops existed):
/// `{kind, at, nodeId, stopOf, next, activeMinutes, keptGoing}`. `kind` "end" is a topic stop with
/// no topic left. `next` is the next topic's title (Study topic stop), the current plan step's
/// title (Study problem stop), "problem {n}" (homework) or null (practice). `tree` is a Study
/// lesson's plan; `homework` is a homework lesson's problems (`{number, done}`), and with none
/// left undone there is no stop (the done bar shows instead).
pub fn lesson_stop(messages: &[Json], tree: Option<&Json>, homework: Option<&[Json]>) -> Option<Json> {
	let stops = record_stops(messages);
	let last = stops.last()?;
	let mut kind = last.stop["kind"].as_str().unwrap_or_default();
	let mut next = Json::Null;
	if let Some(homework) = homework {
		let open = homework.iter().find(|p| !p["done"].truthy())?;
		next = Json::from(format!("problem {}", js_string(open.get("number"))));
	} else if let Some(tree) = tree.filter(|t| !items(&t["nodes"]).is_empty()) {
		let node_id = last.stop["nodeId"].as_str();
		if let (Some(node_id), "topic") = (node_id, kind) {
			let ended: HashSet<&str> = stops.iter().filter(|s| s.stop["kind"].as_str() == Some("topic")).filter_map(|s| s.stop["nodeId"].as_str()).collect();
			match next_topic(tree, node_id, &ended) {
				Some(title) => next = title,
				None => kind = "end",
			}
		} else {
			let current = derive_plan_statuses_lh(tree, messages, &HashMap::new()).current;
			next = items(&tree["nodes"]).iter().find(|n| n["id"].as_str().is_some_and(|id| current.as_deref() == Some(id))).map_or(Json::Null, |n| n["title"].clone());
		}
	}
	let kept_going = keep_going_markers(messages).any(|(_, k)| k["stopOf"].as_str() == Some(last.stop_of));
	Some(json!({
		"kind": kind,
		"at": last.stop["at"].clone(),
		"nodeId": last.node_id.clone(),
		"stopOf": last.stop_of,
		"next": next,
		"activeMinutes": last.stop["activeMinutes"].clone(),
		"keptGoing": kept_going,
	}))
}

/// The first topic after `node_id` in learning order that has not ended, then the first one before
/// it (a topic left for later comes back before the session ends): its title, or none when every
/// topic has ended.
fn next_topic(tree: &Json, node_id: &str, ended: &HashSet<&str>) -> Option<Json> {
	let order = ordered_plan_ids(tree);
	let open = |id: &&str| *id != node_id && !ended.contains(id);
	let id = match order.iter().position(|id| *id == node_id) {
		Some(at) => order[at + 1..].iter().copied().find(open).or_else(|| order[..at].iter().copied().find(open)),
		None => order.iter().copied().find(open),
	}?;
	// A duplicated id resolves to its last node, as the learning order does.
	let title = &items(&tree["nodes"]).iter().rev().find(|n| n["id"].as_str() == Some(id))?["title"];
	(!title.is_null()).then(|| title.clone())
}

/// Whether the agent should get the [Resumed] line with the learner's next input: the newest stop
/// was kept going in a later sitting, and no input of his has reached the agent since that Keep
/// going.
pub fn resume_due(messages: &[Json]) -> bool {
	let Some(last) = record_stops(messages).pop() else { return false };
	let Some((index, keep)) = keep_going_markers(messages).find(|(_, k)| k["stopOf"].as_str() == Some(last.stop_of)) else { return false };
	let times: Vec<f64> = messages.iter().filter_map(|m| m["timestamp"].as_f64()).collect();
	if !resumed_after_stop(ms_of(&last.stop["at"]), ms_of(&keep["at"]), &times) {
		return false;
	}
	!messages[index + 1..].iter().any(is_learner_input)
}

/// `Date.parse`: NaN for text it cannot read, so every comparison with it is false.
fn ms_of(at: &Json) -> f64 {
	at.as_str().and_then(time::parse_date).map_or(f64::NAN, |ms| ms as f64)
}

/// A message that carries the learner's input to the agent.
fn is_learner_input(m: &Json) -> bool {
	match m["role"].as_str() {
		Some("user") => true,
		Some("custom") => matches!(m["customType"].as_str(), Some("practice-next" | "opener-answer" | "app-note")),
		_ => false,
	}
}

/// Every shown opener, by its topic_done call id: `{topicDoneCallId, lead?, quiz, answer?}`. An
/// opener shows once its topic_done is stored and its stop was kept going; `lead` is the lead as
/// topic_done's result stored it (marks checked), `quiz` the opener question's arguments, and
/// `answer` (`{answer, timestamp}`, a null answer is a skip) the first opener-answer for it.
pub fn shown_openers(messages: &[Json]) -> Obj {
	let mut out = Obj::new();
	let stops = record_stops(messages);
	let kept: HashSet<&str> = keep_going_markers(messages).filter_map(|(_, k)| k["stopOf"].as_str()).collect();
	let calls = call_args(messages);
	for (index, m) in messages.iter().enumerate() {
		let details = &m["details"];
		if m["role"].as_str() != Some("toolResult") || m["toolName"].as_str() != Some(TOPIC_DONE_TOOL) || m["isError"].truthy() || details["part"].as_str() != Some("topic_done") || details.as_obj().is_none() {
			continue;
		}
		let id = m["toolCallId"].as_str().unwrap_or_default();
		let args = calls.get(id).copied().unwrap_or(&Json::Null);
		let quiz = &args["opener"]["quiz"];
		if quiz.as_obj().is_none() {
			continue;
		}
		// Its stop: its own (a quiz ended the topic) or the conclude that ended it.
		let stop_of = if details["stop"].truthy() {
			Some(id)
		} else {
			stops.iter().rev().find(|s| s.index < index && s.stop["kind"].as_str() == Some("topic") && args["nodeId"].as_str().is_some_and(|n| s.stop["nodeId"].as_str() == Some(n))).map(|s| s.stop_of)
		};
		if !stop_of.is_some_and(|s| kept.contains(s)) {
			continue;
		}
		let mut opener = Obj::new();
		opener.insert("topicDoneCallId", id);
		if let Some(lead) = details["lead"].as_str() {
			opener.insert("lead", lead);
		}
		opener.insert("quiz", quiz.clone());
		out.insert(id, opener);
	}
	for m in messages.iter().filter(|m| m["role"].as_str() == Some("custom") && m["customType"].as_str() == Some("opener-answer")) {
		let details = &m["details"];
		let Some(opener) = details["topicDoneCallId"].as_str().and_then(|id| out.get_mut(id)).and_then(Json::as_obj_mut) else { continue };
		if !opener.contains_key("answer") {
			opener.insert("answer", json!({ "answer": details["answer"].clone(), "timestamp": m["timestamp"].clone() }));
		}
	}
	out
}

/// The node ids of shown openers' questions, by topic_done call id (the native plan position reads
/// them).
pub fn opener_nodes(messages: &[Json]) -> HashMap<String, String> {
	shown_openers(messages).iter().filter_map(|(id, opener)| opener["quiz"]["nodeId"].as_str().map(|node| (id.clone(), node.to_owned()))).collect()
}

/// A stop in the record and the call carrying it.
struct RecordStop<'a> {
	stop_of: &'a str,
	stop: &'a Json,
	node_id: Option<String>,
	/// The index of the result that carries it.
	index: usize,
}

/// Every stop in the record, in order: clean conclude and topic_done results whose details carry
/// one. A problem stop's topic is its problem's, when that names one.
fn record_stops(messages: &[Json]) -> Vec<RecordStop<'_>> {
	let calls = call_args(messages);
	let mut out = Vec::new();
	let mut problem_node: Option<String> = None;
	for (index, m) in messages.iter().enumerate() {
		if m["role"].as_str() != Some("toolResult") || m["isError"].truthy() {
			continue;
		}
		let id = m["toolCallId"].as_str().unwrap_or_default();
		match m["toolName"].as_str() {
			Some(PRACTICE_PROBLEM_TOOL) => {
				problem_node = calls.get(id).and_then(|args| args["nodeId"].as_str()).map(str::to_owned);
				continue;
			}
			Some(PRACTICE_CONCLUDE_TOOL | TOPIC_DONE_TOOL) => {}
			_ => continue,
		}
		if let Some(stop) = stop_in(m) {
			let node_id = if stop["kind"].as_str() == Some("topic") { stop["nodeId"].as_str().map(str::to_owned) } else { problem_node.clone() };
			out.push(RecordStop { stop_of: id, stop, node_id, index });
		}
		if m["toolName"].as_str() == Some(PRACTICE_CONCLUDE_TOOL) {
			problem_node = None;
		}
	}
	out
}

/// The stop a result's details carry, when well formed.
fn stop_in(result: &Json) -> Option<&Json> {
	let stop = &result["details"]["stop"];
	if stop.as_obj().is_none() || stop["at"].as_str().is_none() || stop["activeMinutes"].as_f64().is_none() {
		return None;
	}
	match stop["kind"].as_str() {
		Some("problem") => Some(stop),
		Some("topic") if stop["nodeId"].as_str().is_some() => Some(stop),
		_ => None,
	}
}

/// Every call's arguments, by call id (a reused id keeps its last call).
fn call_args(messages: &[Json]) -> HashMap<&str, &Json> {
	let mut out = HashMap::new();
	for m in messages.iter().filter(|m| m["role"].as_str() == Some("assistant")) {
		for block in m["content"].as_arr().into_iter().flatten().filter(|b| b["type"].as_str() == Some("toolCall")) {
			out.insert(block["id"].as_str().unwrap_or_default(), &block["arguments"]);
		}
	}
	out
}

/// The keep-going markers' details with their index, wherever they sit (one written during a turn
/// sits before that turn's messages).
fn keep_going_markers(messages: &[Json]) -> impl Iterator<Item = (usize, &Json)> {
	messages.iter().enumerate().filter(|(_, m)| m["role"].as_str() == Some("custom") && m["customType"].as_str() == Some("keep-going")).map(|(i, m)| (i, &m["details"]))
}

#[cfg(test)]
mod tests {
	use super::*;

	const T0: f64 = 1_795_035_600_000.0;

	fn at(minutes: f64) -> f64 {
		T0 + minutes * MINUTE_MS
	}

	fn iso(minutes: f64) -> String {
		time::iso(at(minutes) as i64)
	}

	#[test]
	fn active_minutes_add_the_gaps_each_at_most_5_minutes() {
		assert_eq!(active_minutes(&[at(0.0), at(3.0), at(10.0)], at(12.0)), 10);
		assert_eq!(active_minutes(&[at(0.0)], at(29.0)), 5);
	}

	#[test]
	fn a_gap_of_30_minutes_starts_a_new_sitting() {
		assert_eq!(active_minutes(&[at(0.0), at(4.0), at(34.0), at(36.0)], at(38.0)), 4);
		assert_eq!(active_minutes(&[at(0.0), at(4.0), at(33.0)], at(35.0)), 11, "29 minutes is one sitting: it counts 5");
	}

	#[test]
	fn active_minutes_count_from_the_first_time_and_round_down() {
		assert_eq!(active_minutes(&[at(100.0), at(104.0), at(108.0)], at(112.0)), 12);
		assert_eq!(active_minutes(&[at(0.0)], at(1.9)), 1);
		assert_eq!(active_minutes(&[at(0.0), at(50.0)], at(3.0)), 3, "times after now are ignored");
	}

	#[test]
	fn ends_topic_per_outcome_and_rung() {
		let open = ActiveProblem { tool_call_id: "p1".into(), input: json!({ "statement": "x", "nodeId": "reg" }) };
		assert_eq!(ends_topic(&json!({ "outcome": "solved", "rung": null }), Some(&open)).as_deref(), Some("reg"));
		for rung in ["R0", "R1", "R2"] {
			assert_eq!(ends_topic(&json!({ "outcome": "solvedWithHints", "rung": rung }), Some(&open)).as_deref(), Some("reg"), "{rung}");
		}
		for rung in [json!("R3"), json!("R4"), json!("R5"), Json::Null] {
			assert_eq!(ends_topic(&json!({ "outcome": "solvedWithHints", "rung": rung }), Some(&open)), None);
		}
		for outcome in ["movedOn", "surrendered", "dismissed"] {
			assert_eq!(ends_topic(&json!({ "outcome": outcome, "rung": null }), Some(&open)), None, "{outcome}");
		}
		assert_eq!(ends_topic(&json!({ "outcome": "solved" }), None), None);
		let unnamed = ActiveProblem { tool_call_id: "p1".into(), input: json!({ "statement": "x" }) };
		assert_eq!(ends_topic(&json!({ "outcome": "solved" }), Some(&unnamed)), None);
	}

	#[test]
	fn resumed_only_across_a_gap_of_30_minutes() {
		assert!(!resumed_after_stop(at(0.0), at(29.0), &[]));
		assert!(resumed_after_stop(at(0.0), at(30.0), &[]));
		assert!(!resumed_after_stop(at(0.0), at(50.0), &[at(20.0), at(40.0)]), "he kept working: one sitting");
		assert!(resumed_after_stop(at(0.0), at(90.0), &[at(20.0)]));
	}

	fn regularization_ends() -> Vec<Json> {
		vec![
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": { "nodeId": "reg" } }], "timestamp": at(30.0) }),
			json!({ "role": "toolResult", "toolCallId": "p1", "toolName": "problem", "details": null, "isError": false, "timestamp": at(30.0) }),
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved" } }], "timestamp": at(48.0) }),
			json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "details": { "stop": { "kind": "topic", "nodeId": "reg", "activeMinutes": 48, "at": iso(48.0) } }, "isError": false, "timestamp": at(48.0) }),
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "t1", "name": "topic_done", "arguments": { "nodeId": "reg", "opener": { "lead": "Now split the data.", "quiz": { "question": "?", "type": "predict", "nodeId": "cv" } } } }], "timestamp": at(49.0) }),
			json!({ "role": "toolResult", "toolCallId": "t1", "toolName": "topic_done", "details": { "part": "topic_done", "v": 1, "lead": "Now split the data." }, "isError": false, "timestamp": at(49.0) }),
		]
	}

	fn keep_going(minutes: f64) -> Json {
		json!({ "role": "custom", "customType": "keep-going", "content": "", "details": { "stopOf": "c1", "at": iso(minutes) }, "timestamp": at(minutes) })
	}

	fn marker(custom_type: &str, minutes: f64) -> Json {
		json!({ "role": "custom", "customType": custom_type, "content": "x", "details": { "topicDoneCallId": "t1", "answer": null }, "timestamp": at(minutes) })
	}

	#[test]
	fn resume_is_due_after_a_later_sitting_until_his_next_input() {
		let next_day = 24.0 * 60.0;
		let resumed = [regularization_ends(), vec![keep_going(next_day)]].concat();
		assert!(resume_due(&resumed));
		for input in [marker("opener-answer", next_day + 1.0), marker("practice-next", next_day + 1.0), marker("app-note", next_day + 1.0), json!({ "role": "user", "content": "why?", "timestamp": at(next_day + 1.0) })] {
			assert!(!resume_due(&[resumed.clone(), vec![input.clone()]].concat()), "{input:?}");
		}
		assert!(resume_due(&[resumed.clone(), vec![marker("today-context", next_day + 1.0)]].concat()), "not his input");
		assert!(!resume_due(&[regularization_ends(), vec![keep_going(50.0)]].concat()), "same sitting");
		assert!(!resume_due(&regularization_ends()), "not kept going");
		assert!(!resume_due(&[]));
	}

	#[test]
	fn a_shown_openers_question_tags_its_node() {
		assert!(opener_nodes(&regularization_ends()).is_empty());
		let shown = opener_nodes(&[regularization_ends(), vec![keep_going(50.0)]].concat());
		assert_eq!(shown, HashMap::from([("t1".to_owned(), "cv".to_owned())]));
	}
}

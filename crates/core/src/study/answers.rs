//! The graded answers of a lesson and the facts each one counts for (progress.ts: answers,
//! tallies). An answer is `{ chatId, messageId, contextMessageIds, toolCallId, tool, ... }`.

use std::collections::HashMap;

use gs_json::{Json, Obj};

use super::progress::{answer_outcome, is_answer_data};
use crate::messages::pending::{is_graded_tool, is_question_tool};
use crate::session::practice_outcomes::practice_outcomes;
use crate::session::question_core::{confidence_level, normalize_quiz_type};

/// How much a problem solved with hints counts toward a rate: one alone reads shaky, not strong.
pub const HINTED_WEIGHT: f64 = 0.6;

/// A practice outcome as an answer: solved is right, solved with hints is "hinted" (counted at
/// HINTED_WEIGHT), giving up or moving on is wrong.
fn practice_answer_outcome(outcome: &str) -> Option<&'static str> {
	match outcome {
		"solved" => Some("right"),
		"solvedWithHints" => Some("hinted"),
		"movedOn" | "surrendered" => Some("wrong"),
		_ => None,
	}
}

/// What a graded tool call asked, kept until its result arrives.
struct Call<'a> {
	message_id: &'a Json,
	context: Vec<&'a str>,
	tool: &'a str,
	args: &'a Json,
}

/// `a ?? b` over JSON values.
fn or_json(a: &Json, b: impl Into<Json>) -> Json {
	if a.is_null() { b.into() } else { a.clone() }
}

/// Every graded quiz/probe answer and question from earlier in one lesson (predictions aside), in
/// transcript order, then its practice problems' outcomes.
pub fn collect_answers(chat_id: &str, messages: &[Json]) -> Vec<Json> {
	let mut calls: HashMap<&str, Call> = HashMap::new();
	let mut out = Vec::new();
	// Assistant messages of the current turn, newest last (reset at a user message or a
	// question's answer, where a new turn starts).
	let mut turn: Vec<&str> = Vec::new();
	for m in messages {
		match m["role"].as_str() {
			Some("user") => turn.clear(),
			Some("assistant") => {
				for block in m["content"].as_arr().into_iter().flatten() {
					let (Some(id), Some(name)) = (block["id"].as_str().filter(|s| !s.is_empty()), block["name"].as_str().filter(|s| !s.is_empty())) else { continue };
					if block["type"].as_str() != Some("toolCall") || !is_graded_tool(name) {
						continue;
					}
					calls.insert(id, Call { message_id: &m["id"], context: turn.iter().rev().copied().collect(), tool: name, args: &block["arguments"] });
				}
				turn.push(m["id"].as_str().unwrap_or(""));
			}
			Some("custom") if m["customType"].as_str() == Some("review") => out.extend(review_answer(&m["details"])),
			Some("toolResult") => {
				// Any question's answer is the learner speaking: a new turn starts.
				if is_question_tool(m["toolName"].as_str().unwrap_or("")) {
					turn.clear();
				}
				let Some(call_id) = m["toolCallId"].as_str().filter(|s| !s.is_empty()) else { continue };
				let Some(call) = calls.get(call_id) else { continue };
				turn.clear();
				if !is_answer_data(&m["details"]) {
					continue;
				}
				if let Some(answer) = graded_answer(chat_id, call_id, call, &m["details"]) {
					out.push(answer);
				}
			}
			_ => {}
		}
	}
	for p in practice_outcomes(messages) {
		let Some(outcome) = p["outcome"].as_str().and_then(practice_answer_outcome) else { continue };
		let mut a = Obj::new();
		a.insert("chatId", chat_id);
		a.insert("messageId", p["messageId"].clone());
		a.insert("contextMessageIds", Json::Arr(vec![]));
		a.insert("toolCallId", p["problemCallId"].clone());
		a.insert("tool", "problem");
		if p["targets"].as_arr().is_some_and(|t| !t.is_empty()) {
			a.insert("factIds", p["targets"].clone());
		}
		if let Some(node_id) = p.get("nodeId") {
			a.insert("nodeId", node_id.clone());
		}
		a.insert("question", p["statement"].clone());
		a.insert("outcome", outcome);
		a.insert("answeredAt", p["at"].clone());
		out.push(Json::Obj(a));
	}
	out
}

/// A question from earlier as an answer: it names the quiz it was copied from (`of`), so it counts
/// for the facts made at that quiz's message, and the quiz's topic.
fn review_answer(details: &Json) -> Option<Json> {
	let answer = &details["answer"];
	let outcome = answer_outcome(answer)?;
	let of = &details["of"];
	let mut a = Obj::new();
	a.insert("chatId", or_json(&of["chatId"], ""));
	a.insert("messageId", of["messageId"].clone());
	a.insert("contextMessageIds", Json::Arr(vec![]));
	a.insert("toolCallId", or_json(&of["toolCallId"], ""));
	a.insert("tool", "review");
	if let Some(node_id) = details["nodeId"].as_str().filter(|s| !s.is_empty()) {
		a.insert("nodeId", node_id);
	}
	a.insert("question", details["quiz"]["question"].as_str().unwrap_or(""));
	a.insert("outcome", outcome);
	if let Some(c) = answer["confidence"].as_f64().filter(|_| outcome != "dontKnow") {
		a.insert("confidence", c);
		a.insert("level", u32::from(confidence_level(c)));
	}
	a.insert("answeredAt", or_json(&answer["answeredAt"], ""));
	Some(Json::Obj(a))
}

/// The answer a result `details` makes for its call, or None when it is not graded.
fn graded_answer(chat_id: &str, call_id: &str, call: &Call, ad: &Json) -> Option<Json> {
	let outcome = answer_outcome(ad)?;
	// A prediction is a guess at what hasn't been taught yet: no evidence either way.
	if normalize_quiz_type(&or_json(&ad["questionType"], call.args["type"].clone())) == Some("predict") {
		return None;
	}
	let node_id = call.args["nodeId"].as_str().filter(|s| !s.is_empty());
	let confidence = ad["confidence"].as_f64().filter(|_| outcome != "dontKnow");
	let mut a = Obj::new();
	a.insert("chatId", chat_id);
	a.insert("messageId", call.message_id.clone());
	a.insert("contextMessageIds", call.context.iter().copied().collect::<Json>());
	a.insert("toolCallId", call_id);
	a.insert("tool", or_json(&ad["tool"], call.tool));
	if let Some(node_id) = node_id {
		a.insert("nodeId", node_id);
	}
	a.insert("question", or_json(&ad["questionText"], call.args["question"].as_str().unwrap_or("")));
	a.insert("outcome", outcome);
	if let Some(c) = confidence {
		a.insert("confidence", c);
		a.insert("level", u32::from(confidence_level(c)));
	}
	a.insert("answeredAt", or_json(&ad["answeredAt"], ""));
	Some(Json::Obj(a))
}

fn point_key(chat_id: &str, message_id: &str) -> String {
	format!("{chat_id}\u{0}{message_id}")
}

/// (chatId, messageId) to the facts with a provenance point there.
pub fn facts_by_message(facts: &[Json]) -> HashMap<String, Vec<String>> {
	let mut index: HashMap<String, Vec<String>> = HashMap::new();
	for fact in facts {
		let Some(id) = fact["id"].as_str() else { continue };
		for p in super::items(&fact["provenance"]) {
			let Some(message_id) = p["messageId"].as_str().filter(|s| !s.is_empty()) else { continue };
			let list = index.entry(point_key(p["chatId"].as_str().unwrap_or(""), message_id)).or_default();
			if !list.iter().any(|f| f == id) {
				list.push(id.to_owned());
			}
		}
	}
	index
}

/// The facts an answer counts for: the ones it names itself; else those made from (or tested at)
/// the message that asked it; when that message has none, the nearest earlier teacher message
/// of the same turn that does.
pub fn facts_for_answer(answer: &Json, index: &HashMap<String, Vec<String>>) -> Vec<String> {
	let named = super::items(&answer["factIds"]);
	if !named.is_empty() {
		return named.iter().filter_map(|f| f.as_str().map(str::to_owned)).collect();
	}
	let chat_id = answer["chatId"].as_str().unwrap_or("");
	let asked = answer["messageId"].as_str().into_iter();
	let context = super::items(&answer["contextMessageIds"]).iter().filter_map(Json::as_str);
	for message_id in asked.chain(context) {
		if let Some(hit) = index.get(&point_key(chat_id, message_id)).filter(|h| !h.is_empty()) {
			return hit.clone();
		}
	}
	vec![]
}

/// A compact reference to one answer (what the UI's answer blocks need).
pub fn answer_ref(a: &Json) -> Json {
	let mut r = Obj::new();
	r.insert("chatId", a["chatId"].clone());
	r.insert("toolCallId", a["toolCallId"].clone());
	r.insert("outcome", a["outcome"].clone());
	if a["level"].truthy() {
		r.insert("level", a["level"].clone());
	}
	r.insert("answeredAt", a["answeredAt"].clone());
	Json::Obj(r)
}

/// The counts over graded answers and their right rate ("I don't know" counts as not right, a
/// problem solved with hints as HINTED_WEIGHT of a right one).
pub struct Tally {
	pub answered: usize,
	pub right: usize,
	pub hinted: usize,
	pub wrong: usize,
	pub dont_know: usize,
	pub rate: Option<f64>,
}

impl Tally {
	pub fn of<'a>(answers: impl IntoIterator<Item = &'a Json>) -> Tally {
		let (mut right, mut hinted, mut wrong, mut dont_know) = (0, 0, 0, 0);
		for a in answers {
			match a["outcome"].as_str() {
				Some("right") => right += 1,
				Some("hinted") => hinted += 1,
				Some("wrong") => wrong += 1,
				_ => dont_know += 1,
			}
		}
		let answered = right + hinted + wrong + dont_know;
		let rate = (answered > 0).then(|| (right as f64 + HINTED_WEIGHT * hinted as f64) / answered as f64);
		Tally { answered, right, hinted, wrong, dont_know, rate }
	}

	/// The tally keys, in the order the payload shows them; `hinted` only when there are some.
	pub fn insert_into(&self, o: &mut Obj) {
		o.insert("answered", self.answered);
		o.insert("right", self.right);
		if self.hinted > 0 {
			o.insert("hinted", self.hinted);
		}
		o.insert("wrong", self.wrong);
		o.insert("dontKnow", self.dont_know);
		o.insert("rate", self.rate);
	}

	pub fn to_json(&self) -> Json {
		let mut o = Obj::new();
		self.insert_into(&mut o);
		Json::Obj(o)
	}
}

/// Overconfident: at least 2 answers given at level 4-5, right less often than those answers
/// claimed (each answer claims level x 20 %).
pub fn is_overconfident(answers: &[&Json]) -> bool {
	let sure: Vec<(&Json, i64)> = answers.iter().filter(|a| a["outcome"].as_str() != Some("dontKnow")).filter_map(|a| a["level"].as_i64().filter(|&l| l >= 4).map(|l| (*a, l))).collect();
	if sure.len() < 2 {
		return false;
	}
	let right = sure.iter().filter(|(a, _)| a["outcome"].as_str() == Some("right")).count();
	let claimed = sure.iter().map(|(_, l)| (l * 20) as f64).sum::<f64>() / sure.len() as f64 / 100.0;
	(right as f64 / sure.len() as f64) < claimed
}

#[cfg(test)]
mod tests {
	use gs_json::{json, stringify};

	use super::*;

	#[test]
	fn overconfident_needs_two_sure_answers_below_their_claim() {
		let a = |o: &str, l: i64| json!({ "outcome": o, "level": l });
		let (r5, w5, w4, r2, dk) = (a("right", 5), a("wrong", 5), a("wrong", 4), a("right", 2), a("dontKnow", 5));
		assert!(is_overconfident(&[&r5, &w5]));
		assert!(!is_overconfident(&[&r5, &r5]));
		assert!(!is_overconfident(&[&w5, &r2]));
		assert!(!is_overconfident(&[&w5, &dk]));
		assert!(is_overconfident(&[&w4, &w5, &r2]));
	}

	#[test]
	fn tally_counts_unknown_outcomes_as_dont_know() {
		let answers = [json!({ "outcome": "right" }), json!({ "outcome": "wrong" }), json!({ "outcome": "dontKnow" }), json!({ "outcome": "right" })];
		assert_eq!(stringify(&Tally::of(&answers).to_json()), r#"{"answered":4,"right":2,"wrong":1,"dontKnow":1,"rate":0.5}"#);
		assert_eq!(stringify(&Tally::of(&Vec::new()).to_json()), r#"{"answered":0,"right":0,"wrong":0,"dontKnow":0,"rate":null}"#);
	}

	#[test]
	fn a_problem_solved_with_hints_counts_as_part_of_a_right_one() {
		use super::super::progress::topic_status;
		let a = |o: &str| json!({ "outcome": o });
		let status = |answers: &[Json]| topic_status(Tally::of(answers).rate).as_str();
		assert_eq!(stringify(&Tally::of(&[a("hinted")]).to_json()), r#"{"answered":1,"right":0,"hinted":1,"wrong":0,"dontKnow":0,"rate":0.6}"#);
		assert_eq!(status(&[a("hinted")]), "shaky", "alone");
		assert_eq!(status(&[a("hinted"), a("hinted")]), "shaky");
		assert_eq!(status(&[a("hinted"), a("right")]), "shaky", "with a clean right one: not worse than shaky");
		assert_eq!(status(&[a("hinted"), a("right"), a("right")]), "strong");
		assert_eq!(status(&[a("hinted"), a("wrong")]), "weak");
	}

	fn quiz_turn(id: &str, args: Json, details: Json) -> [Json; 2] {
		[
			json!({ "role": "assistant", "id": format!("m_{id}"), "content": [{ "type": "toolCall", "id": id, "name": "quiz", "arguments": args }] }),
			json!({ "role": "toolResult", "toolCallId": id, "toolName": "quiz", "details": details }),
		]
	}

	#[test]
	fn predictions_are_not_answers_and_types_are_not_kept() {
		let graded = |extra: Json| {
			let mut d = json!({ "kind": "quiz", "correct": false, "answeredAt": "t" });
			for (k, v) in extra.as_obj().unwrap().iter() {
				d.as_obj_mut().unwrap().insert(k.clone(), v.clone());
			}
			d
		};
		let messages: Vec<Json> = [
			quiz_turn("q1", json!({ "type": "predict", "nodeId": "n1" }), graded(json!({}))),
			quiz_turn("q2", json!({ "type": "check" }), graded(json!({ "questionType": "\"predict\"" }))),
			quiz_turn("q3", json!({ "type": "predict" }), graded(json!({ "questionType": "check" }))),
			quiz_turn("q4", json!({ "type": "check", "nodeId": "n4" }), graded(json!({}))),
		]
		.concat();
		let got = collect_answers("c", &messages);
		let ids: Vec<&str> = got.iter().map(|a| a["toolCallId"].as_str().unwrap()).collect();
		assert_eq!(ids, ["q3", "q4"]);
		assert_eq!(stringify(&got[1]), r#"{"chatId":"c","messageId":"m_q4","contextMessageIds":[],"toolCallId":"q4","tool":"quiz","nodeId":"n4","question":"","outcome":"wrong","answeredAt":"t"}"#);
	}

	#[test]
	fn a_question_from_earlier_counts_for_the_quiz_it_came_from() {
		let review = |answer: Json| {
			let of = json!({ "chatId": "src", "messageId": "m_src", "toolCallId": "t1" });
			json!({ "role": "custom", "customType": "review", "content": "", "details": { "of": of, "nodeId": "bayes", "topic": "Bayes' rule", "quiz": { "question": "How likely?" }, "answer": answer } })
		};
		let messages = [
			review(json!({ "kind": "quiz", "correct": false, "confidence": 60, "answers": [{ "index": 1, "label": "About 60%" }], "answeredAt": "2026-11-11T21:01:00.000Z" })),
			review(json!({ "kind": "quiz", "dontKnow": true, "confidence": 20, "answers": [], "answeredAt": "2026-11-11T21:02:00.000Z" })),
			review(json!({ "kind": "quiz", "dismissed": true })),
		];
		let got = collect_answers("here", &messages);
		assert_eq!(got.len(), 2, "a dismissal is no answer");
		assert_eq!(stringify(&got[0]), r#"{"chatId":"src","messageId":"m_src","contextMessageIds":[],"toolCallId":"t1","tool":"review","nodeId":"bayes","question":"How likely?","outcome":"wrong","confidence":60,"level":3,"answeredAt":"2026-11-11T21:01:00.000Z"}"#);
		assert_eq!((got[1]["outcome"].as_str(), got[1].get("level")), (Some("dontKnow"), None));
		let facts = [json!({ "id": "f1", "provenance": [{ "chatId": "src", "messageId": "m_src" }] })];
		assert_eq!(facts_for_answer(&got[0], &facts_by_message(&facts)), ["f1"], "its facts resolve at the source quiz");
	}

	#[test]
	fn a_study_problem_answer_carries_its_plan_node() {
		let messages = [
			json!({ "role": "assistant", "id": "m1", "content": [{ "type": "toolCall", "id": "p1", "name": "problem", "arguments": { "statement": "S", "nodeId": "tpc_1", "target": ["f1"] } }, { "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved" } }] }),
			json!({ "role": "toolResult", "toolCallId": "p1", "timestamp": 0 }),
			json!({ "role": "toolResult", "toolCallId": "c1", "timestamp": 0 }),
		];
		let got = collect_answers("c", &messages);
		assert_eq!(stringify(&got[0]), r#"{"chatId":"c","messageId":"m1","contextMessageIds":[],"toolCallId":"p1","tool":"problem","factIds":["f1"],"nodeId":"tpc_1","question":"S","outcome":"right","answeredAt":"1970-01-01T00:00:00.000Z"}"#);
		let hinted = [messages[0].clone(), messages[1].clone(), json!({ "role": "assistant", "id": "m2", "content": [{ "type": "toolCall", "id": "c2", "name": "conclude", "arguments": { "outcome": "solvedWithHints" } }] }), json!({ "role": "toolResult", "toolCallId": "c2", "timestamp": 0 })];
		assert_eq!(collect_answers("c", &hinted)[0]["outcome"], json!("hinted"));
	}

	#[test]
	fn answers_find_their_facts_by_message() {
		let facts = [json!({ "id": "f1", "provenance": [{ "chatId": "c", "messageId": "m2" }, { "chatId": "c", "messageId": "m2" }] }), json!({ "id": "f2", "provenance": [{ "chatId": "c", "messageId": "m2" }, { "chatId": "c" }] })];
		let index = facts_by_message(&facts);
		assert_eq!(index["c\u{0}m2"], ["f1", "f2"]);
		let answer = json!({ "chatId": "c", "messageId": "m3", "contextMessageIds": ["m1", "m2"] });
		assert_eq!(facts_for_answer(&answer, &index), ["f1", "f2"]);
		assert_eq!(facts_for_answer(&json!({ "chatId": "c", "messageId": "m3", "contextMessageIds": [], "factIds": ["x"] }), &index), ["x"]);
		assert!(facts_for_answer(&json!({ "chatId": "other", "messageId": "m2", "contextMessageIds": [] }), &index).is_empty());
	}
}

//! Questions from earlier: a topic he got right comes back later as one question, which godspeed
//! asks by itself while the teacher reads or writes or no agent is teaching, and grades itself.
//! Each right answer after its full rest doubles the next rest (GAPS), a miss brings the topic
//! back within 4 days, and a close deadline shortens the rest of the topics it covers. Days are
//! local calendar days of the app clock. Skipping changes nothing.

use std::collections::{HashMap, HashSet};

use gs_base::time;
use gs_json::{Json, Obj, json};

use super::items;
use super::progress::{answer_outcome, days_between};
use super::topic_end::{ended_topics, lesson_stop, shown_openers, sitting_start};
use crate::contracts::chat::TOPIC_DONE_TOOL;
use crate::messages::native_messages::{active_problem_of, dangling_question_of};
use crate::messages::pending::is_question_tool;
use crate::session::question_core::normalize_quiz_type;
use crate::spaces::today_note::local_day;

/// Days of rest before a topic comes back, by its step.
const GAPS: [i64; 6] = [2, 4, 8, 16, 32, 64];
/// At most this many questions from earlier a local day per space.
const PER_DAY: usize = 3;
/// A question shown fewer than this many days ago is never asked.
const SHOWN_DAYS: i64 = 7;
/// With the session's deadline this close, only topics it covers come back.
const CLOSE_DEADLINE_DAYS: i64 = 2;
/// The quiz fields a question from earlier keeps: what the card shows and the window grades.
const QUIZ_FIELDS: [&str; 5] = ["question", "options", "correctAnswer", "explanation", "multiSelect"];

/// Where a topic's rest stands: its step in GAPS and the day the rest counts from.
#[derive(Debug, PartialEq, Eq)]
struct Walk {
	step: usize,
	anchor: String,
}

/// The walk over a topic's counted answers, `(local day, right)` oldest first, always with the
/// unclamped GAPS. The last answer of a day decides it. An early right repeat restarts the rest
/// without raising the step. None until a day is right.
fn walk(answers: &[(String, bool)]) -> Option<Walk> {
	let mut days: Vec<(&str, bool)> = Vec::new();
	for (day, right) in answers {
		match days.last_mut() {
			Some(last) if last.0 == day => last.1 = *right,
			_ => days.push((day, *right)),
		}
	}
	let first = days.iter().position(|(_, right)| *right)?;
	let (mut step, mut anchor): (usize, &str) = (0, days[first].0);
	for &(day, right) in &days[first + 1..] {
		if !right {
			step = step.saturating_sub(1).min(1);
		} else if days_between(anchor, day) >= GAPS[step] {
			step = (step + 1).min(GAPS.len() - 1);
		}
		anchor = day;
	}
	Some(Walk { step, anchor: anchor.to_owned() })
}

/// Today's gap at `step`: GAPS[step], or, when an open deadline `deadline_days` away (1 or more)
/// covers the topic, at most a third of the days left and never under 2.
fn gap(step: usize, deadline_days: Option<i64>) -> i64 {
	match deadline_days.filter(|n| *n >= 1) {
		Some(n) => GAPS[step].min(2.max((n + 2) / 3)),
		None => GAPS[step],
	}
}

/// A topic is due once its rest reaches its gap.
fn due(rest: i64, gap: i64) -> bool {
	rest >= gap
}

/// How far past its gap a due topic is; the most urgent comes first.
fn urgency(rest: i64, gap: i64) -> f64 {
	rest as f64 / gap as f64
}

/// The local day of an ISO time, or none when it cannot be read.
fn day_of(at: &Json) -> Option<String> {
	at.as_str().and_then(time::parse_date).map(local_day)
}

/// Each topic's counted answers by node id, `(local day, right)` oldest first. `answers` are the
/// graded answers of the space's lessons (collect_answers) and `outcomes` their problems
/// (practice_outcomes). A right quiz or question from earlier is right; a wrong one or I don't know
/// is missed. A problem solved, or solved with hints at R0 to R2, is right; one moved on from or
/// given up is missed. Predictions, dismissals and problems that needed more hints never count.
fn counted_answers(answers: &[Json], outcomes: &[Json]) -> HashMap<String, Vec<(String, bool)>> {
	let mut timed: Vec<(i64, String, bool)> = Vec::new();
	let mut push = |node: &Json, at: &Json, right: bool| {
		if let (Some(node), Some(ms)) = (node.as_str().filter(|n| !n.is_empty()), at.as_str().and_then(time::parse_date)) {
			timed.push((ms, node.to_owned(), right));
		}
	};
	for a in answers.iter().filter(|a| a["tool"].as_str() != Some("problem")) {
		match a["outcome"].as_str() {
			Some("right") => push(&a["nodeId"], &a["answeredAt"], true),
			Some("wrong" | "dontKnow") => push(&a["nodeId"], &a["answeredAt"], false),
			_ => {}
		}
	}
	for o in outcomes {
		match (o["outcome"].as_str(), o["rung"].as_str()) {
			(Some("solved"), _) | (Some("solvedWithHints"), Some("R0" | "R1" | "R2")) => push(&o["nodeId"], &o["at"], true),
			(Some("movedOn" | "surrendered"), _) => push(&o["nodeId"], &o["at"], false),
			_ => {}
		}
	}
	timed.sort_by_key(|(ms, _, _)| *ms);
	let mut out: HashMap<String, Vec<(String, bool)>> = HashMap::new();
	for (ms, node, right) in timed {
		out.entry(node).or_default().push((local_day(ms), right));
	}
	out
}

/// The key of a question from earlier: the lesson and the call it came from.
pub fn item_key(of: &Json) -> String {
	format!("{}:{}", of["chatId"].as_str().unwrap_or_default(), of["toolCallId"].as_str().unwrap_or_default())
}

/// The fields a question from earlier keeps of its quiz.
fn quiz_copy(args: &Json) -> Json {
	let mut quiz = Obj::new();
	for key in QUIZ_FIELDS {
		if let Some(v) = args.get(key) {
			quiz.insert(key, v.clone());
		}
	}
	Json::Obj(quiz)
}

/// The questions from earlier one lesson holds, in record order: every stored topic_done's
/// `review` (standalone by definition, it needs no flag), and every Study check quiz marked
/// `standalone` that he answered right. Each is `{of: {chatId, messageId, toolCallId}, nodeId,
/// quiz}`.
pub fn review_items(chat_id: &str, messages: &[Json]) -> Vec<Json> {
	let mut calls: HashMap<&str, (&Json, &Json)> = HashMap::new();
	let mut out = Vec::new();
	for m in messages {
		match m["role"].as_str() {
			Some("assistant") => {
				for block in m["content"].as_arr().into_iter().flatten().filter(|b| b["type"].as_str() == Some("toolCall")) {
					calls.insert(block["id"].as_str().unwrap_or_default(), (&m["id"], &block["arguments"]));
				}
			}
			Some("toolResult") if !m["isError"].truthy() => {
				let call_id = m["toolCallId"].as_str().unwrap_or_default();
				let Some(&(message_id, args)) = calls.get(call_id) else { continue };
				let (node, quiz) = match m["toolName"].as_str() {
					Some(TOPIC_DONE_TOOL) if args["review"].as_obj().is_some() => (args["review"]["nodeId"].as_str().or(args["nodeId"].as_str()), &args["review"]),
					// A quiz that carries a keep earned his sentence, so it never comes back itself.
					Some("quiz") if args["standalone"] == Json::Bool(true) && normalize_quiz_type(&args["type"]) == Some("check") && args["keep"].is_null() && answer_outcome(&m["details"]) == Some("right") => (args["nodeId"].as_str(), args),
					_ => continue,
				};
				let Some(node) = node.filter(|n| !n.is_empty()) else { continue };
				out.push(json!({ "of": { "chatId": chat_id, "messageId": message_id, "toolCallId": call_id }, "nodeId": node, "quiz": quiz_copy(quiz) }));
			}
			_ => {}
		}
	}
	out
}

/// The topics a Study lesson will still teach: its plan's nodes that did not end on a topic stop.
pub fn teaching_topics(record: &Json) -> HashSet<String> {
	let ended = ended_topics(items(&record["messages"]));
	items(&record["tree"]["nodes"]).iter().filter_map(|n| n["id"].as_str()).filter(|id| !ended.contains(*id)).map(str::to_owned).collect()
}

/// What the schedule reads about one space.
pub struct ReviewSpace<'a> {
	/// The learner's local day, `YYYY-MM-DD`.
	pub today: &'a str,
	/// The space's topics in space order: progress topics (`id`, `name`, `ungrouped`).
	pub topics: &'a [Json],
	/// The links between its topics (`from`, `to`).
	pub links: &'a [Json],
	/// Its deadlines: progress deadlines (`id`, `daysUntil`, `done`, `topicIds`).
	pub deadlines: &'a [Json],
	/// Every graded answer of its lessons (collect_answers), questions from earlier included.
	pub answers: &'a [Json],
	/// Every problem outcome of its lessons (practice_outcomes).
	pub outcomes: &'a [Json],
	/// Every question from earlier its lessons hold (review_items).
	pub items: &'a [Json],
}

/// The sitting that asks: the topics its session will still teach (teaching_topics), the
/// session's deadline, and the questions skipped in this sitting (item_key).
pub struct ReviewSitting<'a> {
	pub teaching: &'a HashSet<String>,
	pub deadline_id: Option<&'a str>,
	pub skipped: &'a HashSet<String>,
}

/// A due topic with the question it would ask.
struct Pick<'a> {
	urgency: f64,
	links_in: bool,
	order: usize,
	topic: &'a Json,
	item: &'a Json,
}

/// The questions from earlier to ask now, the next one first: due topics of the space that this
/// session will not teach (only ones its deadline covers when that is 2 days away or less), each
/// with a usable question, the most urgent first; among ties, topics that link into this sitting's
/// topics go last, then space order. At most 3 a local day per space, so the ones answered today count.
/// Each is `{of, nodeId, topic, quiz}`.
pub fn pick_reviews(space: &ReviewSpace, sitting: &ReviewSitting) -> Vec<Json> {
	let today = space.today;
	let from_earlier = |a: &&Json| a["tool"].as_str() == Some("review");
	let asked_today = space.answers.iter().filter(from_earlier).filter(|a| day_of(&a["answeredAt"]).as_deref() == Some(today)).count();
	let left = PER_DAY.saturating_sub(asked_today);
	if left == 0 {
		return Vec::new();
	}
	let counted = counted_answers(space.answers, space.outcomes);
	// The days each question was shown: asked in its lesson, or again from earlier.
	let mut shown: HashMap<String, Vec<String>> = HashMap::new();
	for a in space.answers {
		if let Some(day) = day_of(&a["answeredAt"]) {
			shown.entry(item_key(a)).or_default().push(day);
		}
	}
	let missed_last = missed_last(space.answers);
	let open = |d: &&Json| !d["done"].truthy();
	let close: Option<HashSet<&str>> = sitting
		.deadline_id
		.and_then(|id| space.deadlines.iter().filter(open).find(|d| d["id"].as_str() == Some(id)))
		.filter(|d| d["daysUntil"].as_i64().is_some_and(|n| (0..=CLOSE_DEADLINE_DAYS).contains(&n)))
		.map(|d| items(&d["topicIds"]).iter().filter_map(Json::as_str).collect());
	let covering = |id: &str| -> Option<i64> {
		space.deadlines.iter().filter(open).filter(|d| items(&d["topicIds"]).iter().any(|t| t.as_str() == Some(id))).filter_map(|d| d["daysUntil"].as_i64()).filter(|n| *n >= 1).min()
	};
	let mut picks: Vec<Pick> = Vec::new();
	for (order, topic) in space.topics.iter().enumerate() {
		let Some(id) = topic["id"].as_str() else { continue };
		if topic["ungrouped"].truthy() || sitting.teaching.contains(id) || close.as_ref().is_some_and(|c| !c.contains(id)) {
			continue;
		}
		let Some(walk) = counted.get(id).and_then(|answers| walk(answers)) else { continue };
		let (rest, gap) = (days_between(&walk.anchor, today), gap(walk.step, covering(id)));
		if !due(rest, gap) {
			continue;
		}
		let Some(item) = usable_item(space.items, id, today, &shown, missed_last.get(id), sitting.skipped) else { continue };
		let links_in = space.links.iter().any(|l| l["from"].as_str() == Some(id) && l["to"].as_str().is_some_and(|to| sitting.teaching.contains(to)));
		picks.push(Pick { urgency: urgency(rest, gap), links_in, order, topic, item });
	}
	picks.sort_by(|a, b| b.urgency.total_cmp(&a.urgency).then(a.links_in.cmp(&b.links_in)).then(a.order.cmp(&b.order)));
	picks
		.into_iter()
		.take(left)
		.map(|p| json!({ "of": p.item["of"].clone(), "nodeId": p.item["nodeId"].clone(), "topic": p.topic["name"].clone(), "quiz": p.item["quiz"].clone() }))
		.collect()
}

/// The question each topic missed the last time it came back from earlier, by node id.
fn missed_last(answers: &[Json]) -> HashMap<&str, String> {
	let mut from_earlier: Vec<&Json> = answers.iter().filter(|a| a["tool"].as_str() == Some("review")).collect();
	from_earlier.sort_by_key(|a| a["answeredAt"].as_str().and_then(time::parse_date).unwrap_or(i64::MIN));
	let mut out: HashMap<&str, String> = HashMap::new();
	for a in from_earlier {
		let Some(node) = a["nodeId"].as_str() else { continue };
		if a["outcome"].as_str() == Some("right") {
			out.remove(node);
		} else {
			out.insert(node, item_key(a));
		}
	}
	out
}

/// The topics that come back as questions from earlier: those with a question that is not the
/// one missed the last time it came back. `answers` and `items` are as in ReviewSpace.
pub fn reviewable_topics(answers: &[Json], items: &[Json]) -> HashSet<String> {
	let missed = missed_last(answers);
	items
		.iter()
		.filter_map(|item| item["nodeId"].as_str().filter(|node| missed.get(node) != Some(&item_key(&item["of"]))))
		.map(str::to_owned)
		.collect()
}

/// The topic's question to ask: never one shown in the last 7 days, never the one missed the last
/// time it came back, never one skipped in this sitting; of the rest, the one shown longest ago
/// (never shown first), then record order.
fn usable_item<'a>(items: &'a [Json], node: &str, today: &str, shown: &HashMap<String, Vec<String>>, missed_last: Option<&String>, skipped: &HashSet<String>) -> Option<&'a Json> {
	let last_shown = |item: &Json| shown.get(&item_key(&item["of"])).and_then(|days| days.iter().max().cloned());
	items
		.iter()
		.filter(|item| item["nodeId"].as_str() == Some(node))
		.filter(|item| {
			let key = item_key(&item["of"]);
			missed_last != Some(&key) && !skipped.contains(&key) && last_shown(item).is_none_or(|day| days_between(&day, today) >= SHOWN_DAYS)
		})
		.min_by_key(|item| last_shown(item))
}

/// Whether godspeed may ask a question from earlier in this lesson now. `busy`: a turn is running
/// or no agent is teaching. Only in a Study lesson, in its sitting's first wait (at the sitting's
/// start, or after his first input on a return, until the teacher's reply to it lands), with no
/// question, problem, opener or stop open.
pub fn review_window_open(record: &Json, now_ms: i64, busy: bool) -> bool {
	let messages = items(&record["messages"]);
	if !busy || record["kind"].as_str() != Some("study") || dangling_question_of(messages).is_some() || active_problem_of(messages).is_some() {
		return false;
	}
	if shown_openers(messages).values().any(|o| o.get("answer").is_none()) || lesson_stop(messages, Some(&record["tree"]), None).is_some_and(|s| !s["keptGoing"].truthy()) {
		return false;
	}
	let times: Vec<f64> = messages.iter().filter_map(|m| m["timestamp"].as_f64()).collect();
	let start = sitting_start(&times, now_ms as f64);
	let sitting: Vec<&Json> = messages.iter().filter(|m| m["timestamp"].as_f64().is_some_and(|t| t >= start)).collect();
	match sitting.iter().position(|m| is_input(m)) {
		Some(first) => !sitting[first + 1..].iter().any(|m| m["role"].as_str() == Some("assistant")),
		None => true,
	}
}

/// A message that carries his input: his words, an answer, the go-ahead or an opener answer.
fn is_input(m: &Json) -> bool {
	match m["role"].as_str() {
		Some("user") => true,
		Some("toolResult") => is_question_tool(m["toolName"].as_str().unwrap_or_default()),
		Some("custom") => matches!(m["customType"].as_str(), Some("practice-next" | "opener-answer")),
		_ => false,
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// Local noon on `day`, so its local day is `day` in every time zone.
	fn noon(day: &str) -> String {
		format!("{day}T12:00:00")
	}

	fn right(days: &[&str]) -> Vec<(String, bool)> {
		days.iter().map(|d| ((*d).to_owned(), true)).collect()
	}

	fn walked(answers: &[(String, bool)]) -> (usize, String) {
		let w = walk(answers).unwrap();
		(w.step, w.anchor)
	}

	fn standing(answers: &[(String, bool)], today: &str, deadline_days: Option<i64>) -> (i64, i64, f64) {
		let w = walk(answers).unwrap();
		let (rest, gap) = (days_between(&w.anchor, today), gap(w.step, deadline_days));
		(rest, gap, urgency(rest, gap))
	}

	#[test]
	fn gradient_descent_is_due_early_because_of_the_midterm() {
		let answers = right(&["2026-10-20", "2026-10-22", "2026-10-27", "2026-11-05"]);
		assert_eq!(walked(&answers), (3, "2026-11-05".to_owned()));
		assert_eq!(standing(&answers, "2026-11-11", Some(7)), (6, 3, 2.0));
		assert!(!due(6, gap(3, None)), "without the Midterm it waits for 16 days of rest");
	}

	#[test]
	fn bayes_rule_steps_back_on_its_miss() {
		let answers = vec![("2026-10-21".to_owned(), true), ("2026-10-23".to_owned(), true), ("2026-10-29".to_owned(), false), ("2026-11-02".to_owned(), true)];
		assert_eq!(walked(&answers), (1, "2026-11-02".to_owned()));
		assert_eq!(standing(&answers, "2026-11-11", None), (9, 4, 2.25));
	}

	#[test]
	fn eigenvalues_come_back_about_december_13() {
		let mut answers = right(&["2026-10-08", "2026-10-10", "2026-10-14", "2026-10-22"]);
		assert_eq!(standing(&answers, "2026-11-11", None), (20, 16, 1.25));
		answers.push(("2026-11-11".to_owned(), true));
		let w = walk(&answers).unwrap();
		assert_eq!(w.step, 4);
		assert_eq!(days_between("2026-11-11", "2026-12-13"), gap(w.step, None), "back after 32 days");
	}

	#[test]
	fn a_miss_after_months_right_comes_back_in_4_days() {
		let mut answers = right(&["2026-05-01", "2026-05-03", "2026-05-07", "2026-05-15", "2026-05-31", "2026-07-02", "2026-09-04"]);
		assert_eq!(walked(&answers).0, 5);
		answers.push(("2026-11-10".to_owned(), false));
		assert_eq!(walked(&answers), (1, "2026-11-10".to_owned()));
		assert!(!due(days_between("2026-11-10", "2026-11-13"), gap(1, None)));
		assert!(due(days_between("2026-11-10", "2026-11-14"), gap(1, None)), "back Nov 14, not in December");
	}

	#[test]
	fn right_answers_on_consecutive_days_never_raise_the_step() {
		let answers = right(&["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
		assert_eq!(walked(&answers), (0, "2026-11-04".to_owned()));
		let then = [answers.clone(), right(&["2026-11-06", "2026-11-10", "2026-11-18"])].concat();
		assert_eq!(walked(&then), (3, "2026-11-18".to_owned()), "afterwards it comes back at 2, 4, then 8 days");
	}

	#[test]
	fn the_last_answer_of_a_day_decides_it_and_a_walk_needs_a_right_day() {
		assert_eq!(walk(&[("2026-11-01".to_owned(), false)]), None);
		let day = vec![("2026-11-01".to_owned(), true), ("2026-11-03".to_owned(), true), ("2026-11-03".to_owned(), false)];
		assert_eq!(walked(&day), (0, "2026-11-03".to_owned()));
		assert_eq!(gap(5, Some(0)), 64, "a deadline today does not clamp");
		assert_eq!(gap(0, Some(30)), 2, "the clamp never raises a gap");
	}

	fn quiz_answer(node: &str, day: &str, outcome: &str) -> Json {
		json!({ "chatId": "old", "toolCallId": format!("q-{node}-{day}"), "tool": "quiz", "nodeId": node, "outcome": outcome, "answeredAt": noon(day) })
	}

	fn from_earlier(item: &Json, day: &str, outcome: &str) -> Json {
		json!({ "chatId": item["of"]["chatId"], "toolCallId": item["of"]["toolCallId"], "tool": "review", "nodeId": item["nodeId"], "outcome": outcome, "answeredAt": noon(day) })
	}

	fn item(node: &str, call: &str) -> Json {
		json!({ "of": { "chatId": "old", "messageId": format!("m-{call}"), "toolCallId": call }, "nodeId": node, "quiz": { "question": format!("{node}?") } })
	}

	fn topic(id: &str, name: &str) -> Json {
		json!({ "id": id, "name": name })
	}

	/// The demo space: Bayes' rule (Lecture 2), Eigenvalues (Lecture 3), Gradient descent (Lecture
	/// 4, on the Midterm), then the Midterm's new topics.
	fn demo_topics() -> Vec<Json> {
		vec![topic("bayes", "Bayes' rule"), topic("eig", "Eigenvalues"), topic("gd", "Gradient descent"), topic("reg", "Regularization"), topic("cv", "Cross-validation"), topic("ms", "Model selection")]
	}

	fn demo_links() -> Vec<Json> {
		vec![json!({ "from": "gd", "to": "reg" }), json!({ "from": "reg", "to": "cv" }), json!({ "from": "cv", "to": "ms" })]
	}

	fn midterm(today: &str) -> Vec<Json> {
		json!([{ "id": "mid", "daysUntil": days_between(today, "2026-11-18"), "done": false, "topicIds": ["gd", "reg", "cv", "ms"] }]).as_arr().unwrap().clone()
	}

	fn past_answers() -> Vec<Json> {
		let mut out: Vec<Json> = ["2026-10-08", "2026-10-10", "2026-10-14", "2026-10-22"].iter().map(|d| quiz_answer("eig", d, "right")).collect();
		out.extend([("2026-10-21", "right"), ("2026-10-23", "right"), ("2026-10-29", "wrong"), ("2026-11-02", "right")].iter().map(|(d, o)| quiz_answer("bayes", d, o)));
		out.extend(["2026-10-20", "2026-10-22", "2026-10-27", "2026-11-05"].iter().map(|d| quiz_answer("gd", d, "right")));
		out
	}

	fn picked_topics(picks: &[Json]) -> Vec<&str> {
		picks.iter().map(|p| p["nodeId"].as_str().unwrap()).collect()
	}

	fn pick(today: &str, answers: &[Json], outcomes: &[Json], items: &[Json], teaching: &[&str]) -> Vec<Json> {
		let (topics, links, deadlines) = (demo_topics(), demo_links(), midterm(today));
		let space = ReviewSpace { today, topics: &topics, links: &links, deadlines: &deadlines, answers, outcomes, items };
		let teaching: HashSet<String> = teaching.iter().map(|t| (*t).to_owned()).collect();
		pick_reviews(&space, &ReviewSitting { teaching: &teaching, deadline_id: Some("mid"), skipped: &HashSet::new() })
	}

	#[test]
	fn wednesday_asks_the_three_old_topics_most_urgent_first() {
		let items = [item("eig", "e1"), item("bayes", "b1"), item("gd", "g1")];
		let picks = pick("2026-11-11", &past_answers(), &[], &items, &["reg", "cv", "ms"]);
		assert_eq!(picked_topics(&picks), ["bayes", "gd", "eig"], "2.25, 2.0, then 1.25");
		assert_eq!(picks[0], json!({ "of": items[1]["of"], "nodeId": "bayes", "topic": "Bayes' rule", "quiz": { "question": "bayes?" } }));
	}

	#[test]
	fn saturday_asks_exactly_three_at_1_5() {
		// Wednesday: Eigenvalues right, Bayes' rule missed, Gradient descent right, all from
		// earlier; Regularization learned with a right quiz and an R1 solve.
		let items = [item("eig", "e1"), item("bayes", "b1"), item("bayes", "b2"), item("gd", "g1"), item("gd", "g2"), item("reg", "r1")];
		let mut answers = past_answers();
		answers.extend([from_earlier(&items[0], "2026-11-11", "right"), from_earlier(&items[1], "2026-11-11", "wrong"), from_earlier(&items[3], "2026-11-11", "right")]);
		answers.push(quiz_answer("reg", "2026-11-11", "right"));
		let outcomes = [json!({ "nodeId": "reg", "outcome": "solvedWithHints", "rung": "R1", "at": noon("2026-11-11") })];
		let picks = pick("2026-11-14", &answers, &outcomes, &items, &["cv", "ms"]);
		assert_eq!(picked_topics(&picks), ["bayes", "gd", "reg"], "among ties the topic that links into tonight's goes last, then space order");
		assert_eq!(picks[0]["of"]["toolCallId"], json!("b2"), "never the question missed last time");
		assert_eq!(picks[1]["of"]["toolCallId"], json!("g2"), "never one shown in the last 7 days");
		assert_eq!(pick("2026-11-14", &answers, &outcomes, &items[..5], &["cv", "ms"]).len(), 2, "a flagless topic_done review is Regularization's only question");
	}

	#[test]
	fn three_a_day_count_the_ones_answered_today() {
		let items = [item("eig", "e1"), item("bayes", "b1"), item("gd", "g1")];
		let mut answers = past_answers();
		answers.push(from_earlier(&items[1], "2026-11-11", "right"));
		assert_eq!(picked_topics(&pick("2026-11-11", &answers, &[], &items, &[])), ["gd", "eig"]);
		answers.push(from_earlier(&items[2], "2026-11-11", "right"));
		answers.push(json!({ "chatId": "x", "toolCallId": "y", "tool": "review", "nodeId": "zzz", "outcome": "wrong", "answeredAt": noon("2026-11-11") }));
		assert!(pick("2026-11-11", &answers, &[], &items, &[]).is_empty());
	}

	#[test]
	fn the_session_skips_what_it_teaches_and_a_close_deadline_keeps_its_own_topics() {
		let items = [item("eig", "e1"), item("bayes", "b1"), item("gd", "g1")];
		assert_eq!(picked_topics(&pick("2026-11-11", &past_answers(), &[], &items, &["gd"])), ["bayes", "eig"]);
		assert_eq!(picked_topics(&pick("2026-11-16", &past_answers(), &[], &items, &[])), ["gd"], "the Midterm is 2 days away");
		let (topics, links, deadlines) = (demo_topics(), demo_links(), midterm("2026-11-16"));
		let answers = past_answers();
		let space = ReviewSpace { today: "2026-11-16", topics: &topics, links: &links, deadlines: &deadlines, answers: &answers, outcomes: &[], items: &items };
		let skipped: HashSet<String> = [item_key(&items[2]["of"])].into();
		let none = HashSet::new();
		assert!(pick_reviews(&space, &ReviewSitting { teaching: &none, deadline_id: Some("mid"), skipped: &skipped }).is_empty(), "a skipped question waits");
		assert_eq!(pick_reviews(&space, &ReviewSitting { teaching: &none, deadline_id: None, skipped: &none }).len(), 3, "not a Midterm session");
	}

	#[test]
	fn a_topic_needs_a_question_a_right_day_and_a_group() {
		let mut topics = demo_topics();
		topics[0].as_obj_mut().unwrap().insert("ungrouped", true);
		let items = [item("eig", "e1"), item("bayes", "b1")];
		let deadlines = midterm("2026-11-11");
		let answers = [past_answers(), vec![quiz_answer("cv", "2026-11-01", "wrong")]].concat();
		let none = HashSet::new();
		let space = ReviewSpace { today: "2026-11-11", topics: &topics, links: &[], deadlines: &deadlines, answers: &answers, outcomes: &[], items: &items };
		let picks = pick_reviews(&space, &ReviewSitting { teaching: &none, deadline_id: None, skipped: &none });
		assert_eq!(picked_topics(&picks), ["eig"], "Bayes' rule is ungrouped, Gradient descent has no question, Cross-validation was never right");
	}

	#[test]
	fn forty_due_topics_leave_13_unasked_before_a_test_9_days_away() {
		let topics: Vec<Json> = (0..40).map(|i| topic(&format!("t{i}"), &format!("T{i}"))).collect();
		let items: Vec<Json> = (0..40).map(|i| item(&format!("t{i}"), &format!("c{i}"))).collect();
		let long_ago = ["2026-01-01", "2026-01-03", "2026-01-07", "2026-01-15", "2026-01-31", "2026-03-04", "2026-05-07"];
		let mut answers: Vec<Json> = (0..40).flat_map(|i| long_ago.iter().map(move |d| quiz_answer(&format!("t{i}"), d, "right"))).collect();
		let mut asked: HashSet<String> = HashSet::new();
		for day in 0..9 {
			let today = time::iso((time::days_from_civil(2026, 11, 2) + day) * 86_400_000)[..10].to_owned();
			let deadlines = json!([{ "id": "test", "daysUntil": days_between(&today, "2026-11-11"), "done": false, "topicIds": topics.iter().map(|t| t["id"].clone()).collect::<Vec<_>>() }]);
			let none = HashSet::new();
			let space = ReviewSpace { today: &today, topics: &topics, links: &[], deadlines: deadlines.as_arr().unwrap(), answers: &answers, outcomes: &[], items: &items };
			let picks = pick_reviews(&space, &ReviewSitting { teaching: &none, deadline_id: None, skipped: &none });
			assert_eq!(picks.len(), 3, "{today}");
			for p in picks {
				let it = json!({ "of": p["of"], "nodeId": p["nodeId"] });
				answers.push(from_earlier(&it, &today, "right"));
				asked.insert(p["nodeId"].as_str().unwrap().to_owned());
			}
		}
		assert_eq!(40 - asked.len(), 13);
	}

	fn assistant(id: &str, call: &str, name: &str, args: Json) -> Json {
		json!({ "role": "assistant", "id": id, "content": [{ "type": "toolCall", "id": call, "name": name, "arguments": args }], "timestamp": 1 })
	}

	fn result(call: &str, name: &str, details: Json, is_error: bool) -> Json {
		json!({ "role": "toolResult", "toolCallId": call, "toolName": name, "details": details, "isError": is_error, "timestamp": 2 })
	}

	#[test]
	fn a_topic_whose_only_question_was_missed_last_is_not_reviewable() {
		let items = [item("bayes", "b1"), item("gd", "g1"), item("gd", "g2")];
		let answers = [from_earlier(&items[0], "2026-11-11", "wrong"), from_earlier(&items[1], "2026-11-11", "wrong")];
		assert_eq!(reviewable_topics(&answers, &items), ["gd".to_owned()].into(), "Bayes' rule has no other question, Gradient descent still has g2");
		let again = [answers[0].clone(), from_earlier(&items[0], "2026-11-20", "right")];
		assert!(reviewable_topics(&again, &items).contains("bayes"), "a right answer since lifts the bar");
	}

	#[test]
	fn items_are_stored_reviews_and_standalone_checks_answered_right() {
		let check = |standalone: bool| json!({ "type": "check", "nodeId": "reg", "question": "Q?", "options": [{ "label": "A" }], "correctAnswer": "A", "explanation": "E", "standalone": standalone, "details": "d" });
		let right = json!({ "kind": "quiz", "correct": true });
		let review = json!({ "type": "check", "nodeId": "reg", "question": "R?", "options": [{ "label": "B" }], "correctAnswer": "B", "explanation": "F", "multiSelect": false });
		let messages = [
			assistant("m1", "q1", "quiz", check(true)),
			result("q1", "quiz", right.clone(), false),
			assistant("m2", "q2", "quiz", check(false)),
			result("q2", "quiz", right.clone(), false),
			assistant("m3", "q3", "quiz", check(true)),
			result("q3", "quiz", json!({ "kind": "quiz", "correct": false }), false),
			assistant("m4", "q4", "quiz", json!({ "type": "predict", "nodeId": "reg", "standalone": true })),
			result("q4", "quiz", right, false),
			assistant("m5", "t1", "topic_done", json!({ "nodeId": "reg", "review": review })),
			result("t1", "topic_done", json!({ "part": "topic_done", "v": 1 }), false),
			assistant("m6", "t2", "topic_done", json!({ "nodeId": "cv", "review": review })),
			result("t2", "topic_done", json!({}), true),
			assistant("m7", "q7", "quiz", json!({ "type": "check", "nodeId": "reg", "question": "K?", "standalone": true, "keep": { "text": "Lambda prices large weights." } })),
			result("q7", "quiz", json!({ "kind": "quiz", "correct": true }), false),
		];
		let got = review_items("c", &messages);
		assert_eq!(got.len(), 2, "only a right standalone check with no keep and a stored review");
		assert_eq!(got[0], json!({ "of": { "chatId": "c", "messageId": "m1", "toolCallId": "q1" }, "nodeId": "reg", "quiz": { "question": "Q?", "options": [{ "label": "A" }], "correctAnswer": "A", "explanation": "E" } }));
		assert_eq!(got[1]["of"], json!({ "chatId": "c", "messageId": "m5", "toolCallId": "t1" }));
		assert_eq!(got[1]["quiz"]["multiSelect"], json!(false));
	}

	#[test]
	fn problems_count_by_rung_and_predictions_never() {
		let answers = [
			json!({ "tool": "quiz", "nodeId": "a", "outcome": "dontKnow", "answeredAt": noon("2026-11-02") }),
			json!({ "tool": "problem", "nodeId": "a", "outcome": "right", "answeredAt": noon("2026-11-03") }),
			json!({ "tool": "quiz", "nodeId": "a", "outcome": "right", "answeredAt": noon("2026-11-01") }),
		];
		let outcome = |o: &str, rung: Json, day: &str| json!({ "nodeId": "a", "outcome": o, "rung": rung, "at": noon(day) });
		let outcomes = [outcome("solvedWithHints", json!("R3"), "2026-11-04"), outcome("solvedWithHints", json!("R2"), "2026-11-05"), outcome("movedOn", Json::Null, "2026-11-06"), outcome("dismissed", Json::Null, "2026-11-07")];
		let counted = counted_answers(&answers, &outcomes);
		let days: Vec<(&str, bool)> = counted["a"].iter().map(|(d, r)| (d.as_str(), *r)).collect();
		assert_eq!(days, [("2026-11-01", true), ("2026-11-02", false), ("2026-11-05", true), ("2026-11-06", false)]);
	}

	fn tree() -> Json {
		json!({ "nodes": [{ "id": "reg", "title": "Regularization" }, { "id": "cv", "title": "Cross-validation" }], "edges": [] })
	}

	const NOW: i64 = 1_795_035_600_000;
	const MINUTE: i64 = 60_000;

	fn record(messages: Vec<Json>) -> Json {
		json!({ "kind": "study", "tree": tree(), "messages": messages })
	}

	fn at(m: Json, minutes_ago: i64) -> Json {
		let mut m = m;
		m.as_obj_mut().unwrap().insert("timestamp", NOW - minutes_ago * MINUTE);
		m
	}

	fn user(words: &str) -> Json {
		json!({ "role": "user", "content": words })
	}

	fn says(words: &str) -> Json {
		json!({ "role": "assistant", "content": [{ "type": "text", "text": words }] })
	}

	#[test]
	fn the_window_opens_in_a_sittings_first_wait() {
		let start = record(vec![at(user("Study for Midterm"), 1)]);
		assert!(review_window_open(&start, NOW, true), "the first reply is on its way");
		assert!(!review_window_open(&start, NOW, false), "the teacher is idle and teaching");
		let replied = record(vec![at(user("Study for Midterm"), 3), at(says("Here is Regularization."), 1)]);
		assert!(!review_window_open(&replied, NOW, true), "the reply landed");
		let returned = record(vec![at(user("Study for Midterm"), 3 * 24 * 60), at(says("Here is Regularization."), 3 * 24 * 60), at(user("Back again."), 1)]);
		assert!(review_window_open(&returned, NOW, true), "his first input on a return");
		let later = record(vec![at(user("Study for Midterm"), 3 * 24 * 60), at(says("Here."), 3 * 24 * 60), at(user("Back."), 5), at(says("Welcome."), 4), at(user("Next?"), 1)]);
		assert!(!review_window_open(&later, NOW, true), "not his second input of the sitting");
		let teach = json!({ "kind": "teach", "messages": [at(user("hi"), 1)] });
		assert!(!review_window_open(&teach, NOW, true), "Study lessons only");
	}

	#[test]
	fn the_window_stays_shut_while_something_is_open() {
		let asked = record(vec![at(user("Study"), 3), at(json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz", "arguments": { "nodeId": "reg" } }] }), 1)]);
		assert!(!review_window_open(&asked, NOW, true), "a question waits");
		let stop = json!({ "kind": "topic", "nodeId": "reg", "activeMinutes": 30, "at": time::iso(NOW - 2 * MINUTE) });
		let stopped = vec![
			at(user("Study"), 40),
			at(json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "conclude", "arguments": { "outcome": "solved" } }] }), 2),
			at(json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "details": { "stop": stop }, "isError": false }), 2),
		];
		assert!(!review_window_open(&record(stopped.clone()), NOW, true), "the stop card is up");
		let mut kept = stopped;
		kept.push(at(json!({ "role": "custom", "customType": "keep-going", "content": "", "details": { "stopOf": "c1", "at": time::iso(NOW - MINUTE) } }), 1));
		kept.push(at(json!({ "role": "custom", "customType": "practice-next", "content": "[NEXT PROBLEM]" }), 1));
		assert!(review_window_open(&record(kept), NOW, true), "he kept going and the go-ahead is his first input since the stop's sitting");
		let topics = teaching_topics(&record(vec![at(json!({ "role": "toolResult", "toolCallId": "c1", "toolName": "conclude", "details": { "stop": stop }, "isError": false }), 2)]));
		assert_eq!(topics, ["cv".to_owned()].into(), "Regularization ended");
	}
}

//! The parts a Study topic opens with, read from the record (src/shared/core/topic-parts.ts; both
//! replay tests/golden/topic_parts.json). A reply is one assistant message; its topic is the
//! nodeId its calls name (refused calls aside), else the topic of the latest earlier reply. A
//! topic's page is the first quoted source mark in the shown opener's lead, else in the reply that
//! opens the topic; later replies never give one. `reply_parts_problems` (Rust only) is the check
//! Study's lesson-parts hook runs on a reply before its plot and guess are stored.

use std::collections::HashSet;

use gs_json::{Json, json};

use super::items;
use super::topic_end::shown_openers;
use crate::messages::citations::{CiteMark, replace_cite_marks};
use crate::messages::pending::is_question_tool;
use crate::session::plot::{PLOT_TOOL, Plot, check_plot, option_names_value, short};
use crate::session::question_core::{coerce_correct_answer, normalize_quiz_type, parse_options_if_string};

/// Every topic the lesson reached, in the order it reached them: `{ nodeId, page }`, where `page`
/// is null or `{ messageId, leadOf, fileId, range, name, quote }` (the reply's message id, or the
/// call id of the topic_done whose opener lead holds the mark).
pub fn topic_parts(messages: &[Json]) -> Vec<Json> {
	walk(messages).0
}

/// One reply the learner sees (or a shown opener's lead), in record order: its topic and whether
/// it carries the topic's page or a plot. Replies of reads alone are not seen.
struct Visit {
	node_id: String,
	page: bool,
	plot: bool,
}

fn walk(messages: &[Json]) -> (Vec<Json>, Vec<Visit>) {
	let openers = shown_openers(messages);
	let refused: HashSet<&str> = messages.iter().filter(|m| m["role"].as_str() == Some("toolResult") && m["isError"] == Json::Bool(true)).filter_map(|m| m["toolCallId"].as_str()).collect();
	let mut out: Vec<Json> = Vec::new();
	let mut visits = Vec::new();
	let reached = |out: &[Json], node_id: &str| out.iter().position(|t| t["nodeId"].as_str() == Some(node_id));
	let mut opened: HashSet<String> = HashSet::new();
	let mut current: Option<String> = None;
	for m in messages {
		let opener = (m["role"].as_str() == Some("toolResult")).then(|| m["toolCallId"].as_str().and_then(|id| openers.get(id))).flatten();
		if let Some(opener) = opener
			&& let Some(node_id) = opener["quiz"]["nodeId"].as_str()
			&& reached(&out, node_id).is_none()
		{
			let lead_of = opener["topicDoneCallId"].clone();
			let page = first_quoted(opener["lead"].as_str().unwrap_or_default(), Json::Null, lead_of);
			visits.push(Visit { node_id: node_id.to_owned(), page: !page.is_null(), plot: false });
			out.push(json!({ "nodeId": node_id, "page": page }));
			continue;
		}
		if m["role"].as_str() != Some("assistant") {
			continue;
		}
		current = call_topic(m, &refused).or(current);
		let Some(node_id) = current.clone() else { continue };
		let at = reached(&out, &node_id).unwrap_or_else(|| {
			out.push(json!({ "nodeId": node_id, "page": null }));
			out.len() - 1
		});
		let mut gave_page = false;
		if opened.insert(node_id.clone()) {
			let page = items(&m["content"])
				.iter()
				.filter(|b| b["type"].as_str() == Some("text"))
				.map(|b| first_quoted(b["text"].as_str().unwrap_or_default(), m["id"].clone(), Json::Null))
				.find(|page| !page.is_null());
			if let Some(page) = page.filter(|_| out[at]["page"].is_null())
				&& let Some(parts) = out[at].as_obj_mut()
			{
				parts.insert("page", page);
				gave_page = true;
			}
		}
		let plot = calls(m).any(|c| c["name"].as_str() == Some(PLOT_TOOL) && !c["id"].as_str().is_some_and(|id| refused.contains(id)));
		if is_seen(m, &refused) {
			visits.push(Visit { node_id, page: gave_page, plot });
		}
	}
	(out, visits)
}

fn calls(m: &Json) -> impl Iterator<Item = &Json> {
	items(&m["content"]).iter().filter(|b| b["type"].as_str() == Some("toolCall"))
}

/// A reply the learner sees: words, or a question or a plot that was not refused.
fn is_seen(m: &Json, refused: &HashSet<&str>) -> bool {
	items(&m["content"]).iter().any(|b| b["type"].as_str() == Some("text") && b["text"].as_str().is_some_and(|t| !t.trim().is_empty()))
		|| calls(m).any(|c| c["name"].as_str().is_some_and(|name| name == PLOT_TOOL || is_question_tool(name)) && !c["id"].as_str().is_some_and(|id| refused.contains(id)))
}

/// The topic a reply's calls name: the first call with a nodeId that was not refused.
fn call_topic(m: &Json, refused: &HashSet<&str>) -> Option<String> {
	calls(m).filter(|b| !b["id"].as_str().is_some_and(|id| refused.contains(id))).find_map(|b| b["arguments"]["nodeId"].as_str().map(str::to_owned))
}

fn first_quoted(text: &str, message_id: Json, lead_of: Json) -> Json {
	let mut page = Json::Null;
	replace_cite_marks(text, |mark| {
		if let (true, CiteMark::File { file_id, range, name, quote: Some(quote) }) = (page.is_null(), mark) {
			page = json!({ "messageId": message_id.clone(), "leadOf": lead_of.clone(), "fileId": file_id, "range": range, "name": name, "quote": quote });
		}
		String::new()
	});
	page
}

const NO_PLOT: &str = "onPlot: no plot in this reply. Send the plot with it, or the guess alone without onPlot.";
const WITH_THE_PLOT: &str = "quiz: refused with the plot above. Re-send both, or the guess alone without onPlot.";

/// What the lesson-parts hook decides for one reply.
#[derive(Default, Debug, PartialEq)]
pub struct PartsVerdict {
	/// Each refused call's id and its whole refusal.
	pub refused: Vec<(String, String)>,
	/// The plot that passes with its guess: the plot's call id and `{ toolCallId, value }`, the
	/// guess's call id and the drawn value it asks about (4 significant figures).
	pub on_plot: Option<(String, Json)>,
}

/// The check on a reply's plot and its guess (`quiz.onPlot`), which pass or are refused as a pair,
/// whatever order the reply lists them in: one plot and one guess, the guess a prediction whose
/// right option names the drawn value, one plot a topic, and neither this reply nor the topic's
/// reply before it carrying a page or a plot. `quiz_call` gives a quiz call's arguments as the quiz
/// tool takes them, after its own preparation, and whether they pass its checks; a guess that
/// fails them is left to them. A plot that fails its own checks is refused by its preparation;
/// this only refuses its guess with it.
pub fn reply_parts_problems(lesson_messages: &[Json], reply: &Json, quiz_call: &dyn Fn(&Json) -> (Json, bool)) -> PartsVerdict {
	let id = |c: &Json| c["id"].as_str().unwrap_or_default().to_owned();
	let plots: Vec<&Json> = calls(reply).filter(|c| c["name"].as_str() == Some(PLOT_TOOL)).collect();
	// Each guess's call id, its prepared arguments, and whether they pass the quiz's checks.
	let guesses: Vec<(String, Json, bool)> = calls(reply)
		.filter(|c| c["name"].as_str() == Some("quiz"))
		.map(|c| {
			let (args, passes) = quiz_call(&c["arguments"]);
			(id(c), args, passes)
		})
		.filter(|(_, args, _)| args["onPlot"].as_obj().is_some())
		.collect();
	// A guess that fails the quiz's own checks is refused by them, in their words.
	let refuse_guesses = |verdict: &mut PartsVerdict, line: &str| verdict.refused.extend(guesses.iter().filter(|g| g.2).map(|g| (g.0.clone(), line.to_owned())));
	let mut verdict = PartsVerdict::default();
	let [plot_call] = plots.as_slice() else {
		verdict.refused.extend(plots.iter().map(|p| (id(p), "plot: send one plot a reply.".to_owned())));
		refuse_guesses(&mut verdict, if plots.is_empty() { NO_PLOT } else { WITH_THE_PLOT });
		return verdict;
	};
	let checked = check_plot(&plot_call["arguments"]);
	let mut problems = match guesses.len() {
		0 => vec!["plot: needs a quiz with onPlot in the same reply.".to_owned()],
		1 => Vec::new(),
		_ => vec!["plot: one guess per plot; give onPlot to one quiz.".to_owned()],
	};
	let mut value = None;
	if let (Ok(plot), [(_, args, passes)]) = (&checked, guesses.as_slice()) {
		if !passes {
			problems.push("plot: refused with its quiz. Fix the quiz and re-send both.".to_owned());
		}
		value = guess_value(plot, args, &mut problems);
	}
	problems.extend(spacing_problems(lesson_messages, reply));
	if problems.is_empty()
		&& let (Ok(_), Some(value), [(guess_id, _, _)]) = (&checked, value, guesses.as_slice())
	{
		verdict.on_plot = Some((id(plot_call), json!({ "toolCallId": guess_id, "value": four_figures(value) })));
		return verdict;
	}
	if checked.is_ok() {
		verdict.refused.push((id(plot_call), problems.join("\n")));
	}
	refuse_guesses(&mut verdict, WITH_THE_PLOT);
	verdict
}

fn four_figures(v: f64) -> f64 {
	format!("{v:.3e}").parse().unwrap_or(v)
}

/// A number, or a string that reads as one.
fn number(v: &Json) -> Option<f64> {
	v.as_f64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok())).filter(|n: &f64| n.is_finite())
}

/// The guess's own problems; the drawn value it asks about when it names a point on a line.
fn guess_value(plot: &Plot, quiz: &Json, problems: &mut Vec<String>) -> Option<f64> {
	if normalize_quiz_type(&quiz["type"]) != Some("predict") {
		problems.push("onPlot: the guess on a plot is type \"predict\".".to_owned());
	}
	let on = &quiz["onPlot"];
	let label = on["line"].as_str().unwrap_or_default();
	let line = plot.line(label);
	if line.is_none() {
		let lines = plot.lines.iter().map(|l| format!("\"{}\"", l.label)).collect::<Vec<_>>().join(", ");
		problems.push(format!("onPlot.line: no line \"{label}\"; lines are {lines}."));
	}
	let x = number(&on["x"]);
	match x {
		None => problems.push("onPlot.x: must be a number.".to_owned()),
		Some(x) if !plot.x.holds(x) => problems.push(format!("onPlot.x: {} is outside min {} to max {}.", short(x), short(plot.x.min), short(plot.x.max))),
		_ => {}
	}
	let slider = if on["slider"].is_null() { Some(plot.start) } else { number(&on["slider"]) };
	match slider {
		None => problems.push("onPlot.slider: must be a number.".to_owned()),
		Some(s) if !plot.slider.holds(s) => problems.push(format!("onPlot.slider: {} is outside min {} to max {}.", short(s), short(plot.slider.min), short(plot.slider.max))),
		_ => {}
	}
	let (Some(line), Some(x), Some(s)) = (line, x, slider) else { return None };
	if !plot.x.holds(x) || !plot.slider.holds(s) {
		return None;
	}
	let value = plot.line_value(line, x, s);
	let at = format!("{} = {}, {} = {}", plot.x.name, short(x), plot.slider.name, short(s));
	if !value.is_finite() {
		problems.push(format!("onPlot: {label} has no value at {at}. Ask about another x."));
		return None;
	}
	let options = parse_options_if_string(Some(&quiz["options"])).unwrap_or(Json::Null);
	let options = items(&options);
	let key = |o: &Json| {
		let value = o["value"].as_str().map(str::trim).unwrap_or_default();
		if value.is_empty() { o["label"].as_str().unwrap_or_default().trim().to_owned() } else { value.to_owned() }
	};
	let keys: Vec<String> = options.iter().map(key).collect();
	for right in coerce_correct_answer(&quiz["correctAnswer"], &keys) {
		let Some(option) = options.iter().find(|o| key(o) == right) else { continue };
		let words = option["label"].as_str().unwrap_or_default();
		if !option_names_value(words, value) {
			let which = if option["value"].as_str().is_some_and(|v| !v.trim().is_empty()) { format!("option {right}") } else { "the right option".to_owned() };
			problems.push(format!("correctAnswer: {which} reads \"{words}\" but {label} at {at} is {}. Fix the option or onPlot.", short(value)));
		}
	}
	Some(value)
}

/// One plot a topic, and a plot only after a topic reply with no page, plot or keep, its own
/// reply carrying no page either.
fn spacing_problems(lesson_messages: &[Json], reply: &Json) -> Vec<String> {
	let mut messages = lesson_messages.to_vec();
	messages.push(reply.clone());
	let (_, visits) = walk(&messages);
	let Some((own, earlier)) = visits.split_last() else { return Vec::new() };
	let topic: Vec<&Visit> = earlier.iter().filter(|v| v.node_id == own.node_id).collect();
	let mut problems = Vec::new();
	if topic.iter().any(|v| v.plot) {
		problems.push("plot: this topic already has a plot.".to_owned());
	}
	if own.page || topic.last().is_some_and(|v| v.page || v.plot) {
		problems.push("plot: send it after one reply with no page, plot or keep.".to_owned());
	}
	problems
}

#[cfg(test)]
mod tests {
	use super::*;

	const MARK: &str = "[[f_1a2b3c4d5e6f/p. 14/Lecture 6.pdf|degree 12]]";

	fn plot_args() -> Json {
		json!({
			"title": "One feature, where the weight ends up",
			"x": { "name": "a", "label": "where the data alone put it", "min": 0, "max": 10 },
			"y": { "label": "w", "min": 0, "max": 5 },
			"slider": { "name": "lambda", "min": 0.5, "max": 4, "start": 1 },
			"lines": [{ "label": "penalty", "expr": "a/(1+lambda)", "hidden": true }, { "label": "leash", "expr": "min(a, 4/(1+lambda))" }],
		})
	}

	fn guess(right: &str, on_plot: Json) -> Json {
		let options = json!([{ "label": "At 2, the leash's length.", "value": "A" }, { "label": "At 4.", "value": "B" }, { "label": "At 3.", "value": "C" }, { "label": "At 8.", "value": "D" }]);
		json!({ "type": "predict", "nodeId": "reg", "question": "Where does the penalty put it?", "options": options, "explanation": "a/(1+lambda) at a = 8.", "correctAnswer": right, "onPlot": on_plot })
	}

	fn call(id: &str, name: &str, args: Json) -> Json {
		json!({ "type": "toolCall", "id": id, "name": name, "arguments": args })
	}

	fn reply(id: &str, text: &str, calls: Vec<Json>) -> Json {
		let mut content = if text.is_empty() { Vec::new() } else { vec![json!({ "type": "text", "text": text })] };
		content.extend(calls);
		json!({ "id": id, "role": "assistant", "content": content })
	}

	fn result(id: &str, name: &str, is_error: bool) -> Json {
		json!({ "role": "toolResult", "toolCallId": id, "toolName": name, "isError": is_error, "details": null })
	}

	fn pair(order_quiz_first: bool, on_plot: Json, right: &str) -> Json {
		let (q, p) = (call("q3", "quiz", guess(right, on_plot)), call("p3", "plot", plot_args()));
		reply("r3", "A common picture is a leash on the weights.", if order_quiz_first { vec![q, p] } else { vec![p, q] })
	}

	/// Reply 1 opens the topic on its page, reply 2 is plain.
	fn lesson() -> Vec<Json> {
		vec![
			reply("r1", &format!("Here the curve misses.{MARK}"), vec![call("q1", "quiz", guess("A", Json::Null))]),
			json!({ "role": "toolResult", "toolCallId": "q1", "toolName": "quiz", "isError": false, "details": { "kind": "quiz", "correct": true } }),
			reply("r2", "So the curve calms.", vec![call("q2", "quiz", guess("B", Json::Null))]),
			json!({ "role": "toolResult", "toolCallId": "q2", "toolName": "quiz", "isError": false, "details": { "kind": "quiz", "correct": true } }),
		]
	}

	fn passes(quiz: &Json) -> (Json, bool) {
		(quiz.clone(), true)
	}

	fn penalty_at_8() -> Json {
		json!({ "line": "penalty", "x": 8 })
	}

	#[test]
	fn a_valid_pair_passes_in_either_order_with_the_drawn_value() {
		for quiz_first in [true, false] {
			let verdict = reply_parts_problems(&lesson(), &pair(quiz_first, penalty_at_8(), "B"), &passes);
			assert_eq!(verdict, PartsVerdict { refused: Vec::new(), on_plot: Some(("p3".to_owned(), json!({ "toolCallId": "q3", "value": 4.0 }))) });
		}
		let at_slider = reply_parts_problems(&lesson(), &pair(true, json!({ "line": "penalty", "x": 8, "slider": 3 }), "A"), &passes);
		assert_eq!(at_slider.on_plot.unwrap().1["value"], json!(2.0));
	}

	#[test]
	fn the_pair_is_refused_together_with_every_problem_on_the_plot() {
		let verdict = reply_parts_problems(&lesson(), &pair(true, penalty_at_8(), "C"), &passes);
		assert_eq!(
			verdict.refused,
			[
				("p3".to_owned(), "correctAnswer: option C reads \"At 3.\" but penalty at a = 8, lambda = 1 is 4. Fix the option or onPlot.".to_owned()),
				("q3".to_owned(), WITH_THE_PLOT.to_owned()),
			]
		);
		let mut wrong = guess("B", json!({ "line": "penalty curve", "x": 12, "slider": 6 }));
		wrong.as_obj_mut().unwrap().insert("type", "check");
		let verdict = reply_parts_problems(&lesson(), &reply("r3", "", vec![call("p3", "plot", plot_args()), call("q3", "quiz", wrong)]), &|quiz| (quiz.clone(), false));
		assert_eq!(
			verdict.refused[0].1.lines().collect::<Vec<_>>(),
			[
				"plot: refused with its quiz. Fix the quiz and re-send both.",
				"onPlot: the guess on a plot is type \"predict\".",
				"onPlot.line: no line \"penalty curve\"; lines are \"penalty\", \"leash\".",
				"onPlot.x: 12 is outside min 0 to max 10.",
				"onPlot.slider: 6 is outside min 0.5 to max 4.",
			]
		);
		assert_eq!(verdict.refused.len(), 1, "the guess is refused by its own checks, in their words");
		assert!(!verdict.refused[0].1.contains("Received arguments"));
	}

	#[test]
	fn a_plot_needs_its_guess_and_a_guess_needs_its_plot() {
		let lone_plot = reply("r3", "Look.", vec![call("p3", "plot", plot_args()), call("q3", "quiz", guess("B", Json::Null))]);
		assert_eq!(reply_parts_problems(&lesson(), &lone_plot, &passes).refused, [("p3".to_owned(), "plot: needs a quiz with onPlot in the same reply.".to_owned())], "the plain quiz stands");
		let lone_guess = reply("r3", "Guess.", vec![call("q3", "quiz", guess("B", penalty_at_8()))]);
		assert_eq!(reply_parts_problems(&lesson(), &lone_guess, &passes).refused, [("q3".to_owned(), NO_PLOT.to_owned())]);
		let plain = reply("r3", "Plain.", vec![call("q3", "quiz", guess("B", Json::Null))]);
		assert_eq!(reply_parts_problems(&lesson(), &plain, &passes), PartsVerdict::default());
		let broken = json!({ "title": "t" });
		let verdict = reply_parts_problems(&lesson(), &reply("r3", "", vec![call("p3", "plot", broken), call("q3", "quiz", guess("B", penalty_at_8()))]), &passes);
		assert_eq!(verdict.refused, [("q3".to_owned(), WITH_THE_PLOT.to_owned())], "the plot's own problems are its preparation's");
	}

	#[test]
	fn a_plot_waits_one_plain_reply_after_a_page_and_comes_once_a_topic() {
		let after_page = [lesson()[..2].to_vec()].concat();
		let verdict = reply_parts_problems(&after_page, &pair(true, penalty_at_8(), "B"), &passes);
		assert_eq!(verdict.refused[0].1, "plot: send it after one reply with no page, plot or keep.");
		let own_page = reply("r1", &format!("Here.{MARK}"), vec![call("q3", "quiz", guess("B", penalty_at_8())), call("p3", "plot", plot_args())]);
		assert_eq!(reply_parts_problems(&[], &own_page, &passes).refused[0].1, "plot: send it after one reply with no page, plot or keep.");
		let first_reply = reply_parts_problems(&[], &pair(true, penalty_at_8(), "B"), &passes);
		assert!(first_reply.refused.is_empty(), "a topic's opening reply with no page may carry the plot");

		let reads = reply("r2b", "", vec![call("l1", "ls", json!({ "path": "." }))]);
		let after_reads = [lesson()[..2].to_vec(), vec![reads, result("l1", "ls", false)]].concat();
		assert_eq!(reply_parts_problems(&after_reads, &pair(true, penalty_at_8(), "B"), &passes).refused[0].1, "plot: send it after one reply with no page, plot or keep.", "a reply of reads alone is not seen");

		let with_plot = [lesson(), vec![pair(true, penalty_at_8(), "B"), result("q3", "quiz", false), result("p3", "plot", false)]].concat();
		let again = reply("r4", "And again.", vec![call("q4", "quiz", guess("B", penalty_at_8())), call("p4", "plot", plot_args())]);
		assert_eq!(reply_parts_problems(&with_plot, &again, &passes).refused[0].1.lines().collect::<Vec<_>>(), ["plot: this topic already has a plot.", "plot: send it after one reply with no page, plot or keep."]);
		let refused_before = [lesson(), vec![pair(true, penalty_at_8(), "C"), result("q3", "quiz", true), result("p3", "plot", true)]].concat();
		assert!(reply_parts_problems(&refused_before, &again, &passes).refused.is_empty(), "a refused plot is no plot");
	}

	/// Re-sending a refused pair with no words between is not the plain reply the rule asks for.
	#[test]
	fn a_reply_of_refused_calls_alone_is_not_seen() {
		let after_page = lesson()[..2].to_vec();
		let bare_pair = |n: &str| reply(&format!("r{n}"), "", vec![call(&format!("q{n}"), "quiz", guess("B", penalty_at_8())), call(&format!("p{n}"), "plot", plot_args())]);
		assert_eq!(reply_parts_problems(&after_page, &bare_pair("2"), &passes).refused[0].1, "plot: send it after one reply with no page, plot or keep.");
		let refused = [after_page, vec![bare_pair("2"), result("q2", "quiz", true), result("p2", "plot", true)]].concat();
		let again = reply_parts_problems(&refused, &bare_pair("3"), &passes);
		assert_eq!(again.on_plot, None);
		assert_eq!(again.refused[0].1, "plot: send it after one reply with no page, plot or keep.");
	}
}

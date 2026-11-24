//! The checks on a Study reply's own words. Two are raised once a topic: a curve written out as a
//! table or as lines of numbers (a plot's job) and a list of questions (a reply asks one). Code is
//! never read. A reply's text has already been shown, so its checks become a note the teacher
//! reads before its next reply. Of the tool calls, only a quiz's question, a problem's statement
//! and an opener's lead are read, for a curve, and such a call is refused
//! (`services::turns::reply_nudges`). The third, a wall of prose right after his own message or a
//! miss, is raised once a learner input.

use gs_json::Json;
use markdown::mdast::Node;
use markdown::{Constructs, ParseOptions};

use super::progress::{answer_outcome, is_answer_data};
use crate::messages::role::{Role, is_custom};
use crate::messages::tool_calls;
use crate::session::question_core::normalize_quiz_type;

/// What a reply's words are sent back for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Nudge {
	CurveTable,
	QuestionList,
}

impl Nudge {
	/// What the teacher reads before its next reply.
	pub fn note(self) -> &'static str {
		match self {
			Nudge::CurveTable => "these rows read as points of one curve. Send `plot` with the rows as `points` and a prediction instead.",
			Nudge::QuestionList => "a reply holds one question. Keep one, cut the rest; never answer one to make the list shorter.",
		}
	}
}

/// What the teacher reads when a call whose words read as a curve is refused.
pub fn curve_refusal() -> String {
	format!("not sent: {} If the table is not a curve, send the reply again as it is.", Nudge::CurveTable.note())
}

/// What the teacher reads before its next reply when its notes are about its last one.
pub const LAST_REPLY_LEAD: &str = "About your last reply:";

/// Added to the question list's note while a problem is open.
pub const OPEN_PROBLEM_NOTE: &str = "A problem is open: its parts are already asked; don't list them again.";

/// More plain prose than this after the learner's own message or a miss is sent back once
/// (docs/teaching-methodology.md says why 150).
pub const WALL_WORDS: usize = 150;

/// What the teacher reads before its next reply after one of `words` words of prose.
pub fn wall_note(words: usize) -> String {
	format!("{words} words right after his own message or a miss. One idea in at most four short lines, then his move; give away no more than before.")
}

/// The words of plain prose in a reply: fenced code, display math (`$$`, `\[`) and table rows
/// aside. A word holds a letter or digit.
pub fn prose_words(text: &str) -> usize {
	let mut closing: Option<&str> = None;
	let mut words = 0;
	for line in text.lines().map(str::trim) {
		if let Some(end) = closing {
			if line.contains(end) {
				closing = None;
			}
			continue;
		}
		if let Some(fence) = ["```", "~~~"].into_iter().find(|f| line.starts_with(f)) {
			closing = Some(fence);
			continue;
		}
		if let Some((open, end)) = [("$$", "$$"), ("\\[", "\\]")].into_iter().find(|(open, _)| line.starts_with(open)) {
			if !line[open.len()..].contains(end) {
				closing = Some(end);
			}
			continue;
		}
		if !line.starts_with('|') {
			words += line.split_whitespace().filter(|w| w.chars().any(char::is_alphanumeric)).count();
		}
	}
	words
}

/// The learner input a reply must stay short after, by its message id: his newest input when it
/// is a message he typed, or an answer graded wrong or "I don't know" (a prediction is never
/// graded). A go-ahead or Keep going click, a right answer or no input since the last reply: none.
/// So is the goal that opens the lesson: the first reply to it may hold the worked example.
pub fn short_reply_input(messages: &[Json]) -> Option<String> {
	let missed = |answer: &Json| matches!(answer_outcome(answer), Some("wrong" | "dontKnow"));
	for (at, m) in messages.iter().enumerate().rev() {
		let id = || Some(m["id"].as_str().map_or_else(|| at.to_string(), str::to_owned));
		match Role::of(m) {
			Some(Role::User) => return messages[..at].iter().any(|earlier| Role::Assistant.is(earlier)).then(id).flatten(),
			Some(Role::Assistant) => return None,
			Some(Role::ToolResult) if is_answer_data(&m["details"]) => return (missed(&m["details"]) && !is_prediction(messages, m)).then(id).flatten(),
			Some(Role::Custom) if is_custom(m, "review") => return missed(&m["details"]["answer"]).then(id).flatten(),
			Some(Role::Custom) if matches!(m["customType"].as_str(), Some("practice-next" | "teach-me" | "opener-answer" | "keep-going")) => return None,
			_ => {}
		}
	}
	None
}

/// Whether an answer is to a prediction: its own question type, else its call's.
fn is_prediction(messages: &[Json], answer: &Json) -> bool {
	let call_id = answer["toolCallId"].as_str();
	let call = messages.iter().filter(|m| Role::Assistant.is(m)).flat_map(tool_calls).find(|b| b["id"].as_str() == call_id);
	let kind = if answer["details"]["questionType"].is_null() { call.map_or(&Json::Null, |b| &b["arguments"]["type"]) } else { &answer["details"]["questionType"] };
	normalize_quiz_type(kind) == Some("predict")
}

/// The nudges a reply's words call for, in this order: a curve, then a question list.
pub fn reply_nudges(text: &str) -> Vec<Nudge> {
	let options = ParseOptions { constructs: Constructs { gfm_table: true, math_flow: true, math_text: true, ..Constructs::default() }, math_text_single_dollar: true, ..ParseOptions::default() };
	// Only MDX can fail to parse, and it is off.
	let Ok(tree) = markdown::to_mdast(text, &options) else { return Vec::new() };
	let raw = |node: &Node| node.position().map_or("", |at| &text[at.start.offset..at.end.offset]);
	let (mut curve, mut questions) = (false, 0);
	// Each line of words (a list item counts as one) by where it starts: whether it is a series.
	let mut lines: Vec<(usize, bool)> = Vec::new();
	let mut pending = vec![(&tree, false)];
	while let Some((node, in_item)) = pending.pop() {
		let start = node.position().map_or(0, |at| at.start.offset);
		match node {
			Node::Table(table) => {
				curve |= is_curve_table(text, &table.children);
				lines.push((start, false));
			}
			Node::ListItem(item) => {
				// The item's own words, its nested lists aside: they are items of their own.
				let own: Vec<&Node> = item.children.iter().filter(|c| !matches!(c, Node::List(_))).collect();
				if let (Some(first), Some(last)) = (own.first().and_then(|n| n.position()), own.last().and_then(|n| n.position())) {
					let words = &text[first.start.offset..last.end.offset];
					questions += usize::from(words.trim_end_matches(|c: char| c.is_whitespace() || c == '*' || c == '_').ends_with('?'));
					lines.push((start, is_series(words)));
				}
			}
			Node::Paragraph(_) if !in_item => {
				let mut at = start;
				for line in raw(node).split('\n') {
					lines.push((at, is_series(line)));
					at += line.len() + 1;
				}
			}
			Node::Heading(_) | Node::Code(_) | Node::Math(_) => lines.push((start, false)),
			_ => {}
		}
		let inside = in_item || matches!(node, Node::ListItem(_));
		pending.extend(node.children().into_iter().flatten().map(|child| (child, inside && !matches!(child, Node::List(_)))));
	}
	lines.sort_unstable();
	curve |= lines.windows(2).any(|pair| pair[0].1 && pair[1].1);
	[(curve, Nudge::CurveTable), (questions >= 2, Nudge::QuestionList)].into_iter().filter_map(|(fires, nudge)| fires.then_some(nudge)).collect()
}

/// A header cell whose first word is one of these names a worked trace's step column: its rows
/// are one run's steps, not points of a curve.
const STEP_COLUMNS: [&str; 6] = ["step", "iteration", "t", "k", "n", "i"];

/// At least 3 data rows of at least 2 cells, every cell a number, and not all of them 0 or 1 (a
/// truth table), under a header that names no step column.
fn is_curve_table(text: &str, rows: &[Node]) -> bool {
	let raw = |node: &Node| node.position().map_or("", |at| &text[at.start.offset..at.end.offset]);
	let cells = |row: &Node| -> Vec<&str> { row.children().into_iter().flatten().map(|cell| raw(cell).trim_matches(|c: char| c.is_whitespace() || "|$*_".contains(c))).collect() };
	let Some((header, rows)) = rows.split_first() else { return false };
	let data: Vec<Vec<&str>> = rows.iter().map(cells).collect();
	!cells(header).iter().any(|c| names_a_step(c))
		&& data.len() >= 3
		&& data.iter().all(|cells| cells.len() >= 2 && cells.iter().all(|c| number(c)))
		&& !data.iter().flatten().all(|c| matches!(*c, "0" | "1"))
}

fn names_a_step(cell: &str) -> bool {
	let word = cell.split(|c: char| !c.is_alphanumeric()).find(|w| !w.is_empty()).unwrap_or_default().to_lowercase();
	let word = word.strip_suffix('s').filter(|w| w.len() > 1).unwrap_or(&word);
	STEP_COLUMNS.contains(&word)
}

/// A run of at least this many numbers makes a line a series.
const SERIES_RUN: usize = 4;

/// A label and a run of numbers, as "training error: 9.1, 6.0, 4.2, 3.1" (TeX spacing and dollar
/// signs aside). Two in a row are a curve written as lines.
fn is_series(line: &str) -> bool {
	let spaced = ["\\quad", "\\ ", "\\,", "\\;", "~", "$"].iter().fold(line.to_owned(), |line, gap| line.replace(gap, " "));
	let mut run = 0;
	let mut longest = 0;
	for token in spaced.split(|c: char| c.is_whitespace() || c == ',' || c == ';').filter(|t| !t.is_empty()) {
		run = if number(token.trim_matches(|c: char| "*_()".contains(c))) { run + 1 } else { 0 };
		longest = longest.max(run);
	}
	longest >= SERIES_RUN && spaced.chars().any(char::is_alphabetic)
}

fn number(cell: &str) -> bool {
	let cell = cell.strip_suffix('%').unwrap_or(cell).replace('\u{2212}', "-");
	cell.bytes().any(|b| b.is_ascii_digit()) && cell.parse::<f64>().is_ok_and(f64::is_finite)
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn prose_words_leave_out_code_display_math_and_table_rows() {
		assert_eq!(prose_words("One idea, then **his** move. - 42"), 6);
		let reply = "Two words.\n\n```rust\nlet x = 1;\n```\n$$\na + b\n$$\n$$x = 2$$\n\\[\ny\n\\]\n\\[ z \\]\n| a | b |\n|---|---|\n| 1 | 2 |\nInline $x$ and `code` count.";
		assert_eq!(prose_words(reply), 7);
		assert_eq!(prose_words("~~~\nnever closed\nstill code"), 0);
	}

	fn typed(id: &str) -> Json {
		json!({ "id": id, "role": "user", "content": "Why does it hold?" })
	}

	fn answered(id: &str, kind: &str, details: Json) -> [Json; 2] {
		[
			json!({ "role": "assistant", "content": [{ "type": "toolCall", "id": "q1", "name": "quiz", "arguments": { "type": kind } }] }),
			json!({ "id": id, "role": "toolResult", "toolCallId": "q1", "toolName": "quiz", "details": details }),
		]
	}

	#[test]
	fn a_typed_message_or_a_missed_answer_wants_a_short_reply() {
		let note = json!({ "role": "custom", "customType": "app-note", "content": "x" });
		let replied = json!({ "role": "assistant", "content": [{ "type": "text", "text": "Because." }] });
		assert_eq!(short_reply_input(&[typed("m0"), replied, typed("m1"), note]).as_deref(), Some("m1"), "an app note is no input");
		let wrong = answered("m2", "check", json!({ "kind": "quiz", "correct": false }));
		assert_eq!(short_reply_input(&wrong).as_deref(), Some("m2"));
		let unsure = answered("m3", "check", json!({ "kind": "quiz", "dontKnow": true }));
		assert_eq!(short_reply_input(&unsure).as_deref(), Some("m3"));
		let review = json!({ "id": "m4", "role": "custom", "customType": "review", "details": { "answer": { "kind": "quiz", "correct": false } } });
		assert_eq!(short_reply_input(&[review]).as_deref(), Some("m4"));
	}

	#[test]
	fn a_right_answer_a_prediction_or_a_click_wants_none() {
		assert_eq!(short_reply_input(&answered("m1", "check", json!({ "kind": "quiz", "correct": true }))), None);
		assert_eq!(short_reply_input(&answered("m1", "predict", json!({ "kind": "quiz", "correct": false }))), None);
		assert_eq!(short_reply_input(&answered("m1", "check", json!({ "kind": "quiz", "correct": false, "questionType": "predict" }))), None);
		for click in ["practice-next", "keep-going", "opener-answer"] {
			assert_eq!(short_reply_input(&[typed("m1"), json!({ "role": "custom", "customType": click, "content": "" })]), None, "{click}");
		}
		let replied = json!({ "role": "assistant", "content": [{ "type": "text", "text": "Because." }] });
		assert_eq!(short_reply_input(&[typed("m1"), replied]), None, "already answered");
		assert_eq!(short_reply_input(&[typed("m1")]), None, "the goal that opens the lesson");
		assert_eq!(short_reply_input(&[]), None);
	}

	#[test]
	fn a_table_of_numbers_reads_as_a_curve() {
		let table = "The U shape.\n\n| Degree | Training error | Validation error |\n|---|---|---|\n| 1 | 9.0 | 9.5 |\n| 3 | 3.0 | 3.5 |\n| 6 | 1.5 | 4.0 |\n| 12 | 0.1 | 11.0 |\n\nDegree 3 is the pick.";
		assert_eq!(reply_nudges(table), [Nudge::CurveTable]);
		let in_math = "| $\\lambda$ | error |\n|---|---|\n| $0.1$ | $-2$ |\n| $1$ | **4.5** |\n| $10$ | 30% |";
		assert_eq!(reply_nudges(in_math), [Nudge::CurveTable], "numbers in math, bold or with a percent sign");
	}

	#[test]
	fn a_text_column_a_short_table_or_a_truth_table_is_no_curve() {
		let folds = "| Held-out fold | Points | Validation error |\n|---|---|---|\n| 1 | 1, 2 | 4 |\n| 2 | 3, 4 | 6 |\n| 3 | 5, 6 | 5 |";
		assert!(reply_nudges(folds).is_empty(), "the points column is a list, not a number");
		let names = "| Model | Error |\n|---|---|\n| ridge | 4 |\n| lasso | 5 |\n| none | 9 |";
		assert!(reply_nudges(names).is_empty());
		let truth = "| A | B | A and B |\n|---|---|---|\n| 0 | 1 | 0 |\n| 1 | 1 | 1 |";
		assert!(reply_nudges(truth).is_empty(), "2 rows");
		let full_truth = "| A | B |\n|---|---|\n| 0 | 0 |\n| 0 | 1 |\n| 1 | 0 |\n| 1 | 1 |";
		assert!(reply_nudges(full_truth).is_empty(), "0 and 1 alone");
		let one_column = "| n |\n|---|\n| 1 |\n| 2 |\n| 3 |";
		assert!(reply_nudges(one_column).is_empty());
	}

	#[test]
	fn two_lines_of_numbers_in_a_row_read_as_a_curve() {
		let opener = "Here is one data set:\n\n- Training errors, degrees 1 to 6: $8.0,\\ 3.5,\\ 1.5,\\ 0.8,\\ 0.3,\\ 0.1$\n- Validation errors, degrees 1 to 6: $9.0,\\ 4.1,\\ 2.2,\\ 2.0,\\ 2.3,\\ 3.1$";
		assert_eq!(reply_nudges(opener), [Nudge::CurveTable]);
		let lines = "training error: 9.1, 6.0, 4.2, 3.1, 2.9, 2.8\nvalidation error: 9.5, 7.0, 5.1, 4.8, 5.6, 7.2";
		assert_eq!(reply_nudges(lines), [Nudge::CurveTable], "two lines of one paragraph");
	}

	#[test]
	fn one_line_of_numbers_or_two_apart_is_no_curve() {
		assert!(reply_nudges("training error: 9.1, 6.0, 4.2, 3.1, 2.9, 2.8").is_empty());
		let apart = "training error: 9.1, 6.0, 4.2, 3.1\n\nBoth fall at first.\n\nvalidation error: 9.5, 7.0, 5.1, 4.8";
		assert!(reply_nudges(apart).is_empty());
		let short = "- fold errors: 4, 6, 5\n- fold sizes: 2, 2, 2";
		assert!(reply_nudges(short).is_empty(), "3 numbers is no run");
		let unlabeled = "$1,\\ 2,\\ 3,\\ 4$\n\n$5,\\ 6,\\ 7,\\ 8$";
		assert!(reply_nudges(unlabeled).is_empty(), "no label");
	}

	#[test]
	fn a_worked_trace_is_no_curve() {
		let trace = "| $t$ | $w_t$ | slope $2w_t$ | step $\\eta \\cdot 2w_t$ | $w_{t+1}$ |\n|---|---|---|---|---|\n| 0 | $3$ | $6$ | $1.5$ | $1.5$ |\n| 1 | $1.5$ | $3$ | $0.75$ | $0.75$ |\n| 2 | $0.75$ | $1.5$ | $0.375$ | $0.375$ |";
		assert!(reply_nudges(trace).is_empty());
		for header in ["Step", "Iterations", "k", "n", "i"] {
			let table = format!("| {header} | w | loss |\n|---|---|---|\n| 1 | 3 | 9 |\n| 2 | 1.5 | 2.25 |\n| 3 | 0.75 | 0.56 |");
			assert!(reply_nudges(&table).is_empty(), "{header}");
		}
		let bullets = "- **Step 1, from $w_0 = 3$:** the slope is $6$, the step is $0.25 \\times 6 = 1.5$, so $w_1 = 3 - 1.5 = 1.5$.\n- **Step 2, from $w_1 = 1.5$:** the slope is $3$, the step is $0.75$, so $w_2 = 0.75$.\n- **Step 3, from $w_2 = 0.75$:** the slope is $1.5$, the step is $0.375$, so $w_3 = 0.375$.";
		assert!(reply_nudges(bullets).is_empty());
	}

	#[test]
	fn two_listed_questions_are_a_question_list() {
		let reply = "**Your turn. Answer both in chat:**\n\n1. What is the cross-validation score?\n2. Point 7 sits in fold 4. How many of the 5 fits was point 7 used for validation, and how many for training?";
		assert_eq!(reply_nudges(reply), [Nudge::QuestionList]);
		let bulleted = "- **Which error decides?**\n- And why\n  does it decide?\n";
		assert_eq!(reply_nudges(bulleted), [Nudge::QuestionList], "bold and an item on two lines");
	}

	#[test]
	fn steps_one_question_and_code_are_no_question_list() {
		let steps = "1. Split the 10 points into 5 folds of 2.\n2. Hold out fold 1. Why one fold? Each point is held out once.\n3. Average the 5 errors.";
		assert!(reply_nudges(steps).is_empty());
		let one = "1. Split the points.\n2. What is the cross-validation score?";
		assert!(reply_nudges(one).is_empty());
		let prose = "What is the score? And how many fits?";
		assert!(reply_nudges(prose).is_empty(), "not a list");
		let code = "```\n1. What is x?\n2. What is y?\n```";
		assert!(reply_nudges(code).is_empty());
		let both = "| x | y |\n|---|---|\n| 1 | 2 |\n| 2 | 4 |\n| 3 | 6 |\n\n1. What is y at 4?\n2. And at 5?";
		assert_eq!(reply_nudges(both), [Nudge::CurveTable, Nudge::QuestionList]);
	}
}

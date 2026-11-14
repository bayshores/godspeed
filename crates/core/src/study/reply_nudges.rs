//! The two checks on a Study reply's own words before it is stored, each sent back once a topic: a
//! table whose rows read as points of one curve (a plot's job) and a list of questions (a reply
//! asks one). Code is never read, and tool calls such as a problem statement are not words.

use markdown::mdast::Node;
use markdown::{Constructs, ParseOptions};

/// What a reply's words are sent back for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Nudge {
	CurveTable,
	QuestionList,
}

impl Nudge {
	/// What the teacher reads when the reply is sent back.
	pub fn refusal(self) -> &'static str {
		match self {
			Nudge::CurveTable => "not sent: these rows read as points of one curve. Send `plot` with a prediction instead. If the table is not a curve, send the reply again as it is.",
			Nudge::QuestionList => "not sent: a reply holds one question. Ask the first one now, through `quiz` or `problem` when it checks understanding. If these are not questions for the learner, send the reply again as it is.",
		}
	}
}

/// The nudges a reply's words call for, in this order: a curve table, then a question list.
pub fn reply_nudges(text: &str) -> Vec<Nudge> {
	let options = ParseOptions { constructs: Constructs { gfm_table: true, math_flow: true, math_text: true, ..Constructs::default() }, math_text_single_dollar: true, ..ParseOptions::default() };
	// Only MDX can fail to parse, and it is off.
	let Ok(tree) = markdown::to_mdast(text, &options) else { return Vec::new() };
	let (mut curve, mut questions) = (false, 0);
	let mut pending = vec![&tree];
	while let Some(node) = pending.pop() {
		match node {
			Node::Table(table) => curve |= is_curve(text, &table.children),
			Node::ListItem(item) => {
				// The item's own words, its nested lists aside: they are items of their own.
				let own: Vec<&Node> = item.children.iter().filter(|c| !matches!(c, Node::List(_))).collect();
				if let (Some(first), Some(last)) = (own.first().and_then(|n| n.position()), own.last().and_then(|n| n.position())) {
					questions += usize::from(text[first.start.offset..last.end.offset].trim_end_matches(|c: char| c.is_whitespace() || c == '*' || c == '_').ends_with('?'));
				}
			}
			_ => {}
		}
		pending.extend(node.children().into_iter().flatten());
	}
	[(curve, Nudge::CurveTable), (questions >= 2, Nudge::QuestionList)].into_iter().filter_map(|(fires, nudge)| fires.then_some(nudge)).collect()
}

/// At least 3 data rows of at least 2 cells, every cell a number, and not all of them 0 or 1 (a
/// truth table). The header row is not data.
fn is_curve(text: &str, rows: &[Node]) -> bool {
	let raw = |node: &Node| node.position().map_or("", |at| &text[at.start.offset..at.end.offset]);
	let data: Vec<Vec<&str>> = rows.iter().skip(1).map(|row| row.children().into_iter().flatten().map(|cell| raw(cell).trim_matches(|c: char| c.is_whitespace() || "|$*_".contains(c))).collect()).collect();
	data.len() >= 3 && data.iter().all(|cells| cells.len() >= 2 && cells.iter().all(|c| number(c))) && !data.iter().flatten().all(|c| matches!(*c, "0" | "1"))
}

fn number(cell: &str) -> bool {
	let cell = cell.strip_suffix('%').unwrap_or(cell).replace('\u{2212}', "-");
	cell.bytes().any(|b| b.is_ascii_digit()) && cell.parse::<f64>().is_ok_and(f64::is_finite)
}

#[cfg(test)]
mod tests {
	use super::*;

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

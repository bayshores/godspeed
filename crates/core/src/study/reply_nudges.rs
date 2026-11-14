//! The two checks on a Study reply's own words before it is stored, each sent back once a topic: a
//! curve written out as a table or as lines of numbers (a plot's job) and a list of questions (a
//! reply asks one). Code is never read, and tool calls such as a problem statement are not words.

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

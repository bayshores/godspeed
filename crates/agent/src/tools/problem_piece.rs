//! What the tools that pose a problem share when it is shown as a piece of a page: the `source`
//! the teacher writes, and the result that carries the piece.

use gs_base::text;
use gs_core::session::schema::{integer, object, string, string_min};
use gs_engine::turn::messages::text_block;
use gs_json::Json;

/// Why a call with neither is refused.
pub(super) const NO_STATEMENT: &str = "give the statement, or a source to show the page itself";

/// The most of a piece's words the teacher reads back, in UTF-16 units.
const TEXT_MAX: i64 = 8000;

/// The `source` field: where a problem is printed. In homework the file may be left out.
pub(super) fn source_field(homework: bool) -> Json {
	let (required, file_id): (&[&str], _) = if homework {
		(&["page", "starts"], "The space file the problem is printed in (a PDF). Left out: the deadline's assignment file.")
	} else {
		(&["fileId", "page", "starts"], "The space file the problem is printed in (a PDF).")
	};
	object(
		required,
		vec![
			("fileId", string(file_id)),
			("page", integer(1, "The page the problem starts on.")),
			("starts", string_min(1, "The problem's first words exactly as the page prints them: plain words before any math, one line's worth.")),
			("ends", string_min(1, "The first words of what is printed right after the problem. Left out: the problem ends with its page.")),
		],
	)
}

/// The words the teacher typed for a problem, when there are any.
pub(super) fn typed(value: &Json) -> Option<&str> {
	value.as_str().filter(|words| !words.trim().is_empty())
}

/// `result` shown as the page's own piece: `shown` (`{ piece, text }`) rides as its details, and the
/// teacher reads the piece's words after the usual line.
pub(super) fn with_piece(mut result: Json, shown: &Json) -> Json {
	let words = shown["text"].str_or_empty();
	if !words.is_empty() {
		let first = result["content"][0]["text"].str_or_empty();
		let mut said = format!("{first}\nThe problem as the file prints it:\n{}", text::slice16(words, 0, Some(TEXT_MAX)));
		if gs_pdf::may_hold_broken_formulas(words) {
			said.push_str("\nFormulas in this text may read broken. The learner sees the page itself.");
		}
		result.set("content", vec![text_block(&said)]);
	}
	// A scan has no words to find a problem by, so the learner gets the page whole.
	let whole = shown["piece"]["parts"].items().first().is_some_and(|part| part["crop"].items().iter().map(|side| side.as_f64()).eq([Some(0.0), Some(0.0), Some(1.0), Some(1.0)]));
	if whole && shown["piece"]["mark"].is_null() {
		let first = result["content"][0]["text"].str_or_empty();
		result.set("content", vec![text_block(&format!("{first}\nThe page is a scan, so the learner sees all of it. Say which problem on it is theirs."))]);
	}
	result.set("details", shown.clone());
	result
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn the_piece_rides_the_result_and_its_words_follow_the_first_line() {
		let result = json!({ "content": [text_block("Problem posed.")], "details": null, "terminate": true });
		let shown = json!({ "piece": { "fileId": "f" }, "text": "1. First problem" });
		let out = with_piece(result.clone(), &shown);
		assert_eq!(out["content"][0]["text"].str_or_empty(), "Problem posed.\nThe problem as the file prints it:\n1. First problem");
		assert_eq!(out["details"], shown);
		assert_eq!(out["terminate"], Json::Bool(true));
		let broken = with_piece(result.clone(), &json!({ "piece": {}, "text": "w = \u{25a0} L" }));
		assert!(broken["content"][0]["text"].str_or_empty().ends_with("The learner sees the page itself."));
		let long = with_piece(result.clone(), &json!({ "piece": {}, "text": "x".repeat(9000) }));
		assert_eq!(text::len16(long["content"][0]["text"].str_or_empty()), "Problem posed.\nThe problem as the file prints it:\n".len() + 8000);
		let scan = with_piece(result, &json!({ "piece": { "parts": [{ "page": 3, "crop": [0, 0, 1, 1], "aspect": 0.77 }] }, "text": "" }));
		assert_eq!(scan["content"][0]["text"].str_or_empty(), "Problem posed.\nThe page is a scan, so the learner sees all of it. Say which problem on it is theirs.");
	}
}

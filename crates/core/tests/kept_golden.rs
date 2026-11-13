//! Kept cards agree with the window's copy: every case of tests/golden/kept.json (recorded from
//! src/shared/core/kept-view.ts, also replayed by tests/shared/kept-golden.test.ts) is
//! `{ args, result }`. For each quiz call with a keep, the result is null (no kept card) or the
//! sentence, whether its analogy lines and phrase show, and its source mark.

use gs_core::messages::lesson_markers::ANALOGY_DROP;
use gs_core::study::kept::{dropped, has_kept_part, kept_sentences};
use gs_json::{Json, Obj, json, parse, stringify};

#[test]
fn kept_cards_match_the_window() {
	let cases = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/kept.json")).unwrap()).unwrap();
	for case in cases.as_arr().unwrap() {
		let messages = case["output"]["args"]["messages"].as_arr().unwrap();
		let kept = kept_sentences("c", messages);
		let calls = messages.iter().flat_map(|m| m["content"].as_arr().into_iter().flatten()).filter(|b| b["type"].as_str() == Some("toolCall") && b["name"].as_str() == Some("quiz"));
		let got: Obj = calls
			.map(|call| {
				let id = call["id"].as_str().unwrap();
				let card = kept.iter().find(|k| k.sentence["of"]["toolCallId"].as_str() == Some(id)).map_or(Json::Null, |k| {
					let analogy = has_kept_part(messages, id, "analogy") && !dropped(messages, ANALOGY_DROP, id);
					json!({ "text": k.sentence["text"], "analogy": analogy, "phrase": k.sentence.get("phrase").is_some(), "source": k.sentence.get("source").cloned().unwrap_or(Json::Null) })
				});
				(id.to_owned(), card)
			})
			.collect();
		assert_eq!(stringify(&Json::Obj(got)), stringify(&case["output"]["result"]), "{}", case["name"].as_str().unwrap());
	}
}

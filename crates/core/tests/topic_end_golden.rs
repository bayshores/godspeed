//! The stop and opener twins agree with the window's copies: every case of tests/golden/topic_end.json
//! (recorded from src/shared/core/topic-end.ts, also replayed by tests/shared/topic-end-golden.test.ts)
//! is `{ args, result }`, and the Rust output must print the same JSON.

use gs_core::study::topic_end::{lesson_stop, shown_openers};
use gs_json::{Json, parse, stringify};

#[test]
fn stops_and_openers_match_the_window() {
	let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/topic_end.json")).unwrap();
	let cases = parse(&text).unwrap();
	for case in cases.as_arr().unwrap() {
		let name = case["name"].as_str().unwrap();
		let args = &case["output"]["args"];
		let messages = args["messages"].as_arr().unwrap();
		let got = if name.starts_with("lesson_stop:") {
			let tree = Some(&args["tree"]).filter(|t| !t.is_null());
			lesson_stop(messages, tree, args["homework"].as_arr().map(Vec::as_slice)).unwrap_or(Json::Null)
		} else {
			Json::Obj(shown_openers(messages))
		};
		assert_eq!(stringify(&got), stringify(&case["output"]["result"]), "{name}");
	}
}

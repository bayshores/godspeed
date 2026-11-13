//! Topic parts agree with the window's copy: every case of tests/golden/topic_parts.json (recorded
//! from src/shared/core/topic-parts.ts, also replayed by tests/shared/topic-parts-golden.test.ts) is
//! `{ args, result }`, and the Rust output must print the same JSON.

use gs_core::study::topic_parts::topic_parts;
use gs_json::{Json, parse, stringify};

#[test]
fn topic_pages_match_the_window() {
	let cases = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/topic_parts.json")).unwrap()).unwrap();
	for case in cases.as_arr().unwrap() {
		let got = Json::from(topic_parts(case["output"]["args"]["messages"].as_arr().unwrap()));
		assert_eq!(stringify(&got), stringify(&case["output"]["result"]), "{}", case["name"].as_str().unwrap());
	}
}

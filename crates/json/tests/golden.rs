//! Parity with Node: tests/golden/json.json holds what JSON.parse + JSON.stringify gave for each
//! text (recorded from the Node server).

use gs_json::{Json, parse, stringify, stringify_pretty};

#[test]
fn parse_and_stringify_match_node() {
	let golden = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/json.json")).unwrap()).unwrap();
	let cases = golden.as_arr().unwrap();
	assert!(cases.len() > 20);
	for case in cases {
		let name = case["name"].as_str().unwrap();
		let out = &case["output"];
		let text = out["text"].as_str().unwrap();
		let parsed = parse(text);
		if out["error"] == Json::Bool(true) {
			assert!(parsed.is_err(), "{name}: Node refused {text:?}");
			continue;
		}
		let value = parsed.unwrap_or_else(|e| panic!("{name}: {e} for {text:?}"));
		assert_eq!(stringify(&value), out["compact"].as_str().unwrap(), "{name} compact");
		assert_eq!(stringify_pretty(&value, "\t"), out["tab"].as_str().unwrap(), "{name} tab");
		assert_eq!(stringify_pretty(&value, "  "), out["two"].as_str().unwrap(), "{name} two spaces");
	}
}

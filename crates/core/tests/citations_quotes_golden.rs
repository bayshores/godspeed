//! Quoted source marks agree with the window's copy: every case of tests/golden/citations_quotes.json
//! (recorded from src/shared/core/citations.ts, also replayed by
//! tests/shared/citations-quotes-golden.test.ts) is `{ args, result }`, and the Rust output must print
//! the same JSON.

use gs_core::messages::citations::{CiteMark, cites_in_words, file_cite_mark, replace_cite_marks};
use gs_json::{Json, Obj, json, parse, stringify};

/// A mark as the TS object, `quote` only when it has one.
fn mark_json(mark: &CiteMark) -> Json {
	let (mut out, quote) = match mark {
		CiteMark::Passage { passage_id, quote } => (json!({ "kind": "passage", "passageId": passage_id }), quote),
		CiteMark::File { file_id, range, name, quote } => (json!({ "kind": "file", "fileId": file_id, "range": range, "name": name }), quote),
		CiteMark::Web { url } => return json!({ "kind": "web", "url": url }),
	};
	if let (Some(obj), Some(quote)) = (out.as_obj_mut(), quote) {
		obj.insert("quote", quote.as_str());
	}
	out
}

fn read(text: &str) -> (Vec<Json>, String) {
	let mut marks = Vec::new();
	let swapped = replace_cite_marks(text, |mark| {
		marks.push(mark_json(&mark));
		format!("<{}>", marks.len())
	});
	(marks, swapped)
}

#[test]
fn quoted_marks_match_the_window() {
	let cases = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/citations_quotes.json")).unwrap()).unwrap();
	for case in cases.as_arr().unwrap() {
		let (name, args) = (case["name"].as_str().unwrap(), &case["output"]["args"]);
		let mut got = Obj::new();
		if let Some(text) = args["text"].as_str() {
			let (marks, swapped) = read(text);
			got.insert("marks", marks);
			got.insert("swapped", swapped);
			got.insert("words", cites_in_words(text));
		} else {
			let mark = file_cite_mark("f_1a2b3c4d5e6f", "p. 3", args["name"].as_str().unwrap(), args["quote"].as_str());
			got.insert("mark", mark.as_str());
			got.insert("marks", read(&mark).0);
			got.insert("words", cites_in_words(&format!("It frees memory. {mark} Then $x+1$ and `free`.")));
		}
		assert_eq!(stringify(&Json::Obj(got)), stringify(&case["output"]["result"]), "{name}");
	}
}

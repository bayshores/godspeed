//! Parity with Node for source marks and content spans (tests/golden/citations.json, recorded from the Node server).

use gs_core::messages::citations::{CiteMark, cites_in_words, file_cite_mark, replace_cite_marks};
use gs_core::messages::content_reader::{SpanKind, read_content_spans};
use gs_core::session::session_markdown::session_markdown;
use gs_json::{Json, json, parse, stringify};

fn golden(case: &str) -> Json {
	let all = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/citations.json")).unwrap()).unwrap();
	let found = all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(case)).unwrap_or_else(|| panic!("no golden case {case}"));
	assert!(found.get("error").is_none(), "{case}: {:?}", found["error"]);
	found["output"].clone()
}

fn each(case: &str) -> Vec<Json> {
	golden(case).as_arr().unwrap().clone()
}

fn text_of(want: &Json, key: &str) -> String {
	want[key].as_str().unwrap().to_owned()
}

/// A mark as the TS object.
fn mark_json(mark: &CiteMark) -> Json {
	match mark {
		CiteMark::Passage { passage_id, .. } => json!({ "kind": "passage", "passageId": passage_id }),
		CiteMark::File { file_id, range, name, .. } => json!({ "kind": "file", "fileId": file_id, "range": range, "name": name }),
		CiteMark::Web { url } => json!({ "kind": "web", "url": url }),
	}
}

#[test]
fn content_spans() {
	for want in each("content spans") {
		let text = text_of(&want, "text");
		let spans: Json = read_content_spans(&text)
			.into_iter()
			.map(|s| json!([match s.kind { SpanKind::Prose => "prose", SpanKind::Code => "code", SpanKind::Math => "math" }, s.raw]))
			.collect();
		assert_eq!(stringify(&spans), stringify(&want["spans"]), "{text:?}");
	}
}

#[test]
fn marks_read() {
	for want in each("marks read") {
		let text = text_of(&want, "text");
		let mut marks = Vec::new();
		let swapped = replace_cite_marks(&text, |mark| {
			marks.push(mark_json(&mark));
			format!("<{}>", marks.len())
		});
		let got = json!({ "text": text, "marks": marks, "swapped": swapped, "words": cites_in_words(&text) });
		assert_eq!(stringify(&got), stringify(&want), "{text:?}");
	}
}

#[test]
fn stored_marks() {
	for want in each("stored marks") {
		let name = text_of(&want, "name");
		let mark = file_cite_mark("f_1a2b3c4d5e6f", "p. 3", &name, None);
		let words = cites_in_words(&format!("It frees memory. {mark} Then $x+1$ and `free`."));
		assert_eq!(stringify(&json!({ "name": name, "mark": mark, "words": words })), stringify(&want), "{name:?}");
	}
}

#[test]
fn session_export_writes_marks_in_words() {
	let f = "[[f_1a2b3c4d5e6f/p. 12/Week 6 slides.pdf]]";
	let messages = [
		json!({ "id": "u1", "role": "user", "content": format!("Where is this from? {f}"), "timestamp": 0 }),
		json!({ "id": "a1", "role": "assistant", "content": [{ "type": "text", "text": format!("Chunks are cut by page.{f} See [[https://example.com/page]], and [[f_1a2b3c4d5e6f:7]].") }], "stopReason": "stop", "timestamp": 0 }),
		json!({ "id": "a2", "role": "assistant", "content": [{ "type": "toolCall", "id": "c1", "name": "send_to_user", "arguments": { "message": format!("Code `{f}` stays.") } }], "stopReason": "toolUse", "timestamp": 0 }),
	];
	assert_eq!(Json::from(session_markdown(&messages, None)), golden("session export"));
}

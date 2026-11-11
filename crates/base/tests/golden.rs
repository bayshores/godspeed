//! Parity with Node for gs-base's JavaScript helpers (tests/golden/js.json, made by
//! scripts/golden.ts from js.golden.ts in America/Los_Angeles and en-US).

use gs_base::{locale, num, re::Re, text, time};
use gs_json::{Json, parse};

fn golden() -> Json {
	parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/js.json")).unwrap()).unwrap()
}

fn case(name: &str) -> Json {
	golden().as_arr().unwrap().iter().find(|c| c["name"] == Json::from(name)).unwrap()["output"].clone()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

fn i(v: &Json) -> i64 {
	v.as_i64().unwrap()
}

#[test]
fn strings_match_node() {
	let cuts: [(i64, Option<i64>); 8] = [(0, Some(1)), (0, Some(2)), (1, Some(3)), (-1, None), (-3, Some(-1)), (2, Some(1)), (5, Some(99)), (-99, Some(2))];
	for c in case("strings").as_arr().unwrap() {
		let input = s(&c["s"]);
		assert_eq!(text::len16(input) as i64, i(&c["length"]), "{input:?}");
		for (k, (a, b)) in cuts.iter().enumerate() {
			assert_eq!(text::slice16(input, *a, *b), s(&c["slices"][k]), "{input:?} slice {a} {b:?}");
		}
		assert_eq!(text::trim(input), s(&c["trim"][0]));
		assert_eq!(text::trim_start(input), s(&c["trim"][1]));
		assert_eq!(text::trim_end(input), s(&c["trim"][2]));
		let idx = |v: Option<usize>| v.map_or(-1, |n| n as i64);
		assert_eq!(idx(text::index_of16(input, "😀", 0)), i(&c["indexOf"][0]));
		assert_eq!(idx(text::index_of16(input, "z", 0)), i(&c["indexOf"][1]));
		assert_eq!(idx(text::last_index_of16(input, "😀")), i(&c["indexOf"][2]));
		assert_eq!(gs_base::ids::hex(&text::utf8_bytes(input)), s(&c["hex"]), "{input:?} bytes");
	}
}

#[test]
fn numbers_match_node() {
	for c in case("numbers").as_arr().unwrap() {
		let n = c["n"].as_f64().unwrap();
		assert_eq!(num::math_round(n), c["round"].as_f64().unwrap(), "Math.round({n})");
		for d in 0..3 {
			assert_eq!(num::to_fixed(n, d), s(&c["fixed"][d]), "{n}.toFixed({d})");
		}
		assert_eq!(gs_json::js_number(n), s(&c["text"]));
	}
}

#[test]
fn dates_match_node() {
	for c in case("dates").as_arr().unwrap() {
		let d = s(&c["d"]);
		assert_eq!(time::parse_date(d), c["parsed"].as_i64(), "Date.parse({d})");
		if let Some(ms) = time::parse_date(d) {
			assert_eq!(time::iso(ms), s(&c["iso"]));
		}
	}
}

#[test]
fn locale_compare_matches_node() {
	let input: Vec<String> = case("sorted").as_arr().unwrap().iter().map(|v| s(v).to_owned()).collect();
	let mut plain = input.clone();
	plain.sort_by(|a, b| locale::compare(a, b));
	assert_eq!(plain, input);
	let want: Vec<String> = case("sortedNumeric").as_arr().unwrap().iter().map(|v| s(v).to_owned()).collect();
	let mut numeric = input;
	numeric.sort_by(|a, b| locale::compare_numeric(a, b));
	assert_eq!(numeric, want);
}

#[test]
fn regex_matches_node() {
	for c in case("regex").as_arr().unwrap() {
		let (source, flags, input) = (s(&c["source"]), s(&c["flags"]), s(&c["text"]));
		let re = Re::new(source, flags);
		assert_eq!(re.replace(input, s(&c["replacement"])), s(&c["replaced"]), "/{source}/{flags} replace");
		let once = Re::new(source, &flags.replace('g', ""));
		let parts: Vec<Json> = once.split(input).into_iter().map(Json::from).collect();
		assert_eq!(Json::Arr(parts), c["split"], "/{source}/ split");
		assert_eq!(once.test(input), c["test"].as_bool().unwrap());
	}
}

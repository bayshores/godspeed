//! Run examples (mock-run.ts): the program that calls a code question's function on each of its
//! examples, and how what it prints is read. The program is the learner's code with a few lines
//! after it that print one marked line of JSON, so anything the code prints itself stays apart.
//!
//! A run's outcome is `{ examples: [{ returned?, error?, passed }], error?, printed? }`.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_base::text;
use gs_json::{Json, Obj, json, parse, quote, stringify};

use super::mock::MockLanguage;

/// Seconds one run may take.
pub const RUN_SECONDS: u32 = 5;
const PRINTED_MAX: i64 = 2000;
const ERROR_LINES: usize = 12;

/// The file the program is saved as.
pub fn run_file(language: MockLanguage) -> &'static str {
	match language {
		MockLanguage::Javascript => "solution.js",
		MockLanguage::Python => "solution.py",
	}
}

/// What every example says when the learner's code has no such function.
fn no_function_text(name: &str) -> String {
	format!("Your code has no function named {name}.")
}

/// The learner's code, then the lines that call `function` (a question's `fn`) on every example
/// and print the results after `mark`. Only a function the learner's code defines is called,
/// never a built-in of the same name (Python's exec or open, JavaScript's eval): the examples are
/// the teacher's, so a built-in would run them as code the learner never wrote.
pub fn runner_source(code: &str, function: &Json, examples: &[Json], language: MockLanguage, mark: &str) -> String {
	let name = function["name"].str_or_empty();
	let args = stringify(&Json::from(examples.iter().map(|e| e["args"].clone()).collect::<Vec<_>>()));
	let missing = quote(&no_function_text(name));
	if language == MockLanguage::Python {
		return [
			code.to_owned(),
			String::new(),
			"def __godspeed_run():".to_owned(),
			"    import json".to_owned(),
			"    out = []".to_owned(),
			// The module's own names: built-ins live elsewhere.
			format!("    fn = globals().get({})", quote(name)),
			// A JSON string is also a Python string.
			format!("    for args in json.loads({}):", quote(&args)),
			"        if not callable(fn):".to_owned(),
			format!("            out.append({{\"error\": {missing}}})"),
			"            continue".to_owned(),
			"        try:".to_owned(),
			"            out.append({\"returned\": json.dumps(fn(*json.loads(args)))})".to_owned(),
			"        except Exception as err:".to_owned(),
			"            out.append({\"error\": type(err).__name__ + \": \" + str(err)})".to_owned(),
			format!("    print(\"\\n{mark}\" + json.dumps(out))"),
			String::new(),
			"__godspeed_run()".to_owned(),
			String::new(),
		]
		.join("\n");
	}
	// Its own names start with __, which no function name may.
	[
		code.to_owned(),
		";(async () => {".to_owned(),
		"\tconst __out = [];".to_owned(),
		// A global of the same name is a built-in the learner didn't write.
		format!("\tconst __fn = typeof {name} === \"function\" && {name} !== globalThis.{name} ? {name} : null;"),
		format!("\tfor (const __args of {args}) {{"),
		"\t\tif (!__fn) {".to_owned(),
		format!("\t\t\t__out.push({{ error: {missing} }});"),
		"\t\t\tcontinue;".to_owned(),
		"\t\t}".to_owned(),
		"\t\ttry {".to_owned(),
		"\t\t\tconst __text = JSON.stringify(await __fn(...JSON.parse(__args)));".to_owned(),
		"\t\t\t__out.push(__text === undefined ? { error: \"It returned nothing.\" } : { returned: __text });".to_owned(),
		"\t\t} catch (__err) {".to_owned(),
		"\t\t\t__out.push({ error: __err instanceof Error ? `${__err.name}: ${__err.message}` : String(__err) });".to_owned(),
		"\t\t}".to_owned(),
		"\t}".to_owned(),
		format!("\tconsole.log(\"\\n{mark}\" + JSON.stringify(__out));"),
		"})();".to_owned(),
		String::new(),
	]
	.join("\n")
}

/// Two JSON values are the same: object keys in any order, and numbers within rounding of each
/// other.
fn same_value(a: &Json, b: &Json) -> bool {
	match (a, b) {
		(Json::Num(a), Json::Num(b)) => (a - b).abs() <= 1e-9 * 1f64.max(a.abs()).max(b.abs()),
		(Json::Arr(a), Json::Arr(b)) => a.len() == b.len() && a.iter().zip(b).all(|(x, y)| same_value(x, y)),
		(Json::Obj(a), Json::Obj(b)) => a.len() == b.len() && a.iter().all(|(k, v)| b.get(k).is_some_and(|w| same_value(v, w))),
		(Json::Arr(_) | Json::Obj(_), _) | (_, Json::Arr(_) | Json::Obj(_)) => false,
		_ => a == b,
	}
}

fn example_run(raw: &Json, expected: &str) -> Json {
	let Some(returned) = raw.as_obj().and(raw["returned"].as_str()) else {
		let error = raw.as_obj().and(raw["error"].as_str()).unwrap_or("It didn't run.");
		return json!({ "error": error, "passed": false });
	};
	match (parse(returned), parse(expected)) {
		// One spelling for both languages ("[1,2]", never Python's "[1, 2]").
		(Ok(value), Ok(expected)) => json!({ "returned": stringify(&value), "passed": same_value(&value, &expected) }),
		_ => json!({ "returned": returned, "passed": false }),
	}
}

/// What a finished program printed, read: the results after `mark`, each checked against its
/// example, and whatever the code printed before them. With no marked line the code never got to
/// the examples: `stderr`'s last lines say why.
pub fn read_run(stdout: &str, stderr: &str, mark: &str, examples: &[Json]) -> Json {
	static NODE_FRAME: LazyLock<Re> = LazyLock::new(|| Re::new(r"^\s+at .*\bnode:", ""));
	static NODE_VERSION: LazyLock<Re> = LazyLock::new(|| Re::new(r"^Node\.js v", ""));
	let at = stdout.rfind(mark);
	let printed = text::slice16(text::trim(at.map_or(stdout, |at| &stdout[..at])), 0, Some(PRINTED_MAX));
	let results = at.and_then(|at| parse(stdout[at + mark.len()..].split('\n').next().unwrap_or("")).ok());
	let mut outcome = Obj::new();
	match results {
		Some(Json::Arr(list)) => {
			outcome.insert("examples", examples.iter().enumerate().map(|(i, e)| example_run(list.get(i).unwrap_or(&Json::Null), e["expected"].str_or_empty())).collect::<Vec<_>>());
		}
		_ => {
			// Node's own stack frames and version line say nothing about the code.
			let lines: Vec<&str> = stderr.split('\n').filter(|line| !text::trim(line).is_empty() && !NODE_FRAME.test(line) && !NODE_VERSION.test(line)).collect();
			let why = lines[lines.len().saturating_sub(ERROR_LINES)..].join("\n");
			outcome.insert("examples", Json::Arr(Vec::new()));
			outcome.insert("error", if why.is_empty() { "Your code stopped before the examples ran." } else { why.as_str() });
		}
	}
	if !printed.is_empty() {
		outcome.insert("printed", printed);
	}
	Json::Obj(outcome)
}

#[cfg(test)]
mod tests {
	use super::*;

	const MARK: &str = "__mark__";

	fn examples() -> Vec<Json> {
		vec![json!({ "args": "[[1,2],3]", "expected": "[0,1]" }), json!({ "args": "[[\"a\"],0]", "expected": "{\"b\":1.5,\"a\":[1,2]}" })]
	}

	fn function() -> Json {
		json!({ "name": "solve", "params": ["items", "n"] })
	}

	fn printed(results: Json, before: &str) -> String {
		format!("{before}\n{MARK}{}\n", stringify(&results))
	}

	#[test]
	fn the_learners_code_comes_first_so_its_line_numbers_stay_theirs() {
		for language in MockLanguage::ALL {
			let source = runner_source("LINE ONE\nLINE TWO", &function(), &examples(), language, MARK);
			assert!(source.starts_with("LINE ONE\nLINE TWO\n"), "{language:?}");
			assert!(source.contains(MARK), "{language:?}");
		}
	}

	#[test]
	fn the_function_comes_only_from_the_learners_own_names() {
		assert!(runner_source("", &function(), &examples(), MockLanguage::Python, MARK).contains("fn = globals().get(\"solve\")"));
		assert!(runner_source("", &function(), &examples(), MockLanguage::Javascript, MARK).contains("solve !== globalThis.solve ? solve : null"));
	}

	#[test]
	fn the_programs_match_nodes_text() {
		let examples = [json!({ "args": "[1,\"a\"]", "expected": "1" })];
		let function = json!({ "name": "f", "params": ["a", "b"] });
		assert_eq!(
			runner_source("x = 1", &function, &examples, MockLanguage::Python, "M"),
			"x = 1\n\ndef __godspeed_run():\n    import json\n    out = []\n    fn = globals().get(\"f\")\n    for args in json.loads(\"[\\\"[1,\\\\\\\"a\\\\\\\"]\\\"]\"):\n        if not callable(fn):\n            out.append({\"error\": \"Your code has no function named f.\"})\n            continue\n        try:\n            out.append({\"returned\": json.dumps(fn(*json.loads(args)))})\n        except Exception as err:\n            out.append({\"error\": type(err).__name__ + \": \" + str(err)})\n    print(\"\\nM\" + json.dumps(out))\n\n__godspeed_run()\n"
		);
		assert_eq!(
			runner_source("let x;", &function, &examples, MockLanguage::Javascript, "M"),
			"let x;\n;(async () => {\n\tconst __out = [];\n\tconst __fn = typeof f === \"function\" && f !== globalThis.f ? f : null;\n\tfor (const __args of [\"[1,\\\"a\\\"]\"]) {\n\t\tif (!__fn) {\n\t\t\t__out.push({ error: \"Your code has no function named f.\" });\n\t\t\tcontinue;\n\t\t}\n\t\ttry {\n\t\t\tconst __text = JSON.stringify(await __fn(...JSON.parse(__args)));\n\t\t\t__out.push(__text === undefined ? { error: \"It returned nothing.\" } : { returned: __text });\n\t\t} catch (__err) {\n\t\t\t__out.push({ error: __err instanceof Error ? `${__err.name}: ${__err.message}` : String(__err) });\n\t\t}\n\t}\n\tconsole.log(\"\\nM\" + JSON.stringify(__out));\n})();\n"
		);
	}

	#[test]
	fn each_example_is_checked_with_keys_in_any_order_and_pythons_spacing() {
		let run = read_run(&printed(json!([{ "returned": "[0, 1]" }, { "returned": "{\"a\": [1, 2], \"b\": 1.5000000000001}" }]), ""), "", MARK, &examples());
		assert_eq!(run, json!({ "examples": [{ "returned": "[0,1]", "passed": true }, { "returned": "{\"a\":[1,2],\"b\":1.5000000000001}", "passed": true }] }));
	}

	#[test]
	fn a_wrong_one_says_what_it_returned_and_a_thrown_error_is_kept() {
		let run = read_run(&printed(json!([{ "returned": "[1,0]" }, { "error": "TypeError: x is not a function" }]), ""), "", MARK, &examples());
		assert_eq!(run["examples"], json!([{ "returned": "[1,0]", "passed": false }, { "error": "TypeError: x is not a function", "passed": false }]));
		let odd = read_run(&printed(json!([{ "returned": "nope" }, 3]), ""), "", MARK, &examples());
		assert_eq!(odd["examples"], json!([{ "returned": "nope", "passed": false }, { "error": "It didn't run.", "passed": false }]));
	}

	#[test]
	fn what_the_code_printed_itself_stays_apart() {
		let run = read_run(&printed(json!([{ "returned": "[0,1]" }, { "returned": "0" }]), "hello\nworld"), "", MARK, &examples());
		assert_eq!(run["printed"], Json::from("hello\nworld"));
		assert_eq!(run["examples"].as_arr().unwrap().len(), 2);
		assert_eq!(stringify(&run).rsplit_once(',').unwrap().1, "\"printed\":\"hello\\nworld\"}");
	}

	#[test]
	fn with_no_results_the_error_text_leaves_out_nodes_own_frames() {
		let stderr = ["solution.js:2", "  return [", "SyntaxError: Unexpected token", "    at wrapSafe (node:internal/modules/cjs/loader:1888:18)", "", "Node.js v24.0.0"].join("\n");
		assert_eq!(read_run("partial", &stderr, MARK, &examples()), json!({ "examples": [], "error": "solution.js:2\n  return [\nSyntaxError: Unexpected token", "printed": "partial" }));
		assert_eq!(read_run("", "", MARK, &examples())["error"], Json::from("Your code stopped before the examples ran."));
		let long: Vec<String> = (1..=20).map(|i| format!("line {i}")).collect();
		assert_eq!(read_run("", &long.join("\n"), MARK, &examples())["error"], Json::from(long[8..].join("\n")));
	}

	#[test]
	fn code_that_prints_the_results_shape_without_the_mark_fools_nothing() {
		let run = read_run("[{\"returned\":\"[0,1]\"}]\n", "", MARK, &examples());
		assert_eq!(run["examples"], json!([]));
	}

	#[test]
	fn numbers_compare_within_rounding_and_types_must_match() {
		let n = |x: f64| Json::Num(x);
		assert!(same_value(&n(0.1 + 0.2), &n(0.3)));
		assert!(!same_value(&n(1.0), &n(1.001)));
		assert!(!same_value(&json!("1"), &n(1.0)));
		assert!(!same_value(&json!([]), &json!({})));
		assert!(same_value(&json!(null), &json!(null)));
		assert!(!same_value(&json!({ "a": 1 }), &json!({ "a": 1, "b": 2 })));
	}
}

//! pi-ai's `validateToolArguments` (utils/validation.ts) for TypeBox schemas: drop optional
//! nulls, convert loosely, check, and on failure throw pi's error text.

mod check;
mod convert;
mod graphemes;
mod to_number;

use gs_json::{Json, stringify_pretty};

/// The arguments as the tool receives them, or pi's "Validation failed …" text.
pub fn validate_tool_arguments(tool_name: &str, schema: &Json, arguments: &Json) -> Result<Json, String> {
	let failures = match checked(schema, arguments) {
		Ok(args) => return Ok(args),
		Err(failures) => failures,
	};
	let lines: Vec<String> = failures.iter().map(|f| format!("  - {f}")).collect();
	let listed = if lines.is_empty() { "Unknown validation error".to_owned() } else { lines.join("\n") };
	Err(format!("Validation failed for tool \"{tool_name}\":\n{listed}\n\nReceived arguments:\n{}", stringify_pretty(arguments, "  ")))
}

/// What validation finds wrong with the arguments, one `<path>: <message>` line each and without
/// the arguments: for a tool that refuses a call in its own words before validation runs.
pub fn argument_problems(schema: &Json, arguments: &Json) -> Vec<String> {
	match checked(schema, arguments) {
		Ok(_) => Vec::new(),
		Err(failures) if failures.is_empty() => vec!["Unknown validation error".to_owned()],
		Err(failures) => failures,
	}
}

/// pi's order: drop optional nulls, convert loosely, check.
fn checked(schema: &Json, arguments: &Json) -> Result<Json, Vec<String>> {
	let mut args = arguments.clone();
	convert::normalize_optional_nulls(&mut args, schema);
	convert::convert_in_place(schema, &mut args);
	let mut errors = check::Errors::default();
	if check::walk(schema, &args, "", &mut errors) {
		return Ok(args);
	}
	Err(errors.list.iter().map(|f| format!("{}: {}", f.path, f.message)).collect())
}

#[cfg(test)]
mod tests {
	use gs_json::{Json, parse, stringify};

	use super::validate_tool_arguments;

	/// Replays tests/golden/validate.json (pi's own results, recorded from the Node server).
	#[test]
	fn matches_pi() {
		let golden = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/validate.json")).unwrap()).unwrap();
		for case in golden.as_arr().unwrap() {
			let out = &case["output"];
			let got = validate_tool_arguments("t", &out["schema"], &out["args"]);
			let want = match out.get("ok") {
				Some(ok) => Ok(ok.clone()),
				None => Err(out["error"].as_str().unwrap().to_owned()),
			};
			let show = |r: &Result<Json, String>| r.as_ref().map(stringify).unwrap_or_else(Clone::clone);
			assert_eq!(show(&got), show(&want), "case {}", stringify(&case["name"]));
		}
	}
}

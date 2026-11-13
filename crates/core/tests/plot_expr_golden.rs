//! Plot formulas agree with the window's copy: every case of tests/golden/plot_expr.json
//! (recorded from src/shared/core/plot-expr.ts, also replayed by
//! tests/shared/plot-expr-golden.test.ts) is `{ args: { src, names, at }, result }`, where the
//! result is the error line or the values at each `[x, slider]` point ("NaN", "Infinity" and
//! "-Infinity" for values that are not numbers). sin, exp and the like may differ from
//! JavaScript in the last bits, so finite values agree to 12 significant digits.

use gs_core::session::plot_expr::parse_expr;
use gs_json::{Json, parse};

fn shown(value: f64) -> Json {
	if value.is_nan() {
		Json::from("NaN")
	} else if value.is_infinite() {
		Json::from(if value > 0.0 { "Infinity" } else { "-Infinity" })
	} else {
		Json::Num(value)
	}
}

fn agrees(got: &Json, want: &Json) -> bool {
	match (got.as_f64(), want.as_f64()) {
		(Some(g), Some(w)) => (g - w).abs() <= 1e-12 * w.abs().max(1.0),
		_ => got == want,
	}
}

#[test]
fn plot_formulas_match_the_window() {
	let cases = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/plot_expr.json")).unwrap()).unwrap();
	for case in cases.as_arr().unwrap() {
		let (name, args, want) = (case["name"].as_str().unwrap(), &case["output"]["args"], &case["output"]["result"]);
		let names: Vec<&str> = args["names"].as_arr().unwrap().iter().map(|n| n.as_str().unwrap()).collect();
		match parse_expr(args["src"].as_str().unwrap(), &names) {
			Err(error) => assert_eq!(Some(error.as_str()), want["error"].as_str(), "{name}"),
			Ok(expr) => {
				let wanted = want["values"].as_arr().unwrap_or_else(|| panic!("{name}: parsed, but the window refused it"));
				for (at, wanted) in args["at"].as_arr().unwrap().iter().zip(wanted) {
					let point: Vec<f64> = at.as_arr().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
					let got = shown(expr.eval(&point));
					assert!(agrees(&got, wanted), "{name} at {point:?}: {got:?} against {wanted:?}");
				}
			}
		}
	}
}

use std::sync::Arc;

use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux::Scripted;
use gs_json::{Json, json, stringify};
use parking_lot::Mutex;

use super::*;
use crate::subagents::test_support::{FakeHeadless, calls, job_agent_options, reply_seeing, result_texts, says};

const SVG: &str = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 120 60\">\n  <rect x=\"5\"/>\n  <rect x=\"45\"/>\n  <circle r=\"10\" fill=\"red\"/>\n</svg>";

fn ok_demo() -> Result<crate::subagents::headless::DemoRunResult, String> {
	Ok(Default::default())
}

#[tokio::test]
async fn a_looked_at_figure_is_delivered_with_notes() {
	let script = Scripted::new();
	let seen = Arc::new(Mutex::new(Vec::new()));
	script.reply(calls(&[("write_svg", json!({ "svg": SVG }))]));
	reply_seeing(&script, calls(&[("render_svg", json!({}))]), &seen);
	reply_seeing(&script, says("  Two boxes and a dot.  "), &seen);
	let (opts, lines) = job_agent_options(&script, FakeHeadless::new(ok_demo()));
	let result = run_visual_maker("  Two boxes and a dot.\nSecond line", &opts).await;
	assert_eq!(result, json!({ "svg": SVG, "notes": "Two boxes and a dot." }));
	let seen = seen.lock();
	assert_eq!(result_texts(&seen[0]), vec!["Saved (131 bytes). Call render_svg to look at it."]);
	let last = seen[1].last().unwrap();
	assert_eq!(last["content"][0]["text"], Json::from(LOOK_MESSAGE));
	assert_eq!(last["content"][1]["mimeType"], Json::from("image/png"));
	assert_eq!(*lines.lock(), vec!["write_svg: 0.1 KB", "render_svg: inspecting render"]);
}

#[tokio::test]
async fn finishing_unlooked_shows_the_render_first() {
	let script = Scripted::new();
	let seen = Arc::new(Mutex::new(Vec::new()));
	script.reply(calls(&[("write_svg", json!({ "svg": SVG })), ("edit_svg", json!({ "old_text": "r=\"10\"", "new_text": "r=\"$&$$10\"" }))]));
	script.reply(says("Done."));
	reply_seeing(&script, says(""), &seen);
	let (opts, lines) = job_agent_options(&script, FakeHeadless::new(ok_demo()));
	let result = run_visual_maker("x", &opts).await;
	assert_eq!(result, json!({ "svg": SVG.replace("r=\"10\"", "r=\"$&$$10\"") }), "an empty final text leaves notes out");
	let last = seen.lock()[0].last().unwrap().clone();
	assert_eq!(last["content"][0]["text"], Json::from(UNLOOKED_FINISH_MESSAGE));
	assert_eq!(lines.lock().last().unwrap(), "render_svg: inspecting final render");
}

#[tokio::test]
async fn every_tool_error_text() {
	let script = Scripted::new();
	let seen = Arc::new(Mutex::new(Vec::new()));
	script.reply(calls(&[
		("edit_svg", json!({ "old_text": "a", "new_text": "b" })),
		("render_svg", json!({})),
		("write_svg", json!({ "svg": "just words" })),
		("write_svg", json!({ "svg": 5 })),
		("write_svg", json!({ "svg": SVG })),
		("edit_svg", json!({ "old_text": "<rect", "new_text": "x" })),
		("edit_svg", json!({ "old_text": "rect x=\"450\"", "new_text": "y" })),
		("edit_svg", json!({ "old_text": "", "new_text": "y" })),
		("edit_svg", json!({ "old_text": "   ", "new_text": "y" })),
		("draw", json!({})),
		("write_svg", json!({ "svg": "<svg>broken</svg>" })),
		("render_svg", json!({})),
	]));
	reply_seeing(&script, says("Gave up."), &seen);
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(ok_demo()));
	let result = run_visual_maker("x", &opts).await;
	assert_eq!(result, json!({ "svg": "", "notes": "FAILED: rendering the final SVG failed: bad svg" }));
	let texts = result_texts(&seen.lock()[0]);
	assert_eq!(
		texts,
		vec![
			"ERROR: nothing to edit — call write_svg first.",
			"ERROR: nothing to render — call write_svg first.",
			"ERROR: expected a complete <svg>…</svg> document in the `svg` field.",
			"ERROR: expected a complete <svg>…</svg> document in the `svg` field.",
			"Saved (131 bytes). Call render_svg to look at it.",
			"ERROR: old_text appears 2 times — it must match EXACTLY ONCE. Include more surrounding context to make it unique.",
			"ERROR: old_text not found. Closest line for reference:\n1 | <svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 120 60\">\n2 |   <rect x=\"5\"/>\n3 |   <rect x=\"45\"/>",
			"ERROR: expected old_text (non-empty) and new_text strings.",
			"ERROR: old_text not found. Closest line for reference:\n(empty old_text)",
			"ERROR: unknown tool \"draw\". Use write_svg, edit_svg, or render_svg.",
			"Saved (17 bytes). Call render_svg to look at it.",
			"RENDER ERROR (the SVG may be malformed): bad svg. Fix it with write_svg and render again.",
		]
	);
	let errors: Vec<bool> = seen.lock()[0].iter().filter(|m| m["role"] == Json::from("toolResult")).map(|m| m["isError"] == Json::from(true)).collect();
	assert_eq!(errors, vec![true, true, true, true, false, true, true, true, true, true, false, true]);
}

#[tokio::test]
async fn the_iteration_limit_keeps_only_a_looked_at_svg() {
	let script = Scripted::new();
	script.reply(calls(&[("write_svg", json!({ "svg": SVG })), ("render_svg", json!({}))]));
	for _ in 0..7 {
		script.reply(calls(&[("render_svg", json!({}))]));
	}
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(ok_demo()));
	assert_eq!(run_visual_maker("x", &opts).await, json!({ "svg": SVG, "notes": "Iteration limit reached — delivering the last verified SVG." }));

	let script = Scripted::new();
	for _ in 0..8 {
		script.reply(calls(&[("edit_svg", json!({ "old_text": "a", "new_text": "b" }))]));
	}
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(ok_demo()));
	assert_eq!(run_visual_maker("x", &opts).await, json!({ "svg": "", "notes": "FAILED: iteration limit (8) reached without a verified SVG." }));
}

#[tokio::test]
async fn no_svg_unavailable_and_crashes_fail() {
	let script = Scripted::new();
	script.reply(says(&"n".repeat(400)));
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(ok_demo()));
	let result = run_visual_maker("", &opts).await;
	assert_eq!(result["notes"], Json::from(format!("FAILED: the maker never wrote an SVG. ({})", "n".repeat(300))));

	let fake = FakeHeadless { unavailable: Some("no engine".to_owned()), demo: ok_demo(), demo_runs: Mutex::new(Vec::new()) };
	let (opts, _) = job_agent_options(&script, Arc::new(fake));
	assert_eq!(run_visual_maker("x", &opts).await, json!({ "svg": "", "notes": "FAILED: no engine" }));

	let script = Scripted::new();
	script.run(|_| Box::pin(async { Err("rate limited".to_owned()) }));
	let (opts, _) = job_agent_options(&script, FakeHeadless::new(ok_demo()));
	assert_eq!(stringify(&run_visual_maker("x", &opts).await), r#"{"svg":"","notes":"FAILED: the maker crashed: rate limited"}"#);

	let script = Scripted::new();
	script.reply(says("too late"));
	let (mut opts, _) = job_agent_options(&script, FakeHeadless::new(ok_demo()));
	let abort = Abort::new();
	abort.abort();
	opts.abort_signal = Some(abort);
	assert_eq!(run_visual_maker("x", &opts).await["notes"], Json::from("FAILED: the maker crashed: aborted"));
}

#[test]
fn snippets_point_at_the_closest_line() {
	assert_eq!(snippet_around("a\nb c\nd", "c x"), "1 | a\n2 | b c\n3 | d");
	assert_eq!(snippet_around("only", "zzz"), "1 | only");
	assert_eq!(snippet_around("a\nb\nc\nd", "d"), "3 | c\n4 | d");
}

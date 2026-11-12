//! Runs what the server asks the shell's browser to do: a demo check or an SVG snapshot, each in
//! a hidden view of its own. The scripts a demo page runs, the loopback rules and the result are
//! the same on every system.

use std::time::Duration;

use gs_shell_rpc::DemoResult;
use serde_json::Value;

#[cfg(target_os = "macos")]
pub use crate::mac::demo::{run, svg};

#[cfg(not(target_os = "macos"))]
pub use crate::demo_webview::{run, svg};

pub struct DemoJob {
	pub html: String,
	/// A script whose value comes back as the probe result.
	pub probe: Option<String>,
}

/// Draw `svg` as a PNG of exactly `width` × `height` px.
pub struct SvgJob {
	pub svg: String,
	pub width: u32,
	pub height: u32,
}

pub type DemoDone = Box<dyn FnOnce(Result<DemoResult, String>) + Send>;
pub type SvgDone = Box<dyn FnOnce(Result<Vec<u8>, String>) + Send>;

/// The page's origin on the Mac and Linux: an https one, so a demo gets localStorage and real
/// error messages, and one that can never resolve.
#[cfg(not(windows))]
pub const ORIGIN: &str = "https://demo.invalid/";

/// A demo's page size.
pub const DEMO_SIZE: (u32, u32) = (800, 600);

/// How long a page gets to load, and the page error when it runs out.
pub const LOAD_LIMIT: Duration = Duration::from_secs(30);
pub const LOAD_TIMED_OUT: &str = "Navigation timeout of 30000 ms exceeded";

/// How long a loaded demo runs (animations, async CDN loads) before it is read.
pub const SETTLE: Duration = Duration::from_secs(2);

/// A page stuck in a loop never answers; this keeps the queue moving.
pub const ANSWER_LIMIT: Duration = Duration::from_secs(15);
pub const NO_ANSWER: &str = "the page did not answer within 15 s";
pub const NO_SNAPSHOT: &str = "the SVG snapshot did not finish within 15 s";

/// Records what a demo gets wrong (console errors, uncaught errors, failed loads), from
/// document start in the page's own world.
pub const RECORDER: &str = r#"(() => {
  const rec = { consoleErrors: [], pageErrors: [], failedRequests: [] };
  const push = (k, m) => { if (rec[k].length < 50) rec[k].push(String(m).slice(0, 500)); };
  const fmt = (a) => a.map((x) => { try { return x instanceof Error ? x.message : typeof x === "object" ? JSON.stringify(x) : String(x); } catch { return String(x); } }).join(" ");
  const ce = console.error.bind(console);
  console.error = (...a) => { push("consoleErrors", fmt(a)); ce(...a); };
  addEventListener("error", (e) => {
    if (e instanceof ErrorEvent) push("pageErrors", e.message || String(e.error));
    else { const t = e.target, u = t && (t.currentSrc || t.src || t.href); if (u) push("failedRequests", u + " (" + String(t.tagName).toLowerCase() + " failed to load)"); }
  }, true);
  addEventListener("unhandledrejection", (e) => push("pageErrors", "Uncaught (in promise) " + ((e.reason && e.reason.message) || e.reason)));
  const f = window.fetch;
  window.fetch = function (input, init) {
    const u = typeof input === "string" ? input : (input && input.url) || String(input);
    return f.call(this, input, init).catch((err) => { push("failedRequests", u + " (" + err + ")"); throw err; });
  };
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...r) { this.__u = u; return XO.call(this, m, u, ...r); };
  XMLHttpRequest.prototype.send = function (...a) { this.addEventListener("error", () => push("failedRequests", this.__u + " (xhr error)")); return XS.apply(this, a); };
  Object.defineProperty(window, "__gsDemoReport", { value: () => JSON.stringify(rec) });
})();"#;

/// The body of an async function that runs the probe (an expression or statements; a promise is
/// awaited) and reads the record. `probeSource` is only a string when there is a probe.
pub const READ: &str = r#"let probe;
if (typeof probeSource === "string") {
  try { probe = { json: JSON.stringify(await (0, eval)(probeSource)) }; }
  catch (e) { probe = { error: String((e && e.message) || e) }; }
}
const read = window.__gsDemoReport;
return JSON.stringify({ report: read ? JSON.parse(read()) : null, probe });"#;

/// WebKit content blockers have no alternation, so one rule per host shape. Each allows a user
/// name before the host, which WebKit keeps in the URL; localhost covers its subdomains and a
/// trailing dot, which resolve to this machine too; and `[::` is every IPv6 form of it
/// (`[::1]`, `[::]`, IPv4 inside IPv6), since no public address starts with `::`. Windows checks
/// the same hosts in code (win/demo.rs).
#[cfg(not(windows))]
pub const BLOCK_LOOPBACK: &str = r#"[
 {"trigger":{"url-filter":"^[a-z]+://([^/]*@)?127\\."},"action":{"type":"block"}},
 {"trigger":{"url-filter":"^[a-z]+://([^/]*@)?([^/]*\\.)?localhost\\.?[:/]"},"action":{"type":"block"}},
 {"trigger":{"url-filter":"^[a-z]+://([^/]*@)?\\[::"},"action":{"type":"block"}},
 {"trigger":{"url-filter":"^[a-z]+://([^/]*@)?0\\.0\\.0\\.0"},"action":{"type":"block"}}
]"#;

/// The SVG alone on a white page, so transparent areas come out white.
pub fn svg_page(svg: &str) -> String {
	format!(
		r#"<!doctype html><html><head><meta charset="utf-8"><style>html,body{{margin:0;padding:0;background:#fff}}svg{{display:block}}</style></head><body>{svg}</body></html>"#
	)
}

/// The run's result from what the page recorded (`answer`, the JSON from READ) and the errors
/// it could not record itself (it never loaded, or never answered).
pub fn result(answer: Option<&str>, mut errors: Vec<String>) -> DemoResult {
	let answer: Value = answer.and_then(|text| serde_json::from_str(text).ok()).unwrap_or_default();
	let list = |key: &str| -> Vec<String> {
		answer["report"][key].as_array().map(|items| items.iter().filter_map(|item| item.as_str().map(str::to_owned)).collect()).unwrap_or_default()
	};
	let mut result = DemoResult { console_errors: list("consoleErrors"), page_errors: list("pageErrors"), failed_requests: list("failedRequests"), ..DemoResult::default() };
	result.page_errors.append(&mut errors);
	let probe = &answer["probe"];
	if let Some(err) = probe["error"].as_str() {
		result.page_errors.push(format!("probe failed: {err}"));
	}
	// A probe whose value was undefined comes back without `json`, and stays absent.
	result.probe_result = probe["json"].as_str().and_then(|json| serde_json::from_str(json).ok());
	result.ok = result.console_errors.is_empty() && result.page_errors.is_empty() && result.failed_requests.is_empty();
	result
}

#[cfg(test)]
mod tests {
	use serde_json::json;

	use super::*;

	#[test]
	fn the_result_holds_what_the_page_recorded_and_what_it_could_not() {
		let answer = json!({
			"report": { "consoleErrors": ["a"], "pageErrors": ["b"], "failedRequests": ["c"] },
			"probe": { "json": "{\"n\":1}" },
		})
		.to_string();
		let result = super::result(Some(&answer), vec!["the page did not answer within 15 s".to_owned()]);
		assert_eq!(result.console_errors, ["a"]);
		assert_eq!(result.page_errors, ["b", "the page did not answer within 15 s"]);
		assert_eq!(result.failed_requests, ["c"]);
		assert_eq!(result.probe_result, Some(json!({ "n": 1 })));
		assert!(!result.ok);
	}

	#[test]
	fn a_failed_probe_is_a_page_error_and_an_undefined_one_stays_absent() {
		let failed = json!({ "report": { "consoleErrors": [], "pageErrors": [], "failedRequests": [] }, "probe": { "error": "nope" } }).to_string();
		let result = super::result(Some(&failed), Vec::new());
		assert_eq!(result.page_errors, ["probe failed: nope"]);
		assert_eq!(result.probe_result, None);
		let undefined = json!({ "report": { "consoleErrors": [], "pageErrors": [], "failedRequests": [] }, "probe": {} }).to_string();
		assert_eq!(super::result(Some(&undefined), Vec::new()), DemoResult { ok: true, ..DemoResult::default() });
	}

	#[test]
	fn a_page_that_never_answered_has_only_the_errors_around_it() {
		let result = super::result(None, vec!["Navigation timeout of 30000 ms exceeded".to_owned()]);
		assert_eq!(result.page_errors, ["Navigation timeout of 30000 ms exceeded"]);
		assert!(!result.ok);
	}
}

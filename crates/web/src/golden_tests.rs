//! web_fetch against the answers recorded from the TypeScript (tests/golden/web.json, made by
//! `npx tsx scripts/golden.ts web`), served from tests/fixtures by a local server.

use std::collections::HashMap;
use std::path::PathBuf;

use gs_json::{Json, parse};

use crate::fetch::extract;
use crate::test_server::{Route, serve};

fn dir(name: &str) -> PathBuf {
	PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join(name)
}

fn read(path: PathBuf) -> String {
	std::fs::read_to_string(path).unwrap()
}

fn route_from(spec: &Json) -> Route {
	let mut body = Vec::new();
	if let Some(file) = spec["file"].as_str() {
		body = std::fs::read(dir("fixtures").join(file)).unwrap();
	}
	if let Some(hex) = spec["hex"].as_str() {
		body = (0..hex.len()).step_by(2).map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap()).collect();
	}
	if spec["bom"].truthy() {
		body.splice(0..0, [0xEF, 0xBB, 0xBF]);
	}
	let mut headers = Vec::new();
	if let Some(kind) = spec["type"].as_str() {
		headers.push(("Content-Type".to_owned(), kind.to_owned()));
	}
	if let Some(extra) = spec["headers"].as_obj() {
		headers.extend(extra.iter().map(|(k, v)| (k.to_owned(), v.as_str().unwrap().to_owned())));
	}
	Route {
		status: spec["status"].as_i64().unwrap_or(200) as u16,
		reason: spec["reason"].as_str().unwrap_or("OK").to_owned(),
		headers,
		body,
		content_length: spec["contentLength"].as_i64().map(|n| n as usize),
	}
}

/// The reader service's requests carry the page address; the route is `/__jina` plus its path.
fn route_key(path: &str) -> String {
	let Some(rest) = path.strip_prefix("/__jina/") else { return path.to_owned() };
	let after_scheme = rest.split_once("://").map_or(rest, |(_, r)| r);
	format!("/__jina{}", after_scheme.find('/').map_or("", |i| &after_scheme[i..]))
}

/// Where htmd prints something other than Turndown, as (Turndown's text, htmd's text). The page
/// /edges holds only these; every other page must match exactly.
const KNOWN_DIFFERENCES: &[(&str, &str)] = &[
	// htmd escapes a `<` that opens something tag-like.
	("use <angle> marks and a <b> tag name, plus 1 < 2 and a </closing> tag", "use \\<angle> marks and a \\<b> tag name, plus 1 < 2 and a \\</closing> tag"),
	// An empty link leaves no word break for Turndown.
	("[](/z)before", "[](/z) before"),
	("row:[](/prev)[](/next)", "row: [](/prev) [](/next)"),
	// Turndown drops the space that starts the source line after a `<br>`.
	("  \nthen a new source line", "  \n then a new source line"),
	// Turndown escapes `-` at the start of any text node, and `~` only as `~~~`.
	("_~/projects_ and a range _n_\\-_i_", "_\\~/projects_ and a range _n_-_i_"),
	// Turndown escapes text in a `<pre>` without `<code>`, and prints a code block's text without links.
	("bare pre with \\*stars\\*, \\[brackets\\] and snake\\_case", "bare pre with *stars*, [brackets] and snake_case"),
	("let x: Vec<T>;", "let x: Vec<[T](/t)>;"),
	// Turndown keeps whitespace-only lines inside a list item with several blocks.
	("paragraph.\n    \n    And a second paragraph inside the item.\n    \n*", "paragraph.\n\n    And a second paragraph inside the item.\n\n*"),
	("code block:\n    \n    ```", "code block:\n\n    ```"),
	("    ```\n    \n\n1.", "    ```\n\n1."),
	// Turndown keeps the two trailing spaces of a line break inside a list item.
	("a break  \n    inside", "a break\n    inside"),
	// Turndown always writes an ordered item as `N.` and two spaces; htmd aligns to the widest number.
	(
		"1.  One\n2.  Two\n3.  Three\n4.  Four\n5.  Five\n6.  Six\n7.  Seven\n8.  Eight\n9.  Nine\n10.  Ten\n11.  Eleven",
		"1.   One\n2.   Two\n3.   Three\n4.   Four\n5.   Five\n6.   Six\n7.   Seven\n8.   Eight\n9.   Nine\n10.  Ten\n11.  Eleven",
	),
	// Turndown only widens a fence for backticks at the start of a line.
	("```\na fence ``` inside a line\n```", "````\na fence ``` inside a line\n````"),
	// Turndown escapes a leading `---`, and not a run of seven `#`.
	("\\--- three dashes", "--- three dashes"),
	("\n####### seven", "\n\\####### seven"),
];

/// Turndown's text for /edges with the known differences applied.
fn as_htmd_prints(turndown: &str) -> String {
	KNOWN_DIFFERENCES.iter().fold(turndown.to_owned(), |text, (from, to)| {
		assert!(text.contains(from), "the difference {from:?} no longer applies");
		text.replace(from, to)
	})
}

fn line_diff(want: &str, got: &str) -> String {
	let (want, got): (Vec<_>, Vec<_>) = (want.split('\n').collect(), got.split('\n').collect());
	let mut out = Vec::new();
	for i in 0..want.len().max(got.len()) {
		let (w, g) = (want.get(i).copied().unwrap_or("<none>"), got.get(i).copied().unwrap_or("<none>"));
		if w != g {
			out.push(format!("line {}: want {w:?}\n         got  {g:?}", i + 1));
		}
	}
	out.join("\n")
}

#[tokio::test]
async fn web_fetch_matches_the_typescript() {
	let manifest = parse(&read(dir("fixtures").join("routes.json"))).unwrap();
	let routes: HashMap<String, Route> = manifest.as_obj().unwrap().iter().map(|(k, v)| (k.to_owned(), route_from(v))).collect();
	let server = serve(move |path| routes.get(&route_key(path)).cloned()).await;

	let golden = parse(&read(dir("golden").join("web.json"))).unwrap();
	let mut wrong = Vec::new();
	for case in golden.as_arr().unwrap() {
		let name = case["name"].as_str().unwrap();
		let url = if name.starts_with('/') { format!("{}{name}", server.origin) } else { "http://127.0.0.1:1/".to_owned() };
		let got = match extract(&url, &format!("{}/__jina/", server.origin)).await {
			Ok(text) => text,
			Err(message) => format!("web_fetch failed for {url}: {message}"),
		};
		let got = got.replace(&server.origin, "http://127.0.0.1:PORT");
		let want = case["output"].as_str().unwrap();
		let want = if name == "/edges" { as_htmd_prints(want) } else { want.to_owned() };
		if got != want {
			wrong.push(format!("--- {name}\n{}", line_diff(&want, &got)));
		}
	}
	assert!(wrong.is_empty(), "{} cases differ\n{}", wrong.len(), wrong.join("\n"));
}

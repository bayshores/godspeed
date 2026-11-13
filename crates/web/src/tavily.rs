//! Tavily, the one search service the person can give godspeed a key for: a basic search (one
//! credit) for the research job, and the key's usage numbers (free) for Settings. The key is
//! sent only to api.tavily.com.

use std::time::Duration;

use gs_json::{Json, json, parse, stringify};
use reqwest::{Client, RequestBuilder};

const SEARCH_URL: &str = "https://api.tavily.com/search";
const USAGE_URL: &str = "https://api.tavily.com/usage";
const TIMEOUT: Duration = Duration::from_secs(30);

/// Five results with these cuts stay near 700 tokens.
const MAX_RESULTS: usize = 5;
const TITLE_CHARS: usize = 120;
const SNIPPET_CHARS: usize = 360;

#[derive(Debug, PartialEq)]
pub enum Failure {
	/// HTTP 401: the key is wrong or was revoked.
	KeyRefused,
	/// HTTP 432 or 433: the plan's or the pay-as-you-go limit is used up.
	OutOfSearches,
	/// HTTP 429: too many requests for now.
	Busy,
	/// No answer at all (offline, DNS, timeout).
	Unreachable,
	/// Any other status.
	Status(u16),
}

/// The account's searches this month, from the usage endpoint.
#[derive(Debug, PartialEq)]
pub struct Usage {
	pub used: Option<i64>,
	pub limit: Option<i64>,
}

/// Searches for `query` and gives up to five results as short text for the agent.
pub async fn search(key: &str, query: &str) -> Result<String, Failure> {
	let body = stringify(&json!({ "query": query, "max_results": MAX_RESULTS }));
	let answer = send(client()?.post(SEARCH_URL).bearer_auth(key).header("Content-Type", "application/json").body(body)).await?;
	Ok(results_text(&answer, query))
}

/// The key's usage. Asking costs nothing, so Settings uses it to check a key too.
pub async fn usage(key: &str) -> Result<Usage, Failure> {
	let answer = send(client()?.get(USAGE_URL).bearer_auth(key)).await?;
	Ok(usage_from(&answer))
}

fn client() -> Result<Client, Failure> {
	Client::builder().timeout(TIMEOUT).build().map_err(|_| Failure::Unreachable)
}

async fn send(request: RequestBuilder) -> Result<Json, Failure> {
	let response = request.send().await.map_err(|_| Failure::Unreachable)?;
	let status = response.status().as_u16();
	if status != 200 {
		return Err(failure_for(status));
	}
	let text = response.text().await.map_err(|_| Failure::Unreachable)?;
	parse(&text).map_err(|_| Failure::Status(status))
}

fn failure_for(status: u16) -> Failure {
	match status {
		401 => Failure::KeyRefused,
		432 | 433 => Failure::OutOfSearches,
		429 => Failure::Busy,
		_ => Failure::Status(status),
	}
}

/// The plan's numbers: a key's own limit is usually unset.
fn usage_from(answer: &Json) -> Usage {
	let account = &answer["account"];
	Usage { used: account["plan_usage"].as_i64(), limit: account["plan_limit"].as_i64() }
}

/// Numbered results: title, address, then the snippet on one line (an empty one left out).
fn results_text(answer: &Json, query: &str) -> String {
	let results: Vec<String> = answer["results"]
		.as_arr()
		.map(Vec::as_slice)
		.unwrap_or_default()
		.iter()
		.filter_map(|result| {
			let url = result["url"].as_str().filter(|url| !url.is_empty())?;
			let title = cut(result["title"].as_str().unwrap_or_default(), TITLE_CHARS);
			let snippet = cut(result["content"].as_str().unwrap_or_default(), SNIPPET_CHARS);
			Some([title.as_str(), url, snippet.as_str()].into_iter().filter(|line| !line.is_empty()).collect::<Vec<_>>().join("\n"))
		})
		.take(MAX_RESULTS)
		.enumerate()
		.map(|(i, result)| format!("{}. {result}", i + 1))
		.collect();
	if results.is_empty() {
		return format!("No results for \"{query}\". Try other words.");
	}
	results.join("\n\n")
}

/// `text` on one line, cut at a word break to at most `max` characters plus "...".
fn cut(text: &str, max: usize) -> String {
	let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
	if line.chars().count() <= max {
		return line;
	}
	let head: String = line.chars().take(max).collect();
	let head = head.rfind(' ').map_or(head.as_str(), |space| &head[..space]);
	format!("{}...", head.trim_end_matches([',', ';', ':', '.']))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn statuses_become_failures_the_agent_can_act_on() {
		assert_eq!(failure_for(401), Failure::KeyRefused);
		assert_eq!(failure_for(432), Failure::OutOfSearches);
		assert_eq!(failure_for(433), Failure::OutOfSearches);
		assert_eq!(failure_for(429), Failure::Busy);
		assert_eq!(failure_for(500), Failure::Status(500));
	}

	#[test]
	fn usage_reads_the_plan_numbers() {
		let answer = parse(r#"{"key":{"usage":3,"limit":null},"account":{"current_plan":"Researcher","plan_usage":412,"plan_limit":1000}}"#).unwrap();
		assert_eq!(usage_from(&answer), Usage { used: Some(412), limit: Some(1000) });
		assert_eq!(usage_from(&parse("{}").unwrap()), Usage { used: None, limit: None });
	}

	#[test]
	fn results_are_numbered_with_title_address_and_snippet() {
		let answer = parse(
			r#"{"results":[
				{"title":"Binary search","url":"https://en.wikipedia.org/wiki/Binary_search","content":"In computer science,\n binary search  finds a target.","score":0.9},
				{"title":"","url":"https://example.com/b","content":""},
				{"title":"No address","url":""}
			]}"#,
		)
		.unwrap();
		assert_eq!(
			results_text(&answer, "binary search"),
			"1. Binary search\nhttps://en.wikipedia.org/wiki/Binary_search\nIn computer science, binary search finds a target.\n\n2. https://example.com/b"
		);
		assert_eq!(results_text(&parse(r#"{"results":[]}"#).unwrap(), "zzz"), "No results for \"zzz\". Try other words.");
	}

	#[test]
	fn ten_long_results_shrink_to_five_short_ones() {
		let long = "word ".repeat(400);
		let results: Vec<Json> = (0..10).map(|i| json!({ "title": long, "url": format!("https://example.com/a/fairly/long/path/to/page-{i}"), "content": long })).collect();
		let text = results_text(&json!({ "results": results }), "q");
		assert!(text.starts_with("1. ") && text.contains("\n\n5. ") && !text.contains("\n\n6. "), "{text}");
		// About 700 tokens at four characters a token.
		assert!(text.chars().count() <= 3_000, "{}", text.chars().count());
		assert!(text.lines().all(|line| line.chars().count() <= SNIPPET_CHARS + 3));
	}

	#[test]
	fn cuts_fall_on_word_breaks() {
		assert_eq!(cut("short", 10), "short");
		assert_eq!(cut("one two three four", 12), "one two...");
		assert_eq!(cut("first, second", 9), "first...");
		assert_eq!(cut("\u{e9}\u{e9}\u{e9}\u{e9} \u{e9}\u{e9}", 5), "\u{e9}\u{e9}\u{e9}\u{e9}...");
	}
}

//! The researcher's web tools. Like every tool here they never fail the run: a failure comes
//! back as text the researcher can adapt to.

use std::sync::Arc;

use gs_core::session::work_pages::{WORK_PAGE_BYTES, split_pages};
use gs_engine::turn::abort::Abort;
use gs_engine::turn::tool::Tool;
use gs_json::Json;
use gs_web::fetch::{fetch_and_extract, is_http_url};
use gs_web::tavily::{self, Failure};

use crate::tools::fn_tool::FnTool;
use gs_core::session::schema::{self, string};

/// What a stopped fetch says (the guard's abort or its timeout).
pub(super) const ABORTED: &str = "This operation was aborted";

pub fn web_tools() -> Vec<Arc<dyn Tool>> {
	vec![FnTool::server(
		"web_fetch",
		"Fetch a web page and extract its readable content as markdown (Readability). Handles HTML pages and plain text; JS-rendered pages fall back to a reader service.".to_owned(),
		schema::object(&["url"], vec![("url", string("The URL to fetch"))]),
		|args, ctx| async move {
			let url = args["url"].as_str().unwrap_or_default().to_owned();
			if !is_http_url(&url) {
				return Ok(Json::Str(format!("web_fetch failed: invalid URL \"{url}\"")));
			}
			Ok(Json::Str(match until_aborted(&ctx.abort, fetch_and_extract(&url)).await {
				Ok(text) => truncate(&text),
				Err(message) => format!("web_fetch failed for {url}: {message}"),
			}))
		},
	).into_arc()]
}

/// Tavily search with the person's key, for the research job while a key is saved.
pub fn web_search_tool(key: String) -> Arc<dyn Tool> {
	FnTool::server(
		"web_search",
		"Search the web. Returns up to 5 results, each a title, an address and a short snippet. Read a result with web_fetch.".to_owned(),
		schema::object(&["query"], vec![("query", string("What to search for"))]),
		move |args, ctx| {
			let key = key.clone();
			async move {
				let query = args["query"].as_str().map(str::trim).unwrap_or_default().to_owned();
				if query.is_empty() {
					return Ok(Json::Str("web_search failed: the query is empty".to_owned()));
				}
				let searched = until_aborted(&ctx.abort, async { tavily::search(&key, &query).await.map_err(|failure| failure_text(&failure)) }).await;
				Ok(Json::Str(searched.unwrap_or_else(|why| format!("web_search failed: {why}"))))
			}
		},
	)
	.into_arc()
}

/// Why a search failed, and what to do instead.
fn failure_text(failure: &Failure) -> String {
	let why = match failure {
		Failure::KeyRefused => "Tavily refused the search key.".to_owned(),
		Failure::OutOfSearches => "The search key is out of searches for now.".to_owned(),
		Failure::Busy => "Tavily is busy, so web_search may work again later.".to_owned(),
		Failure::Unreachable => "Tavily could not be reached.".to_owned(),
		Failure::Status(status) => format!("Tavily answered HTTP {status}."),
	};
	format!("{why} Carry on with your own web search if you have one, or with addresses you know exist.")
}

/// `work`, unless the abort fires first.
pub(super) async fn until_aborted<T>(abort: &Abort, work: impl std::future::Future<Output = Result<T, String>>) -> Result<T, String> {
	tokio::select! {
		biased;
		result = work => result,
		() = abort.aborted() => Err(ABORTED.to_owned()),
	}
}

/// At most one work page: the result reaches the outside agent inside a work item, and every
/// page past the first costs it a read_work call.
fn truncate(text: &str) -> String {
	let pages = split_pages(text, WORK_PAGE_BYTES);
	if pages.len() <= 1 { text.to_owned() } else { format!("{}\n\n[Truncated: the page goes on]", pages[0]) }
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_long_page_is_cut_to_its_first_work_page() {
		let page = "word ".repeat(10_000);
		let cut = truncate(&page);
		assert!(cut.ends_with("\n\n[Truncated: the page goes on]"));
		assert!(cut.len() < page.len());
		assert_eq!(truncate("short"), "short");
	}

	#[test]
	fn a_failed_search_says_what_to_do_instead() {
		assert_eq!(failure_text(&Failure::KeyRefused), "Tavily refused the search key. Carry on with your own web search if you have one, or with addresses you know exist.");
		assert!(failure_text(&Failure::OutOfSearches).starts_with("The search key is out of searches for now. Carry on"));
		assert!(failure_text(&Failure::Busy).starts_with("Tavily is busy, so web_search may work again later. Carry on"));
		assert!(failure_text(&Failure::Status(500)).starts_with("Tavily answered HTTP 500. Carry on"));
	}

	#[tokio::test]
	async fn an_empty_search_is_refused_before_asking_tavily() {
		let tool = web_search_tool("tvly-key".to_owned());
		let result = tool.execute(gs_json::json!({ "query": "  " }), gs_engine::turn::tool::ToolContext { tool_call_id: "c".to_owned(), abort: Abort::new() }).await.unwrap();
		assert_eq!(result["content"][0]["text"].as_str(), Some("web_search failed: the query is empty"));
	}

	#[tokio::test]
	async fn an_abort_wins_over_a_slow_fetch() {
		let abort = Abort::new();
		abort.abort();
		let slow = async {
			gs_base::clock::sleep(60_000).await;
			Ok::<_, String>(String::new())
		};
		assert_eq!(until_aborted(&abort, slow).await.unwrap_err(), ABORTED);
	}
}

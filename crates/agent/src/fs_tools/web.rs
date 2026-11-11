//! The researcher's web tool. Like every tool here it never fails the run: a failure comes
//! back as text the researcher can adapt to.

use std::sync::Arc;

use gs_core::session::work_pages::{WORK_PAGE_BYTES, split_pages};
use gs_engine::turn::abort::Abort;
use gs_engine::turn::tool::Tool;
use gs_json::Json;
use gs_web::fetch::{fetch_and_extract, is_http_url};

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

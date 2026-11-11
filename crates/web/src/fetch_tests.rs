//! web_fetch edge cases that the golden pages do not cover: what is sent, the reader's rules, and
//! the redirect limit.

use crate::fetch::{USER_AGENT, extract, is_http_url, is_pdf_url};
use crate::test_server::{Route, serve};

const SCRIPT_PAGE: &str = "<html><head><title>App</title></head><body><div id=root></div><script src=app.js></script></body></html>";

#[test]
fn pdf_addresses_are_told_by_the_path() {
	assert!(is_pdf_url("https://x.org/a/Paper.PDF"));
	assert!(is_pdf_url("https://x.org/a.pdf?download=1"));
	assert!(is_pdf_url("https://x.org/a.pdf#page=2"));
	assert!(!is_pdf_url("https://x.org/pdf"));
	assert!(!is_pdf_url("https://x.org/a.pdf/view"));
	assert!(!is_pdf_url("https://x.org/?file=a.pdf"));
	assert!(!is_pdf_url("not a url"));
}

#[test]
fn only_http_addresses_are_fetched() {
	assert!(is_http_url("http://x.org"));
	assert!(is_http_url("https://x.org/a"));
	assert!(!is_http_url("file:///etc/passwd"));
	assert!(!is_http_url("ftp://x.org/a"));
	assert!(!is_http_url("x.org"));
}

#[tokio::test]
async fn the_page_request_looks_like_a_browser() {
	let server = serve(|_| Some(Route::ok("text/plain", b"hi"))).await;
	extract(&format!("{}/a", server.origin), "http://127.0.0.1:1/").await.unwrap();
	let seen = &server.requests()[0];
	assert_eq!(seen.header("user-agent"), Some(USER_AGENT));
	assert_eq!(seen.header("accept"), Some("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"));
	assert_eq!(seen.header("accept-language"), Some("en-US,en;q=0.9"));
	assert_eq!(seen.header("sec-fetch-mode"), Some("cors"));
}

#[tokio::test]
async fn the_source_line_names_the_address_after_redirects_without_its_fragment() {
	let server = serve(|path| match path {
		"/old" => Some(Route::redirect("/new#section")),
		"/new" => Some(Route::ok("text/plain", b"body")),
		_ => None,
	})
	.await;
	let text = extract(&format!("{}/old#top", server.origin), "http://127.0.0.1:1/").await.unwrap();
	assert_eq!(text, format!("Source: {}/new (HTTP 200)\n\nbody", server.origin));
}

#[tokio::test]
async fn bad_addresses_fail_the_way_node_words_them() {
	let nowhere = "http://127.0.0.1:1/";
	assert_eq!(extract("not a url", nowhere).await.unwrap_err(), "Failed to parse URL from not a url");
	assert_eq!(
		extract("http://user:pw@127.0.0.1/", nowhere).await.unwrap_err(),
		"Request cannot be constructed from a URL that includes credentials: http://user:pw@127.0.0.1/"
	);
}

#[tokio::test]
async fn twenty_redirects_are_followed_and_the_twenty_first_fails() {
	let server = serve(|path| {
		let hop: u32 = path.strip_prefix("/hop/")?.parse().ok()?;
		Some(if hop < 21 { Route::redirect(&format!("/hop/{}", hop + 1)) } else { Route::ok("text/plain", b"arrived") })
	})
	.await;
	// 20 redirects from /hop/1 reach /hop/21.
	let text = extract(&format!("{}/hop/1", server.origin), "http://127.0.0.1:1/").await.unwrap();
	assert!(text.ends_with("arrived"), "{text}");
	assert_eq!(extract(&format!("{}/hop/0", server.origin), "http://127.0.0.1:1/").await.unwrap_err(), "fetch failed");
}

#[tokio::test]
async fn the_reader_is_asked_for_markdown_without_a_cache() {
	let reply = format!("Title: App\n\nMarkdown Content:\n{}", "word ".repeat(60));
	let server = serve(move |path| match path.strip_prefix("/__jina/") {
		Some(_) => Some(Route::ok("text/markdown", reply.as_bytes())),
		None => Some(Route::ok("text/html", SCRIPT_PAGE.as_bytes())),
	})
	.await;
	let url = format!("{}/app", server.origin);
	let text = extract(&url, &format!("{}/__jina/", server.origin)).await.unwrap();
	assert_eq!(text, "word ".repeat(60).trim());

	let seen = &server.requests()[1];
	assert_eq!(seen.path, format!("/__jina/{url}"));
	assert_eq!(seen.header("user-agent"), Some("node"));
	assert_eq!(seen.header("accept"), Some("text/markdown"));
	assert_eq!(seen.header("x-no-cache"), Some("true"));
	// Node's fetch fills these in.
	assert_eq!(seen.header("accept-language"), Some("*"));
	assert_eq!(seen.header("sec-fetch-mode"), Some("cors"));
}

/// The error a script-drawn page gives when the reader has nothing usable.
const NOT_READABLE: &str = "Could not extract readable content (the page may be JavaScript-rendered)";

async fn script_page_with_reader(reply: String) -> Result<String, String> {
	let server = serve(move |path| match path.strip_prefix("/__jina/") {
		Some(_) => Some(Route::ok("text/markdown", reply.as_bytes())),
		None => Some(Route::ok("text/html", SCRIPT_PAGE.as_bytes())),
	})
	.await;
	extract(&format!("{}/app", server.origin), &format!("{}/__jina/", server.origin)).await
}

#[tokio::test]
async fn the_reader_needs_two_hundred_characters_after_its_marker() {
	let marked = |n: usize| format!("Markdown Content: {}", "x".repeat(n));
	assert_eq!(script_page_with_reader(marked(199)).await.unwrap_err(), NOT_READABLE);
	assert_eq!(script_page_with_reader(marked(200)).await.unwrap(), "x".repeat(200));
}

#[tokio::test]
async fn the_reader_must_have_a_marker_and_a_real_page() {
	let body = "y".repeat(300);
	assert_eq!(script_page_with_reader(body.clone()).await.unwrap_err(), NOT_READABLE);
	assert_eq!(script_page_with_reader(format!("Markdown Content: Loading... {body}")).await.unwrap_err(), NOT_READABLE);
	// The cut counts characters the way JavaScript does: two units for an emoji.
	assert_eq!(script_page_with_reader(format!("Markdown Content: {}", "\u{1F600}".repeat(100))).await.unwrap(), "\u{1F600}".repeat(100));
	assert_eq!(script_page_with_reader(format!("Markdown Content: {}", "\u{1F600}".repeat(99))).await.unwrap_err(), NOT_READABLE);
}

#[tokio::test]
async fn a_failing_reader_gives_the_same_error() {
	let server = serve(|path| if path.starts_with("/__jina/") { Some(Route::status(500, "Internal Server Error")) } else { Some(Route::ok("text/html", SCRIPT_PAGE.as_bytes())) }).await;
	let error = extract(&format!("{}/app", server.origin), &format!("{}/__jina/", server.origin)).await.unwrap_err();
	assert_eq!(error, NOT_READABLE);
}

#[tokio::test]
async fn a_pdf_page_does_not_call_the_reader() {
	let server = serve(|_| Some(Route::ok("application/pdf", b"%PDF-1.4"))).await;
	let text = extract(&format!("{}/a", server.origin), "http://127.0.0.1:1/").await.unwrap();
	assert!(text.starts_with("web_fetch: this URL is a PDF document"), "{text}");
	assert_eq!(server.requests().len(), 1);
}

#[test]
fn the_fetch_future_can_move_between_threads() {
	fn assert_send<T: Send>(_: &T) {}
	assert_send(&extract("http://127.0.0.1:1/", "http://127.0.0.1:1/"));
	assert_send(&crate::download::download_pdf("http://127.0.0.1:1/", std::path::Path::new("/nonexistent")));
}

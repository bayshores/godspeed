//! Web pages as text for the researcher (fetchAndExtract, isPdfUrl and USER_AGENT in web.ts).
//! The caller cuts the result into work pages and words the failure.

use reqwest::Url;

use crate::{http, jina, markdown};

pub const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MAX_RESPONSE_BYTES: u64 = 5 * 1024 * 1024;
const PDF_POINTER: &str = "web_fetch: this URL is a PDF document \u{2014} call web_fetch_pdf on it to download and read it.";

/// A URL whose path ends in .pdf counts as a PDF whatever its content type: S3 and university
/// servers often send PDFs as octet-stream.
pub fn is_pdf_url(url: &str) -> bool {
	Url::parse(url).is_ok_and(|u| u.path().to_ascii_lowercase().ends_with(".pdf"))
}

/// Only http(s) addresses are fetched.
pub fn is_http_url(url: &str) -> bool {
	Url::parse(url).is_ok_and(|u| matches!(u.scheme(), "http" | "https"))
}

/// The page at `url` as readable markdown under a Source line, plain text as it is, or a
/// pointer to web_fetch_pdf. Err holds the message after "web_fetch failed for <url>: ".
pub async fn fetch_and_extract(url: &str) -> Result<String, String> {
	extract(url, jina::READER_URL).await
}

pub(crate) async fn extract(url: &str, reader_url: &str) -> Result<String, String> {
	let accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
	let response = http::get(url, &[("User-Agent", USER_AGENT), ("Accept", accept), ("Accept-Language", "en-US,en;q=0.9")]).await?;
	if !response.status().is_success() {
		return Err(http::status_error(&response));
	}

	// The final address and status tell a real page from a 200-served error body.
	let source_line = format!("Source: {} (HTTP {})", http::final_url(&response), response.status().as_u16());

	let content_type = http::header(&response, "content-type").unwrap_or_default();
	if content_type.contains("application/pdf") || is_pdf_url(url) {
		return Ok(PDF_POINTER.to_owned());
	}
	if ["image/", "audio/", "video/", "zip", "octet-stream"].iter().any(|kind| content_type.contains(kind)) {
		return Err(format!("Unsupported content type: {}", content_type.split(';').next().unwrap_or("")));
	}
	if http::content_length(&response) > MAX_RESPONSE_BYTES {
		return Err("Response too large".to_owned());
	}

	let text = http::read_text(response).await?;
	if !content_type.contains("html") {
		return Ok(format!("{source_line}\n\n{text}"));
	}

	if let Some(page) = markdown::html_to_markdown(&text) {
		let title = if page.title.is_empty() { String::new() } else { format!("# {}\n\n", page.title) };
		return Ok(format!("{title}{source_line}\n\n---\n\n{}", page.content));
	}
	// Likely a page that draws itself with scripts.
	match jina::fetch_via_jina(url, reader_url).await {
		Some(page) => Ok(page),
		None => Err("Could not extract readable content (the page may be JavaScript-rendered)".to_owned()),
	}
}

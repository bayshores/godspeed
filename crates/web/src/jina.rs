//! The r.jina.ai reader, for pages that need scripts to show their text (fetchViaJina in web.ts).

use gs_base::text;

use crate::{http, markdown::MIN_USEFUL_CONTENT};

pub const READER_URL: &str = "https://r.jina.ai/";

const MARKER: &str = "Markdown Content:";

/// The page as markdown, or None when the reader fails or returns too little.
pub async fn fetch_via_jina(url: &str, reader_url: &str) -> Option<String> {
	let response = http::get(&format!("{reader_url}{url}"), &[("Accept", "text/markdown"), ("X-No-Cache", "true")]).await.ok()?;
	if !response.status().is_success() {
		return None;
	}
	let content = http::read_text(response).await.ok()?;
	let start = content.find(MARKER)?;
	let markdown = text::trim(&content[start + MARKER.len()..]);
	if text::len16(markdown) < MIN_USEFUL_CONTENT || markdown.starts_with("Loading...") {
		return None;
	}
	Some(markdown.to_owned())
}

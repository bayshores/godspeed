//! A GET the way Node's fetch does it: up to 20 redirects, no proxy, Node's wording for failures.
//! Private and local addresses are refused (crate::guard). Dropping the future cancels the
//! request, which is how the tool guard's timeout and Stop work.

use std::future::Future;
use std::time::Duration;

use gs_base::clock;
use reqwest::{Client, Response, Url};

use crate::guard;

const MAX_REDIRECTS: usize = 20;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long the server may take to answer, and then to send each piece of the body.
const SILENCE_LIMIT_MS: i64 = 300_000;

/// Every transport failure reads this way in Node.
const FETCH_FAILED: &str = "fetch failed";
const BODY_CUT_SHORT: &str = "terminated";

/// What Node's fetch sends when the caller does not set these (Accept is reqwest's own default).
const NODE_DEFAULTS: [(&str, &str); 3] = [("user-agent", "node"), ("accept-language", "*"), ("sec-fetch-mode", "cors")];

async fn within<T>(ms: i64, work: impl Future<Output = T>) -> Option<T> {
	tokio::select! {
		out = work => Some(out),
		() = clock::sleep(ms) => None,
	}
}

pub async fn get(url: &str, headers: &[(&str, &str)]) -> Result<Response, String> {
	let parsed = Url::parse(url).map_err(|_| format!("Failed to parse URL from {url}"))?;
	if !parsed.username().is_empty() || parsed.password().is_some() {
		return Err(format!("Request cannot be constructed from a URL that includes credentials: {url}"));
	}
	guard::check(&parsed).map_err(|refused| refused.to_string())?;
	let client = Client::builder().redirect(guard::redirects(MAX_REDIRECTS)).dns_resolver(guard::PublicOnly).connect_timeout(CONNECT_TIMEOUT).no_proxy().build().map_err(|_| FETCH_FAILED.to_owned())?;
	let mut request = client.get(parsed);
	for (name, value) in headers {
		request = request.header(*name, *value);
	}
	for (name, value) in NODE_DEFAULTS {
		if !headers.iter().any(|(given, _)| given.eq_ignore_ascii_case(name)) {
			request = request.header(name, value);
		}
	}
	match within(SILENCE_LIMIT_MS, request.send()).await {
		Some(Ok(response)) => Ok(response),
		Some(Err(err)) if guard::was_refused(&err) => Err(guard::REFUSED.to_owned()),
		_ => Err(FETCH_FAILED.to_owned()),
	}
}

/// `HTTP 404 Not Found`, for a status that is not 2xx.
pub fn status_error(response: &Response) -> String {
	let status = response.status();
	format!("HTTP {} {}", status.as_u16(), status.canonical_reason().unwrap_or(""))
}

/// The address after redirects, without its fragment.
pub fn final_url(response: &Response) -> String {
	let mut url = response.url().clone();
	url.set_fragment(None);
	url.into()
}

/// `headers.get(name)`: several values join with ", " and bytes read as Latin-1.
pub fn header(response: &Response, name: &str) -> Option<String> {
	let values: Vec<String> = response.headers().get_all(name).iter().map(|v| v.as_bytes().iter().map(|&b| char::from(b)).collect()).collect();
	(!values.is_empty()).then(|| values.join(", "))
}

/// `Number(headers.get("content-length") ?? 0)`; the HTTP layer already refuses anything but digits.
pub fn content_length(response: &Response) -> u64 {
	header(response, "content-length").and_then(|v| v.trim().parse().ok()).unwrap_or(0)
}

pub async fn read_body(mut response: Response) -> Result<Vec<u8>, String> {
	let mut body = Vec::new();
	loop {
		match within(SILENCE_LIMIT_MS, response.chunk()).await {
			Some(Ok(Some(chunk))) => body.extend_from_slice(&chunk),
			Some(Ok(None)) => return Ok(body),
			_ => return Err(BODY_CUT_SHORT.to_owned()),
		}
	}
}

/// `response.text()`: UTF-8 whatever the charset says, a leading BOM dropped.
pub async fn read_text(response: Response) -> Result<String, String> {
	let body = read_body(response).await?;
	let body = body.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&body);
	Ok(gs_base::text::from_utf8_lossy(body))
}

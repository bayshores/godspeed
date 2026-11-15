//! A plugin's zip from GitHub: one tag of one repository, read into memory with a size cap so a
//! huge or endless answer stops early.

use gs_base::clock;

use crate::http;

/// How long the server may stay silent before or between pieces of the body.
const SILENCE_LIMIT_MS: i64 = 60_000;

/// The zip GitHub builds for a tag.
pub fn tag_zip_url(owner: &str, repo: &str, tag: &str) -> String {
	format!("https://codeload.github.com/{owner}/{repo}/zip/refs/tags/{tag}")
}

/// The bytes at `url`, or why not: a status that is not 2xx, a body over `max_bytes`, a cut.
pub async fn download_zip(url: &str, max_bytes: usize) -> Result<Vec<u8>, String> {
	let mut response = http::get(url, &[("Accept", "application/zip")]).await?;
	if !response.status().is_success() {
		return Err(http::status_error(&response));
	}
	let too_large = format!("The zip is over {} MB.", max_bytes / (1024 * 1024));
	if http::content_length(&response) > max_bytes as u64 {
		return Err(too_large);
	}
	let mut body = Vec::new();
	loop {
		match clock::within(SILENCE_LIMIT_MS, response.chunk()).await {
			Some(Ok(Some(chunk))) => {
				if body.len() + chunk.len() > max_bytes {
					return Err(too_large);
				}
				body.extend_from_slice(&chunk);
			}
			Some(Ok(None)) => return Ok(body),
			_ => return Err("The download broke off.".to_owned()),
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::test_server::{Route, serve};

	#[test]
	fn a_tag_s_zip_lives_on_codeload() {
		assert_eq!(tag_zip_url("808arc", "meme-plugin", "v0.2.0"), "https://codeload.github.com/808arc/meme-plugin/zip/refs/tags/v0.2.0");
	}

	#[tokio::test]
	async fn the_body_comes_back_under_the_cap() {
		const MB: usize = 1024 * 1024;
		let server = serve(|path| match path {
			"/small.zip" => Some(Route::ok("application/zip", b"PK small")),
			"/big.zip" => Some(Route::ok("application/zip", &vec![0; 2 * MB])),
			_ => None,
		})
		.await;
		assert_eq!(download_zip(&format!("{}/small.zip", server.origin), MB).await.unwrap(), b"PK small");
		assert_eq!(download_zip(&format!("{}/big.zip", server.origin), MB).await, Err("The zip is over 1 MB.".to_owned()));
		assert_eq!(download_zip(&format!("{}/nope.zip", server.origin), MB).await, Err("HTTP 404 Not Found".to_owned()));
	}
}

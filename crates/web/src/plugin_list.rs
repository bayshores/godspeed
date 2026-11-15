//! godspeed's checked list of plugins, `plugins.json` in github.com/bayshores/godspeed-plugins.
//! It comes from one fixed address on GitHub's raw host: no redirect is followed, the request
//! carries nothing of the learner's, and a slow or large answer stops early.

use std::time::Duration;

use gs_base::clock;
use reqwest::redirect::Policy;
use reqwest::{Client, Url};

use crate::guard;

/// The list on the repository's default branch.
const LIST_URL: &str = "https://raw.githubusercontent.com/bayshores/godspeed-plugins/HEAD/plugins.json";
const MAX_BYTES: usize = 256 * 1024;
/// The whole request, from connecting to the last byte.
const TIME_LIMIT_MS: i64 = 10_000;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const USER_AGENT: &str = "godspeed";
/// Why a list over the cap wasn't read; it counts as no list, not as a failed read.
pub const TOO_LARGE: &str = "The list is over 256 KB.";

/// The list's text, or why not.
pub async fn download_list() -> Result<String, String> {
	download(LIST_URL).await
}

async fn download(url: &str) -> Result<String, String> {
	let url = Url::parse(url).map_err(|e| e.to_string())?;
	guard::check(&url).map_err(|refused| refused.to_string())?;
	let client = Client::builder().redirect(Policy::none()).dns_resolver(guard::PublicOnly).connect_timeout(CONNECT_TIMEOUT).no_proxy().build().map_err(|e| e.to_string())?;
	let read = async {
		let mut response = client.get(url).header("User-Agent", USER_AGENT).header("Accept", "application/json").send().await.map_err(|e| e.to_string())?;
		if !response.status().is_success() {
			return Err(format!("HTTP {}", response.status().as_u16()));
		}
		let mut body = Vec::new();
		while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
			if body.len() + chunk.len() > MAX_BYTES {
				return Err(TOO_LARGE.to_owned());
			}
			body.extend_from_slice(&chunk);
		}
		String::from_utf8(body).map_err(|_| "The list isn't text.".to_owned())
	};
	clock::within(TIME_LIMIT_MS, read).await.unwrap_or_else(|| Err("The list took too long.".to_owned()))
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::test_server::{Route, serve};

	#[test]
	fn the_list_lives_on_github_s_raw_host() {
		assert!(LIST_URL.starts_with("https://raw.githubusercontent.com/bayshores/godspeed-plugins/"));
	}

	#[tokio::test]
	async fn the_list_comes_back_under_the_cap_and_a_redirect_is_not_followed() {
		let server = serve(|path| match path {
			"/plugins.json" => Some(Route::ok("text/plain", br#"{"version":1,"plugins":[]}"#)),
			"/big.json" => Some(Route::ok("text/plain", &vec![b' '; MAX_BYTES + 1])),
			"/moved.json" => Some(Route::redirect("/plugins.json")),
			_ => None,
		})
		.await;
		let at = |path: &str| format!("{}{path}", server.origin);
		assert_eq!(download(&at("/plugins.json")).await, Ok(r#"{"version":1,"plugins":[]}"#.to_owned()));
		assert_eq!(download(&at("/big.json")).await, Err(TOO_LARGE.to_owned()));
		assert_eq!(download(&at("/moved.json")).await, Err("HTTP 302".to_owned()));
		assert_eq!(download(&at("/nope.json")).await, Err("HTTP 404".to_owned()));
		let seen = server.requests();
		assert_eq!(seen.len(), 4);
		assert_eq!(seen[0].header("user-agent"), Some(USER_AGENT));
		assert!(seen.iter().all(|s| s.header("cookie").is_none() && s.header("authorization").is_none()));
	}
}

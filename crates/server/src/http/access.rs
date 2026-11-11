//! Who may call /api. In the desktop app only the app's own window holds the per-launch secret,
//! as the HttpOnly cookie the login route sets, and only its own pages send `Sec-Fetch-Site:
//! same-origin` (a demo iframe sends `cross-site`). Outside agents reach /api/mcp and
//! /api/mcp/forget with their own token, which those routes check.

use axum::http::{HeaderMap, HeaderValue, header};
use gs_shell_rpc::same_bytes;

const COOKIE: &str = "gs_desktop";

/// Open in every mode: the agents' endpoint (bearer token in the route) and the window's login.
const EXEMPT: [&str; 3] = ["/api/mcp", "/api/mcp/forget", "/api/desktop/login"];

/// The desktop secret settings, read once at start-up. The default is browser mode.
#[derive(Clone, Default)]
pub struct Access {
	desktop: bool,
	secret: Option<String>,
}

impl Access {
	pub fn from_env() -> Access {
		Access { desktop: std::env::var("LH_DESKTOP_SERVER").as_deref() == Ok("1"), secret: std::env::var("LH_DESKTOP_API_SECRET").ok().filter(|s| !s.is_empty()) }
	}

	/// The `Set-Cookie` the login route gives the window: out of reach of page scripts and of
	/// requests other sites start. None without a secret.
	pub fn login_cookie(&self) -> Option<HeaderValue> {
		let secret = self.secret.as_ref()?;
		HeaderValue::from_str(&format!("{COOKIE}={secret}; Path=/; HttpOnly; SameSite=Strict")).ok()
	}

	/// Whether a request to `path` may go on.
	pub fn allows(&self, path: &str, headers: &HeaderMap) -> bool {
		// Next's matcher for "/api/:path*" also takes the data-route form "/api.json".
		let api = path == "/api" || path == "/api.json" || path.starts_with("/api/");
		if !api || EXEMPT.contains(&path) {
			return true;
		}
		let Some(expected) = &self.secret else { return !self.desktop };
		// A short secret would be guessable, so it opens nothing. Measured in UTF-16 units like
		// the JS check; the secret is ASCII hex in practice.
		if expected.encode_utf16().count() < 64 {
			return false;
		}
		same_origin(headers) && cookies(headers).any(|value| same_bytes(value.as_bytes(), expected.as_bytes()))
	}
}

/// Exactly one `Sec-Fetch-Site`, and it says the page's own origin sent the request.
fn same_origin(headers: &HeaderMap) -> bool {
	let mut sites = headers.get_all("sec-fetch-site").iter();
	sites.next().is_some_and(|site| site == "same-origin") && sites.next().is_none()
}

/// Every `gs_desktop` value in the Cookie headers (another app on 127.0.0.1 may have set its own
/// too: cookies do not keep ports apart).
fn cookies(headers: &HeaderMap) -> impl Iterator<Item = &str> {
	headers
		.get_all(header::COOKIE)
		.iter()
		.filter_map(|value| value.to_str().ok())
		.flat_map(|value| value.split(';'))
		.filter_map(|pair| pair.trim().strip_prefix(COOKIE)?.strip_prefix('='))
}

#[cfg(test)]
mod tests {
	use super::*;

	fn secret() -> String {
		"a".repeat(64)
	}

	fn desktop() -> Access {
		Access { desktop: true, secret: Some(secret()) }
	}

	fn request(cookie: Option<&str>, site: Option<&str>) -> HeaderMap {
		let mut h = HeaderMap::new();
		if let Some(cookie) = cookie {
			h.insert(header::COOKIE, cookie.parse().unwrap());
		}
		if let Some(site) = site {
			h.insert("sec-fetch-site", site.parse().unwrap());
		}
		h
	}

	fn window() -> HeaderMap {
		request(Some(&format!("{COOKIE}={}", secret())), Some("same-origin"))
	}

	#[test]
	fn the_window_with_cookie_and_same_origin_gets_in() {
		assert!(desktop().allows("/api/settings", &window()));
		assert!(desktop().allows("/api", &window()));
		let among_others = request(Some(&format!("theme=dark; {COOKIE}=wrong; {COOKIE}={}", secret())), Some("same-origin"));
		assert!(desktop().allows("/api/settings", &among_others));
	}

	#[test]
	fn a_missing_cookie_is_refused() {
		assert!(!desktop().allows("/api/settings", &request(None, Some("same-origin"))));
		assert!(!desktop().allows("/api/settings", &request(Some("theme=dark"), Some("same-origin"))));
	}

	#[test]
	fn a_wrong_cookie_is_refused() {
		assert!(!desktop().allows("/api/settings", &request(Some(&format!("{COOKIE}=nope")), Some("same-origin"))));
		assert!(!desktop().allows("/api/settings", &request(Some(&format!("{COOKIE}={}b", secret())), Some("same-origin"))));
	}

	#[test]
	fn a_missing_site_header_is_refused() {
		assert!(!desktop().allows("/api/settings", &request(Some(&format!("{COOKIE}={}", secret())), None)));
	}

	#[test]
	fn other_sites_are_refused() {
		let cookie = format!("{COOKIE}={}", secret());
		for site in ["cross-site", "same-site", "none"] {
			assert!(!desktop().allows("/api/settings", &request(Some(&cookie), Some(site))), "{site}");
		}
		let mut twice = window();
		twice.append("sec-fetch-site", "same-origin".parse().unwrap());
		assert!(!desktop().allows("/api/settings", &twice));
	}

	#[test]
	fn mcp_and_login_are_exempt() {
		for path in ["/api/mcp", "/api/mcp/forget", "/api/desktop/login"] {
			assert!(desktop().allows(path, &HeaderMap::new()), "{path}");
		}
		assert!(!desktop().allows("/api/mcp/other", &HeaderMap::new()));
		assert!(!desktop().allows("/api/desktop/login/x", &HeaderMap::new()));
	}

	#[test]
	fn pages_and_non_api_paths_stay_open() {
		assert!(desktop().allows("/graph", &HeaderMap::new()));
		assert!(desktop().allows("/API/settings", &HeaderMap::new()));
		assert!(!desktop().allows("/api.json", &HeaderMap::new()));
	}

	#[test]
	fn browser_mode_allows_everything() {
		assert!(Access::default().allows("/api/settings", &HeaderMap::new()));
		assert!(Access::default().login_cookie().is_none());
	}

	#[test]
	fn a_desktop_without_a_good_secret_opens_nothing() {
		let no_secret = Access { desktop: true, secret: None };
		assert!(!no_secret.allows("/api/settings", &window()));
		let short = Access { desktop: true, secret: Some("short".into()) };
		assert!(!short.allows("/api/settings", &request(Some(&format!("{COOKIE}=short")), Some("same-origin"))));
	}

	#[test]
	fn the_login_cookie_carries_the_secret() {
		assert_eq!(desktop().login_cookie().unwrap(), format!("{COOKIE}={}; Path=/; HttpOnly; SameSite=Strict", secret()).as_str());
	}
}

//! Who may call /api (src/proxy.ts, src/backend/server/desktop-access.ts). In the desktop app only
//! the app's own window holds the per-launch secret; outside agents reach /api/mcp and
//! /api/mcp/forget with their own token, which those routes check.

use axum::http::HeaderMap;

/// The desktop secret settings, read once at start-up.
#[derive(Clone)]
pub struct Access {
	desktop: bool,
	secret: Option<String>,
}

impl Access {
	pub fn from_env() -> Access {
		Access { desktop: std::env::var("LH_DESKTOP_SERVER").as_deref() == Ok("1"), secret: std::env::var("LH_DESKTOP_API_SECRET").ok().filter(|s| !s.is_empty()) }
	}

	/// Whether a request to `path` may go on.
	pub fn allows(&self, path: &str, headers: &HeaderMap) -> bool {
		// Next's matcher for "/api/:path*" also takes the data-route form "/api.json".
		let api = path == "/api" || path == "/api.json" || path.starts_with("/api/");
		if !api || path == "/api/mcp" || path == "/api/mcp/forget" {
			return true;
		}
		let Some(expected) = &self.secret else { return !self.desktop };
		// Measured in UTF-16 units like the JS check; the secret is ASCII hex in practice.
		if expected.encode_utf16().count() < 64 {
			return false;
		}
		// A header sent twice reads as both values joined, as `Headers.get` gives it.
		let supplied: Vec<&[u8]> = headers.get_all("x-godspeed-desktop").iter().map(|v| v.as_bytes()).collect();
		!supplied.is_empty() && same_bytes(&supplied.join(&b", "[..]), expected.as_bytes())
	}
}

/// Compares in time that depends only on the length, like `timingSafeEqual`.
fn same_bytes(a: &[u8], b: &[u8]) -> bool {
	a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
	use super::*;

	fn headers(secret: &str) -> HeaderMap {
		let mut h = HeaderMap::new();
		h.insert("x-godspeed-desktop", secret.parse().unwrap());
		h
	}

	#[test]
	fn desktop_mode_needs_the_secret_except_for_mcp() {
		let secret = "a".repeat(64);
		let desktop = Access { desktop: true, secret: Some(secret.clone()) };
		assert!(desktop.allows("/api/settings", &headers(&secret)));
		assert!(!desktop.allows("/api/settings", &headers("nope")));
		assert!(!desktop.allows("/api", &HeaderMap::new()));
		assert!(desktop.allows("/api/mcp", &HeaderMap::new()));
		assert!(desktop.allows("/API/settings", &HeaderMap::new()));
		assert!(desktop.allows("/graph", &HeaderMap::new()));
		assert!(!desktop.allows("/api.json", &HeaderMap::new()));
		let mut twice = headers(&secret);
		twice.append("x-godspeed-desktop", secret.parse().unwrap());
		assert!(!desktop.allows("/api/settings", &twice));
		let short = Access { desktop: false, secret: Some("short".into()) };
		assert!(!short.allows("/api/settings", &headers("short")));
		let no_secret = Access { desktop: true, secret: None };
		assert!(!no_secret.allows("/api/settings", &HeaderMap::new()));
		let browser = Access { desktop: false, secret: None };
		assert!(browser.allows("/api/settings", &HeaderMap::new()));
	}
}

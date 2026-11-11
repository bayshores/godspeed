//! One-time login tokens: the shell hands one over the protocol, then opens the login URL with
//! it, so only the window the shell opened gets the desktop cookie.

use std::sync::Mutex;

use gs_base::clock;

/// A token is good this long after it arrives.
const LOGIN_LIMIT_MS: i64 = 60_000;

#[derive(Default)]
pub(crate) struct LoginTokens {
	/// Each token with the app-clock time it expires.
	tokens: Mutex<Vec<(String, i64)>>,
}

impl LoginTokens {
	/// Keeps a 64-hex token; false (and nothing kept) for anything else.
	pub(crate) fn add(&self, token: String) -> bool {
		if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
			return false;
		}
		let now = clock::now_ms();
		let mut tokens = crate::link::lock(&self.tokens);
		tokens.retain(|(_, until)| now < *until);
		tokens.push((token, now + LOGIN_LIMIT_MS));
		true
	}

	/// Whether `token` arrived and has not expired. It works once.
	pub(crate) fn take(&self, token: &str) -> bool {
		let now = clock::now_ms();
		let mut tokens = crate::link::lock(&self.tokens);
		tokens.retain(|(_, until)| now < *until);
		let found = tokens.iter().position(|(kept, _)| same_bytes(kept.as_bytes(), token.as_bytes()));
		found.map(|i| tokens.remove(i)).is_some()
	}
}

/// Compares in time that depends only on the length, so a guess learns nothing from how long a
/// refusal took.
pub fn same_bytes(a: &[u8], b: &[u8]) -> bool {
	a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn same_bytes_needs_equal_length_and_content() {
		assert!(same_bytes(b"abc", b"abc"));
		assert!(!same_bytes(b"abc", b"abd"));
		assert!(!same_bytes(b"abc", b"abcd"));
		assert!(same_bytes(b"", b""));
	}

	#[test]
	fn only_64_hex_tokens_are_kept() {
		let tokens = LoginTokens::default();
		assert!(!tokens.add("short".into()));
		assert!(!tokens.add("g".repeat(64)));
		assert!(!tokens.take("short"));
		assert!(!tokens.take(""));
	}
}

//! SHA-256 as `crypto.createHash("sha256")` gives it: strings are hashed as Node encodes them
//! (lone surrogates as U+FFFD), digests as lowercase hex.

use sha2::{Digest, Sha256};

use crate::text::utf8_bytes;

/// `createHash("sha256").update(bytes).digest("hex")`.
pub fn sha256_hex(bytes: &[u8]) -> String {
	crate::ids::hex(&Sha256::digest(bytes))
}

/// `createHash("sha256").update(text).digest("hex")`.
pub fn sha256_text(text: &str) -> String {
	sha256_hex(&utf8_bytes(text))
}

/// A running hash fed piece by piece (`hash.update(...)` calls, then `digest("hex")`).
#[derive(Default)]
pub struct Hasher(Sha256);

impl Hasher {
	pub fn new() -> Hasher {
		Hasher::default()
	}

	pub fn update(&mut self, bytes: &[u8]) {
		self.0.update(bytes);
	}

	pub fn update_text(&mut self, text: &str) {
		self.0.update(utf8_bytes(text));
	}

	pub fn hex(self) -> String {
		crate::ids::hex(&self.0.finalize())
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn digests_match_node() {
		assert_eq!(sha256_text("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
		let half = crate::text::slice16("😀", 0, Some(1));
		assert_eq!(sha256_text(&half), sha256_text("\u{FFFD}"));
		let mut h = Hasher::new();
		h.update_text("a");
		h.update(b"bc");
		assert_eq!(h.hex(), sha256_text("abc"));
	}
}

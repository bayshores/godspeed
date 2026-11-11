//! JavaScript's `<`, `>` and `sort()` on strings.

use std::cmp::Ordering;

use gs_json::lone::to_utf16;

/// Orders by UTF-16 units, as `a < b` does in JavaScript (bytes would differ for characters
/// above U+FFFF against U+E000 to U+FFFF).
pub fn cmp_utf16(a: &str, b: &str) -> Ordering {
	to_utf16(a).cmp(&to_utf16(b))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn astral_characters_sort_before_the_private_use_block() {
		assert_eq!(cmp_utf16("a", "b"), Ordering::Less);
		assert_eq!(cmp_utf16("\u{1F600}", "\u{FF5E}"), Ordering::Less);
		assert!("\u{1F600}".as_bytes() > "\u{FF5E}".as_bytes());
	}
}

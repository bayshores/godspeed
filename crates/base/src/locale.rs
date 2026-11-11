//! `a.localeCompare(b)` and `a.localeCompare(b, undefined, { numeric: true })`: ICU collation in
//! the locale Node picks, which follows `LC_ALL`, `LC_MESSAGES` then `LANG` ("sv_SE.UTF-8" is
//! sv-SE) and is en-US when they are unset or "C".

use std::cmp::Ordering;
use std::sync::LazyLock;

use icu_collator::preferences::CollationNumericOrdering;
use icu_collator::{Collator, CollatorBorrowed, CollatorPreferences};
use icu_locale_core::Locale;

fn env_locale() -> Locale {
	let raw = ["LC_ALL", "LC_MESSAGES", "LANG"].iter().find_map(|k| std::env::var(k).ok().filter(|v| !v.is_empty())).unwrap_or_default();
	let tag = raw.split(['.', '@']).next().unwrap_or("").replace('_', "-");
	if tag.is_empty() || tag == "C" || tag == "POSIX" {
		return "en-US".parse().expect("valid tag");
	}
	tag.parse().unwrap_or_else(|_| "en-US".parse().expect("valid tag"))
}

fn collator(numeric: bool) -> CollatorBorrowed<'static> {
	let mut prefs = CollatorPreferences::from(&env_locale());
	prefs.numeric_ordering = Some(if numeric { CollationNumericOrdering::True } else { CollationNumericOrdering::False });
	Collator::try_new(prefs, Default::default()).expect("compiled collation data")
}

static PLAIN: LazyLock<CollatorBorrowed<'static>> = LazyLock::new(|| collator(false));
static NUMERIC: LazyLock<CollatorBorrowed<'static>> = LazyLock::new(|| collator(true));

/// `a.localeCompare(b)`.
pub fn compare(a: &str, b: &str) -> Ordering {
	PLAIN.compare(a, b)
}

/// `a.localeCompare(b, undefined, { numeric: true })`.
pub fn compare_numeric(a: &str, b: &str) -> Ordering {
	NUMERIC.compare(a, b)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn sorts_like_node_in_en_us() {
		let mut words = vec!["b", "a", "B", "_", "A", "é", "10", "9"];
		words.sort_by(|a, b| compare(a, b));
		assert_eq!(words, ["_", "10", "9", "a", "A", "b", "B", "é"]);
		let mut files = vec!["lec10.pdf", "lec9.pdf", "Lec2.pdf"];
		files.sort_by(|a, b| compare_numeric(a, b));
		assert_eq!(files, ["Lec2.pdf", "lec9.pdf", "lec10.pdf"]);
	}
}

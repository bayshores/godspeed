//! Finding the words a source mark quotes in its passage or on its page. Matching ignores what a
//! reader can't see: spacing and line ends, a word split at a line end, ligatures and curly
//! quotes. Offsets are UTF-16 units, as the window counts them.

use gs_json::lone::to_utf16;

/// The longest quote, in UTF-16 units.
pub const QUOTE_MAX: usize = 80;

/// Why a quote is not marked.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuoteMiss {
	/// It holds a bracket, backtick or `$`, which break the mark or open code or math.
	Unsafe,
	/// One plain word, or longer than `QUOTE_MAX`.
	Shape,
	Absent,
	Twice,
}

impl QuoteMiss {
	/// The end of the note the agent reads about a dropped quote.
	pub fn reason(self) -> &'static str {
		match self {
			QuoteMiss::Unsafe => "no [ ] backtick or $ in a quote; quote nearby plain words.",
			QuoteMiss::Shape => "a quote is 2 or more words, or one code expression, at most 80 characters.",
			QuoteMiss::Absent => "not in that passage. Copy the words exactly.",
			QuoteMiss::Twice => "found twice in that passage; quote a few more words.",
		}
	}
}

fn is_space(unit: u16) -> bool {
	matches!(unit, 0x09..=0x0d | 0x20 | 0xa0 | 0x2000..=0x200a | 0x2028 | 0x2029 | 0x202f | 0x3000 | 0xfeff)
}

fn is_letter(unit: u16) -> bool {
	char::from_u32(u32::from(unit)).is_some_and(char::is_alphabetic)
}

fn is_word(unit: u16) -> bool {
	unit == u16::from(b'_') || char::from_u32(u32::from(unit)).is_some_and(char::is_alphanumeric)
}

fn is_lower(unit: u16) -> bool {
	char::from_u32(u32::from(unit)).is_some_and(char::is_lowercase)
}

/// What a unit reads as when matching: ligatures spelled out, curly quotes straight.
fn plain(unit: u16) -> Option<&'static str> {
	Some(match unit {
		0xfb00 => "ff",
		0xfb01 => "fi",
		0xfb02 => "fl",
		0xfb03 => "ffi",
		0xfb04 => "ffl",
		0xfb05 | 0xfb06 => "st",
		0x2018..=0x201b | 0x2032 => "'",
		0x201c..=0x201f | 0x2033 => "\"",
		_ => return None,
	})
}

fn is_hyphen(unit: u16) -> bool {
	matches!(unit, 0x2d | 0xad | 0x2010)
}

/// The text as it is matched, for each of its units the offset in `text` it came from, and
/// whether a hyphen was dropped right before it. A run of spaces and line ends is one space, none
/// at either end; a hyphen that splits a word at a line end is dropped with the line end.
pub fn fold_for_match(text: &str) -> (Vec<u16>, Vec<usize>, Vec<bool>) {
	let units = to_utf16(text);
	let (mut folded, mut from) = (Vec::with_capacity(units.len()), Vec::with_capacity(units.len()));
	let mut soft = Vec::with_capacity(units.len());
	let mut dropped_hyphen = false;
	let mut i = 0;
	while i < units.len() {
		let unit = units[i];
		if is_space(unit) {
			let start = i;
			while i < units.len() && is_space(units[i]) {
				i += 1;
			}
			if !folded.is_empty() && i < units.len() {
				folded.push(u16::from(b' '));
				from.push(start);
				soft.push(false);
			}
			continue;
		}
		if is_hyphen(unit) && i > 0 && is_letter(units[i - 1]) {
			let mut j = i + 1;
			while j < units.len() && is_space(units[j]) && units[j] != 0x0a {
				j += 1;
			}
			if units.get(j) == Some(&0x0a) {
				j += 1;
				while j < units.len() && is_space(units[j]) {
					j += 1;
				}
				if units.get(j).is_some_and(|&u| is_lower(u)) {
					i = j;
					dropped_hyphen = true;
					continue;
				}
			}
		}
		match plain(unit) {
			Some(spelled) => {
				for u in spelled.encode_utf16() {
					folded.push(u);
					from.push(i);
					soft.push(std::mem::take(&mut dropped_hyphen));
				}
			}
			None => {
				folded.push(unit);
				from.push(i);
				soft.push(std::mem::take(&mut dropped_hyphen));
			}
		}
		i += 1;
	}
	(folded, from, soft)
}

/// Where `needle` ends in `hay` when it matches from `at`. Where the text dropped a line-end
/// hyphen, the quote may keep it, with a space after it or not (`regu-larization`, `well-known`).
fn match_end(hay: &[u16], soft: &[bool], needle: &[u16], at: usize) -> Option<usize> {
	let (mut h, mut n) = (at, 0);
	let mut skipped = false;
	while n < needle.len() {
		if !skipped && h > at && soft.get(h) == Some(&true) && is_hyphen(needle[n]) {
			n += 1 + usize::from(needle.get(n + 1) == Some(&u16::from(b' ')));
			skipped = true;
			continue;
		}
		if hay.get(h) != Some(&needle[n]) {
			return None;
		}
		(h, n, skipped) = (h + 1, n + 1, false);
	}
	Some(h)
}

fn unsafe_quote(quote: &str) -> bool {
	quote.contains(['[', ']', '`', '$'])
}

/// Where `quote` sits in `text` as UTF-16 offsets `(start, end)`, when it is there exactly once.
/// A quote that starts or ends with a letter or digit matches only where a word starts or ends.
pub fn find_once(text: &str, quote: &str) -> Result<(usize, usize), QuoteMiss> {
	if unsafe_quote(quote) {
		return Err(QuoteMiss::Unsafe);
	}
	let (needle, ..) = fold_for_match(quote);
	let (Some(&first), Some(&last)) = (needle.first(), needle.last()) else { return Err(QuoteMiss::Absent) };
	let (hay, from, soft) = fold_for_match(text);
	let bounded = |at: usize, end: usize| (!is_word(first) || at == 0 || !is_word(hay[at - 1])) && (!is_word(last) || hay.get(end).is_none_or(|&u| !is_word(u)));
	let mut found = (0..hay.len()).filter_map(|at| match_end(&hay, &soft, &needle, at).filter(|&end| end > at && bounded(at, end)).map(|end| (at, end)));
	match (found.next(), found.next()) {
		(None, _) => Err(QuoteMiss::Absent),
		(Some(_), Some(_)) => Err(QuoteMiss::Twice),
		(Some((at, end)), None) => Ok((from[at], from[end - 1] + 1)),
	}
}

/// `find_once` for a quote the agent wrote, which must also be 2 or more words, or one code
/// expression (a word holding something other than letters and digits), at most `QUOTE_MAX` long.
pub fn check_quote(passage: &str, quote: &str) -> Result<(usize, usize), QuoteMiss> {
	if unsafe_quote(quote) {
		return Err(QuoteMiss::Unsafe);
	}
	let words: Vec<&str> = quote.split_whitespace().collect();
	let expression = words.len() == 1 && words[0].chars().any(|c| !c.is_alphanumeric());
	if to_utf16(quote).len() > QUOTE_MAX || !(words.len() >= 2 || expression) {
		return Err(QuoteMiss::Shape);
	}
	find_once(passage, quote)
}

#[cfg(test)]
mod tests {
	use gs_json::lone::from_utf16;

	use super::*;

	fn folded(text: &str) -> String {
		from_utf16(&fold_for_match(text).0)
	}

	#[test]
	fn folding_ignores_spacing_split_words_ligatures_and_curly_quotes() {
		assert_eq!(folded("  a\n\n b\t c  "), "a b c");
		assert_eq!(folded("the regu-\nlarization term"), "the regularization term");
		assert_eq!(folded("regu- \n  larization"), "regularization");
		assert_eq!(folded("Figure 3-\nA"), "Figure 3- A");
		assert_eq!(folded("well-\nKnown"), "well- Known");
		assert_eq!(folded("e\u{fb03}cient \u{201c}fit\u{201d} isn\u{2019}t"), "efficient \"fit\" isn't");
	}

	#[test]
	fn a_quote_is_found_once_with_offsets_in_the_original_text() {
		let page = "Degree 12 fit\non 15 training points,\nthe e\u{fb03}cient regu-\nlarization";
		assert_eq!(find_once(page, "15  training\npoints"), Ok((17, 35)));
		assert_eq!(&to_utf16(page)[17..35], to_utf16("15 training points"));
		let (start, end) = find_once(page, "efficient regularization").unwrap();
		assert_eq!(from_utf16(&to_utf16(page)[start..end]), "e\u{fb03}cient regu-\nlarization");
		assert_eq!(find_once("I said \u{201c}hi\u{201d} twice", "\"hi\" twice"), Ok((7, 17)));
		// Offsets count UTF-16 units, so an emoji before the words moves them by 2.
		assert_eq!(find_once("\u{1f600} a b", "a b"), Ok((3, 6)));
	}

	#[test]
	fn found_twice_or_not_at_all_gives_none() {
		assert_eq!(find_once("p + 1 and p + 1", "p + 1"), Err(QuoteMiss::Twice));
		assert_eq!(find_once("1 + 1 + 1", "1 + 1"), Err(QuoteMiss::Twice), "overlapping");
		assert_eq!(find_once("degree 12", "degree 13"), Err(QuoteMiss::Absent));
		assert_eq!(find_once("degree 12", "  \n "), Err(QuoteMiss::Absent));
	}

	#[test]
	fn a_quote_may_keep_the_hyphen_of_a_word_split_at_a_line_end() {
		let page = "the regu-\nlarization term, a well-\nknown result";
		for quote in ["regularization term", "regu-larization term", "regu- larization term"] {
			assert_eq!(find_once(page, quote), Ok((4, 25)), "{quote}");
		}
		assert_eq!(check_quote(page, "well-known result"), Ok((29, 47)));
		// Only where the page split a word: elsewhere a hyphen is a hyphen.
		assert_eq!(find_once(page, "regu--larization"), Err(QuoteMiss::Absent));
		assert_eq!(find_once("x-y and xy z", "xy z"), Ok((8, 12)));
		assert_eq!(find_once("x-y and xy z", "x-y and"), Ok((0, 7)));
	}

	#[test]
	fn a_quote_matches_whole_words_only() {
		assert_eq!(find_once("Use degree 12 here", "degree 1"), Err(QuoteMiss::Absent));
		assert_eq!(find_once("the model and the models", "the model"), Ok((0, 9)));
		assert_eq!(find_once("my_p + 1 and p + 1", "p + 1"), Ok((13, 18)));
		assert_eq!(find_once("the e\u{fb01}t is \u{fb01}ne", "is fine"), Ok((8, 14)));
		// A quote that starts or ends with a mark other than a letter or digit may sit against a word.
		assert_eq!(find_once("q = p->next;", "->next"), Ok((5, 11)));
		assert_eq!(find_once("call f(x) now", "f("), Ok((5, 7)));
	}

	#[test]
	fn brackets_backticks_and_dollars_are_refused() {
		for quote in ["a[i] = 0", "x]", "`free`", "costs $5"] {
			assert_eq!(find_once(&format!("so {quote} here"), quote), Err(QuoteMiss::Unsafe), "{quote}");
			assert_eq!(check_quote(&format!("so {quote} here"), quote), Err(QuoteMiss::Unsafe), "{quote}");
		}
	}

	#[test]
	fn a_written_quote_is_two_words_or_one_expression_and_short() {
		let text = format!("degree 12 and (void *)(p + 1) and p->next and {}", "w ".repeat(50));
		assert_eq!(check_quote(&text, "degree"), Err(QuoteMiss::Shape));
		assert_eq!(check_quote(&text, "degree 12"), Ok((0, 9)));
		assert!(check_quote(&text, "p->next").is_ok());
		assert!(check_quote(&text, "(void *)(p + 1)").is_ok());
		assert_eq!(check_quote(&text, &"w ".repeat(41)), Err(QuoteMiss::Shape));
	}
}

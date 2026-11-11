//! JavaScript string semantics on Rust strings. `String.length`, `slice`, `substring` and
//! `indexOf` count UTF-16 units, so an emoji is 2 and a cut may split it (the halves become
//! stand-ins, see gs_json::lone). `trim` uses JavaScript's whitespace set.

use gs_json::lone;

/// UTF-16 units of one char: 2 above U+FFFF, 1 for a stand-in (it is one lone unit).
fn units(c: char) -> usize {
	if lone::unit_of(c).is_some() { 1 } else { c.len_utf16() }
}

/// `s.length`.
pub fn len16(s: &str) -> usize {
	s.chars().map(units).sum()
}

/// A relative index as `slice` takes it: negative counts from the end, then clamped to 0..=len.
fn relative(i: i64, len: usize) -> usize {
	if i < 0 { len.saturating_sub(i.unsigned_abs() as usize) } else { (i as usize).min(len) }
}

/// `s.slice(start, end)`; `end` None is "to the end".
pub fn slice16(s: &str, start: i64, end: Option<i64>) -> String {
	let u = lone::to_utf16(s);
	let from = relative(start, u.len());
	let to = end.map_or(u.len(), |e| relative(e, u.len()));
	if from >= to { String::new() } else { lone::from_utf16(&u[from..to]) }
}

/// `s.substring(start, end)`: negatives are 0 and the bounds swap when reversed.
pub fn substring16(s: &str, start: i64, end: Option<i64>) -> String {
	let u = lone::to_utf16(s);
	let clamp = |i: i64| (i.max(0) as usize).min(u.len());
	let (a, b) = (clamp(start), end.map_or(u.len(), clamp));
	let (from, to) = if a <= b { (a, b) } else { (b, a) };
	lone::from_utf16(&u[from..to])
}

/// `s.indexOf(needle, from)` in UTF-16 units; None for -1.
pub fn index_of16(s: &str, needle: &str, from: usize) -> Option<usize> {
	let (h, n) = (lone::to_utf16(s), lone::to_utf16(needle));
	let from = from.min(h.len());
	if n.is_empty() {
		return Some(from);
	}
	(from..=h.len().saturating_sub(n.len())).find(|&i| h[i..].starts_with(&n)).filter(|_| h.len() >= n.len())
}

/// `s.lastIndexOf(needle)` in UTF-16 units; None for -1.
pub fn last_index_of16(s: &str, needle: &str) -> Option<usize> {
	let (h, n) = (lone::to_utf16(s), lone::to_utf16(needle));
	if n.len() > h.len() {
		return None;
	}
	(0..=h.len() - n.len()).rev().find(|&i| h[i..].starts_with(&n))
}

/// `s.charCodeAt(i)`.
pub fn char_code_at(s: &str, i: usize) -> Option<u16> {
	lone::to_utf16(s).get(i).copied()
}

/// JavaScript's WhiteSpace and LineTerminator (what `trim` and `\s` strip). Unlike Rust's
/// `char::is_whitespace` it includes U+FEFF and excludes U+0085.
pub fn is_js_space(c: char) -> bool {
	matches!(c, '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}')
}

/// `s.trim()`.
pub fn trim(s: &str) -> &str {
	s.trim_matches(is_js_space)
}

/// `s.trimStart()`.
pub fn trim_start(s: &str) -> &str {
	s.trim_start_matches(is_js_space)
}

/// `s.trimEnd()`.
pub fn trim_end(s: &str) -> &str {
	s.trim_end_matches(is_js_space)
}

/// `s.padStart(width, fill)` counting UTF-16 units (fill is never empty here).
pub fn pad_start(s: &str, width: usize, fill: char) -> String {
	let len = len16(s);
	let mut out = String::new();
	for _ in len..width {
		out.push(fill);
	}
	out.push_str(s);
	out
}

/// The UTF-8 bytes Node writes for a string (`Buffer.from(s)`, `fs.writeFile`, an HTTP body):
/// lone surrogates become U+FFFD.
pub fn utf8_bytes(s: &str) -> std::borrow::Cow<'_, [u8]> {
	match lone::to_well_formed(s) {
		std::borrow::Cow::Borrowed(b) => std::borrow::Cow::Borrowed(b.as_bytes()),
		std::borrow::Cow::Owned(o) => std::borrow::Cow::Owned(o.into_bytes()),
	}
}

/// `buffer.toString("utf8")` / `fs.readFileSync(f, "utf8")`: bad bytes become U+FFFD, a BOM stays.
pub fn from_utf8_lossy(bytes: &[u8]) -> String {
	String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn lengths_and_cuts_count_utf16_units() {
		let s = "a😀b";
		assert_eq!(len16(s), 4);
		assert_eq!(slice16(s, 0, Some(2)), "a".to_owned() + &lone::from_utf16(&[0xD83D]));
		assert_eq!(len16(&slice16(s, 0, Some(2))), 2);
		assert_eq!(slice16(s, -1, None), "b");
		assert_eq!(slice16(s, 1, Some(3)), "😀");
		assert_eq!(slice16(s, 3, Some(1)), "");
		assert_eq!(substring16(s, 3, Some(1)), "😀");
		assert_eq!(substring16(s, -5, Some(1)), "a");
		assert_eq!(index_of16(s, "b", 0), Some(3));
		assert_eq!(index_of16(s, "x", 0), None);
		assert_eq!(index_of16("ab", "", 5), Some(2));
		assert_eq!(last_index_of16("abab", "ab"), Some(2));
		assert_eq!(char_code_at(s, 1), Some(0xD83D));
		// Rejoined halves are one char again once paired up.
		let joined = slice16(s, 0, Some(2)) + &slice16(s, 2, None);
		assert_eq!(lone::pair_up(&joined), s);
		assert_eq!(&*utf8_bytes(&joined), s.as_bytes());
	}

	#[test]
	fn trim_uses_javascript_whitespace() {
		assert_eq!(trim("\u{feff}\u{a0} x \u{3000}\n"), "x");
		assert_eq!(trim("\u{85}x\u{85}"), "\u{85}x\u{85}");
		assert_eq!(trim_start("  x "), "x ");
		assert_eq!(trim_end("  x "), "  x");
		assert_eq!(pad_start("7", 2, '0'), "07");
	}

	#[test]
	fn utf8_output_replaces_lone_halves() {
		let half = slice16("😀", 0, Some(1));
		assert_eq!(&*utf8_bytes(&half), "\u{FFFD}".as_bytes());
		assert_eq!(from_utf8_lossy(b"\xEF\xBB\xBFok\xFF"), "\u{feff}ok\u{FFFD}");
	}
}

//! JavaScript regular expressions (ECMAScript syntax and meaning through `regress`), with the
//! String methods that use them. Copy a TypeScript pattern as written: `\d`, `\w`, `\s`, `\b`,
//! `.` and lookbehind mean what they mean in JavaScript. Matching runs over UTF-16 units like
//! JavaScript does (without the `u` flag an emoji is two units), so offsets are UTF-16 indices.

use std::ops::Range;
use std::sync::Arc;

use gs_json::lone::{from_utf16, to_utf16};
use regress::Regex;

#[derive(Debug, Clone)]
pub struct Re {
	regex: Regex,
	global: bool,
	unicode: bool,
}

/// One match: the whole text and its groups.
pub struct Caps {
	units: Arc<[u16]>,
	m: regress::Match,
}

impl Caps {
	/// The match's place as UTF-16 indices (what `match.index` and `lastIndex` give).
	pub fn range(&self) -> Range<usize> {
		self.m.range()
	}

	/// `$0` is the whole match; None for a group that did not take part.
	pub fn get(&self, i: usize) -> Option<String> {
		self.m.group(i).map(|r| from_utf16(&self.units[r]))
	}

	pub fn name(&self, name: &str) -> Option<String> {
		self.m.named_group(name).map(|r| from_utf16(&self.units[r]))
	}

	pub fn as_string(&self) -> String {
		from_utf16(&self.units[self.m.range()])
	}

	/// Number of groups, `$0` included.
	pub fn len(&self) -> usize {
		self.m.captures.len() + 1
	}

	pub fn is_empty(&self) -> bool {
		false
	}
}

impl Re {
	/// A pattern from the source (a bad one is a bug, so it panics with the pattern).
	pub fn new(pattern: &str, flags: &str) -> Re {
		Re::try_new(pattern, flags).unwrap_or_else(|e| panic!("bad regex /{pattern}/{flags}: {e}"))
	}

	/// A pattern from input (an agent's grep), refused with regress's reason.
	pub fn try_new(pattern: &str, flags: &str) -> Result<Re, String> {
		let rest: String = flags.chars().filter(|&c| c != 'g').collect();
		let regex = Regex::with_flags(pattern, rest.as_str()).map_err(|e| e.to_string())?;
		Ok(Re { regex, global: flags.contains('g'), unicode: flags.contains('u') || flags.contains('v') })
	}

	fn next_match(&self, units: &[u16], from: usize) -> Option<regress::Match> {
		if self.unicode { self.regex.find_from_utf16(units, from).next() } else { self.regex.find_from_ucs2(units, from).next() }
	}

	/// `re.test(text)` (as a fresh regex: no `lastIndex` carried between calls).
	pub fn test(&self, text: &str) -> bool {
		self.next_match(&to_utf16(text), 0).is_some()
	}

	/// The first match (`text.match(re)` without `g`, `re.exec(text)`).
	pub fn captures(&self, text: &str) -> Option<Caps> {
		let units: Arc<[u16]> = to_utf16(text).into();
		self.next_match(&units, 0).map(|m| Caps { units, m })
	}

	/// Every match (`text.matchAll(re)`); after an empty match the search moves on one unit.
	pub fn captures_iter(&self, text: &str) -> Vec<Caps> {
		let units: Arc<[u16]> = to_utf16(text).into();
		let mut out = Vec::new();
		let mut from = 0;
		while from <= units.len() {
			let Some(m) = self.next_match(&units, from) else { break };
			let r = m.range();
			from = if r.is_empty() { self.advance(&units, r.end) } else { r.end };
			out.push(Caps { units: units.clone(), m });
		}
		out
	}

	/// AdvanceStringIndex: one unit, or a whole pair in unicode mode.
	fn advance(&self, units: &[u16], at: usize) -> usize {
		let pair = self.unicode && (0xD800..0xDC00).contains(&units.get(at).copied().unwrap_or(0)) && (0xDC00..0xE000).contains(&units.get(at + 1).copied().unwrap_or(0));
		at + if pair { 2 } else { 1 }
	}

	/// `text.replace(re, f)`: every match with `g`, else the first.
	pub fn replace_with(&self, text: &str, mut f: impl FnMut(&Caps) -> String) -> String {
		let units = to_utf16(text);
		let mut out = Vec::with_capacity(units.len());
		let mut last = 0;
		let all = self.captures_iter(text);
		for caps in all.iter().take(if self.global { usize::MAX } else { 1 }) {
			let r = caps.range();
			out.extend_from_slice(&units[last..r.start]);
			out.extend(to_utf16(&f(caps)));
			last = r.end;
		}
		out.extend_from_slice(&units[last..]);
		from_utf16(&out)
	}

	/// `text.replace(re, replacement)` with JavaScript's `$` patterns: `$$`, `$&`, `` $` ``, `$'`,
	/// `$1`..`$99` and `$<name>`.
	pub fn replace(&self, text: &str, replacement: &str) -> String {
		self.replace_with(text, |caps| substitute(caps, replacement))
	}

	/// `text.split(re)`, captured groups included like JavaScript (None for a group that did not
	/// take part).
	pub fn split(&self, text: &str) -> Vec<Option<String>> {
		let units = to_utf16(text);
		if units.is_empty() {
			return if self.next_match(&units, 0).is_some() { vec![] } else { vec![Some(String::new())] };
		}
		// The spec tries a sticky match at each q; the leftmost match from q is the first of those.
		let mut out = Vec::new();
		let (mut p, mut q) = (0, 0);
		while q < units.len() {
			let Some(m) = self.next_match(&units, q) else { break };
			q = m.start();
			if q >= units.len() {
				break;
			}
			if m.end() == p {
				q = self.advance(&units, q);
				continue;
			}
			out.push(Some(from_utf16(&units[p..q])));
			for i in 1..=m.captures.len() {
				out.push(m.group(i).map(|g| from_utf16(&units[g])));
			}
			p = m.end();
			q = p;
		}
		out.push(Some(from_utf16(&units[p..])));
		out
	}
}

/// `escapeRegex(s)`: a pattern that matches `s` literally.
pub fn escape(s: &str) -> String {
	s.chars().fold(String::with_capacity(s.len()), |mut out, c| {
		if ".*+?^${}()|[]\\".contains(c) {
			out.push('\\');
		}
		out.push(c);
		out
	})
}

/// GetSubstitution: the replacement text for one match.
fn substitute(caps: &Caps, replacement: &str) -> String {
	let r = caps.range();
	let b = replacement.as_bytes();
	let mut out = String::new();
	let mut i = 0;
	while i < b.len() {
		if b[i] != b'$' || i + 1 == b.len() {
			let c = replacement[i..].chars().next().expect("in bounds");
			out.push(c);
			i += c.len_utf8();
			continue;
		}
		match b[i + 1] {
			b'$' => {
				out.push('$');
				i += 2;
			}
			b'&' => {
				out.push_str(&caps.as_string());
				i += 2;
			}
			b'`' => {
				out.push_str(&from_utf16(&caps.units[..r.start]));
				i += 2;
			}
			b'\'' => {
				out.push_str(&from_utf16(&caps.units[r.end..]));
				i += 2;
			}
			b'<' => match replacement[i + 2..].find('>') {
				Some(end) => {
					out.push_str(&caps.name(&replacement[i + 2..i + 2 + end]).unwrap_or_default());
					i += end + 3;
				}
				None => {
					out.push('$');
					i += 1;
				}
			},
			d @ b'0'..=b'9' => {
				let groups = caps.len() - 1;
				let one = usize::from(d - b'0');
				let two = b.get(i + 2).filter(|c| c.is_ascii_digit()).map(|c| one * 10 + usize::from(c - b'0'));
				match two.filter(|&n| (1..=groups).contains(&n)) {
					Some(n) => {
						out.push_str(&caps.get(n).unwrap_or_default());
						i += 3;
					}
					None if (1..=groups).contains(&one) => {
						out.push_str(&caps.get(one).unwrap_or_default());
						i += 2;
					}
					None => {
						out.push('$');
						i += 1;
					}
				}
			}
			_ => {
				out.push('$');
				i += 1;
			}
		}
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn classes_mean_what_javascript_means() {
		assert!(!Re::new(r"^\d$", "").test("٣"));
		assert!(Re::new(r"^\s$", "").test("\u{feff}"));
		assert!(Re::new(r"(?<!\d)20\d{2}", "").test("x2026"));
		assert!(!Re::new(r"(?<!\d)20\d{2}", "").test("12026"));
		assert!(Re::new("^a.c$", "s").test("a\nc"));
		assert!(!Re::new("^.$", "").test("😀"));
		assert!(Re::new("^.$", "u").test("😀"));
		assert!(Re::try_new("(", "").is_err());
		assert!(Re::new(&escape("a.b(c)*"), "").test("xa.b(c)*"));
		assert!(!Re::new(&escape("a.b"), "").test("axb"));
	}

	#[test]
	fn replace_follows_get_substitution() {
		let re = Re::new(r"(\w)(\d)?", "g");
		assert_eq!(re.replace("a1 b", "[$2$1$$$&]"), "[1a$a1] [b$b]");
		assert_eq!(Re::new("o", "").replace("foo", "0"), "f0o");
		assert_eq!(Re::new("o", "g").replace("foo", "$`|$'"), "ff|ofo|");
		assert_eq!(Re::new("(?<x>o)", "g").replace("fo", "<$<x>>"), "f<o>");
		assert_eq!(Re::new("o", "g").replace("fo", "$9$<"), "f$9$<");
		assert_eq!(Re::new("x*", "g").replace("ab", "-"), "-a-b-");
		assert_eq!(Re::new("[^a]", "g").replace("a😀", "?"), "a??");
	}

	#[test]
	fn split_matches_javascript() {
		let parts = |re: &str, s: &str| Re::new(re, "").split(s).into_iter().map(|p| p.unwrap_or_else(|| "<undefined>".into())).collect::<Vec<_>>();
		assert_eq!(parts(",", "a,b,,c"), ["a", "b", "", "c"]);
		assert_eq!(parts("(,)", "a,b"), ["a", ",", "b"]);
		assert_eq!(parts("", "abc"), ["a", "b", "c"]);
		assert_eq!(parts("x*", "axb"), ["a", "b"]);
		assert_eq!(parts(",", ""), [""]);
		assert!(parts("", "").is_empty());
		assert_eq!(parts(r"\n+", "a\n\nb\n"), ["a", "b", ""]);
		assert_eq!(parts("(x)?,", "a,b"), ["a", "<undefined>", "b"]);
	}
}

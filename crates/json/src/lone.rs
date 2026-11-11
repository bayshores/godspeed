//! Lone UTF-16 surrogates inside Rust strings.
//!
//! JavaScript strings are UTF-16 and may hold half an emoji (a lone surrogate), for example after
//! `text.slice(0, 60)`. `JSON.stringify` writes one as `\udXXX`, and the app's files keep such
//! text. A Rust `String` cannot hold a surrogate, so each lone one is carried as a stand-in: the
//! code point `STANDIN_BASE + (unit - 0xD800)`, the last 2048 code points of plane 16 (private
//! use, never typed or assigned). Every writer turns a stand-in back into what Node writes: the
//! `\udXXX` escape in JSON, U+FFFD in UTF-8 output (files, HTTP text, hashes). Real characters
//! in that range read back as lone surrogates; no real text uses them.

/// The stand-in for the lone surrogate 0xD800.
pub const STANDIN_BASE: u32 = 0x10_F800;

/// The stand-in char for a lone surrogate unit (0xD800..=0xDFFF).
pub fn standin(unit: u16) -> char {
	debug_assert!((0xD800..=0xDFFF).contains(&unit));
	char::from_u32(STANDIN_BASE + u32::from(unit - 0xD800)).expect("stand-ins are valid chars")
}

/// The surrogate unit a stand-in carries, or None for any other char.
pub fn unit_of(c: char) -> Option<u16> {
	let cp = c as u32;
	(cp >= STANDIN_BASE).then(|| (cp - STANDIN_BASE) as u16 + 0xD800)
}

/// True when `s` holds no stand-in, so its UTF-8 bytes are what Node would write.
pub fn is_well_formed(s: &str) -> bool {
	// Every stand-in starts with the UTF-8 lead byte 0xF4 followed by 0x8F 0xA0..=0xBF.
	!s.as_bytes().windows(3).any(|w| w[0] == 0xF4 && w[1] == 0x8F && w[2] >= 0xA0)
}

/// `s` with each stand-in replaced by U+FFFD: what `Buffer.from(string)` encodes. Two halves
/// that sit side by side (after a concatenation) are one character again, as in JavaScript.
pub fn to_well_formed(s: &str) -> std::borrow::Cow<'_, str> {
	if is_well_formed(s) {
		return std::borrow::Cow::Borrowed(s);
	}
	std::borrow::Cow::Owned(pair_up(s).chars().map(|c| if unit_of(c).is_some() { '\u{FFFD}' } else { c }).collect())
}

/// `s` with neighbouring halves joined into the character they make, so it compares and prints
/// like the JavaScript string (`a.slice(0, 2) + a.slice(2)` is `a` again).
pub fn pair_up(s: &str) -> String {
	from_utf16(&to_utf16(s))
}

/// The UTF-16 units JavaScript holds for `s` (a stand-in is its one unit).
pub fn to_utf16(s: &str) -> Vec<u16> {
	let mut out = Vec::with_capacity(s.len());
	for c in s.chars() {
		match unit_of(c) {
			Some(u) => out.push(u),
			None => out.extend(c.encode_utf16(&mut [0; 2]).iter()),
		}
	}
	out
}

/// Builds a string from UTF-16 units the way JavaScript holds them: pairs become chars, lone
/// surrogates become stand-ins.
pub fn from_utf16(units: &[u16]) -> String {
	char::decode_utf16(units.iter().copied())
		.map(|r| r.unwrap_or_else(|e| standin(e.unpaired_surrogate())))
		.collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn standins_round_trip_every_surrogate() {
		for unit in 0xD800..=0xDFFFu16 {
			assert_eq!(unit_of(standin(unit)), Some(unit));
		}
		assert_eq!(unit_of('a'), None);
		assert_eq!(unit_of('\u{10F7FF}'), None);
	}

	#[test]
	fn well_formed_checks_find_standins() {
		assert!(is_well_formed("plain 😀 text"));
		let half = from_utf16(&[0x61, 0xD83D]);
		assert_eq!(half.chars().count(), 2);
		assert!(!is_well_formed(&half));
		assert_eq!(to_well_formed(&half), "a\u{FFFD}");
		// A real pair is one char, never a stand-in.
		assert_eq!(from_utf16(&[0xD83D, 0xDE00]), "😀");
	}
}

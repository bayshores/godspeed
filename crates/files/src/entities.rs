//! XML character references (`&amp;`, `&#x41;`, `&#65;`) decoded, the named ones looked up in the
//! caller's table: Word and PowerPoint keep the TypeScript's, EPUB books add HTML's names.

use std::sync::LazyLock;

use gs_base::re::Re;
use gs_json::lone;

static ENTITY: LazyLock<Re> = LazyLock::new(|| Re::new(r"&(#x[0-9a-f]+|#\d+|\w+);", "gi"));

/// The code point a numeric reference names, or None past U+10FFFF.
fn code_point(code: &str) -> Option<u32> {
	let (digits, radix) = match code.as_bytes()[1] {
		b'x' | b'X' => (&code[2..], 16),
		_ => (&code[1..], 10),
	};
	u32::from_str_radix(digits, radix).ok().filter(|&n| n <= 0x10ffff)
}

/// Every reference decoded; one that names nothing stays as it was.
pub(crate) fn decode_entities(text: &str, named: impl Fn(&str) -> Option<&'static str>) -> String {
	ENTITY.replace_with(text, |m| {
		let whole = m.get(0).unwrap_or_default();
		let code = m.get(1).unwrap_or_default();
		if code.starts_with('#') {
			return match code_point(&code) {
				Some(n) => char::from_u32(n).map_or_else(|| lone::from_utf16(&[n as u16]), String::from),
				None => whole,
			};
		}
		named(&code).map_or(whole, str::to_owned)
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn names_come_from_the_callers_table() {
		let table = |name: &str| (name == "amp").then_some("&");
		assert_eq!(decode_entities("a &amp; b &#x41;&#66; &nbsp; &#x110000;", table), "a & b AB &nbsp; &#x110000;");
		assert_eq!(decode_entities("&amp;", |_| None), "&amp;");
	}
}

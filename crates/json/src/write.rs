//! `JSON.stringify(value)` and `JSON.stringify(value, null, indent)`, byte for byte.

use crate::{Json, lone};

/// `JSON.stringify(value)`.
pub fn stringify(value: &Json) -> String {
	let mut out = String::new();
	write_value(&mut out, value, None, 0);
	out
}

/// `JSON.stringify(value, null, indent)`, e.g. `"\t"` for the app's data files.
pub fn stringify_pretty(value: &Json, indent: &str) -> String {
	let mut out = String::new();
	write_value(&mut out, value, (!indent.is_empty()).then_some(indent), 0);
	out
}

/// JavaScript's `String(n)` for a number, as JSON writes it: `null` when not finite.
pub fn number_text(n: f64) -> String {
	if n.is_finite() { js_number(n) } else { "null".to_owned() }
}

/// `String(n)` for a finite number: shortest round trip, `1e21` and up and below `1e-6` in
/// exponent form, `-0` as `0`.
pub fn js_number(n: f64) -> String {
	if n == 0.0 {
		return "0".to_owned();
	}
	ryu_js::Buffer::new().format_finite(n).to_owned()
}

/// `JSON.stringify(text)`: the quoted string.
pub fn quote(text: &str) -> String {
	let mut out = String::with_capacity(text.len() + 2);
	write_str(&mut out, text);
	out
}

fn newline(out: &mut String, indent: Option<&str>, depth: usize) {
	if let Some(unit) = indent {
		out.push('\n');
		for _ in 0..depth {
			out.push_str(unit);
		}
	}
}

fn write_value(out: &mut String, value: &Json, indent: Option<&str>, depth: usize) {
	match value {
		Json::Null => out.push_str("null"),
		Json::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
		Json::Num(n) => out.push_str(&number_text(*n)),
		Json::Str(s) => write_str(out, s),
		Json::Arr(items) => {
			if items.is_empty() {
				out.push_str("[]");
				return;
			}
			out.push('[');
			for (i, item) in items.iter().enumerate() {
				if i > 0 {
					out.push(',');
				}
				newline(out, indent, depth + 1);
				write_value(out, item, indent, depth + 1);
			}
			newline(out, indent, depth);
			out.push(']');
		}
		Json::Obj(obj) => {
			if obj.is_empty() {
				out.push_str("{}");
				return;
			}
			out.push('{');
			for (i, (key, item)) in obj.iter().enumerate() {
				if i > 0 {
					out.push(',');
				}
				newline(out, indent, depth + 1);
				write_str(out, key);
				out.push(':');
				if indent.is_some() {
					out.push(' ');
				}
				write_value(out, item, indent, depth + 1);
			}
			newline(out, indent, depth);
			out.push('}');
		}
	}
}

fn write_str(out: &mut String, s: &str) {
	let paired;
	let s = if lone::is_well_formed(s) {
		s
	} else {
		paired = lone::pair_up(s);
		&paired
	};
	out.push('"');
	for c in s.chars() {
		match c {
			'"' => out.push_str("\\\""),
			'\\' => out.push_str("\\\\"),
			'\u{8}' => out.push_str("\\b"),
			'\u{c}' => out.push_str("\\f"),
			'\n' => out.push_str("\\n"),
			'\r' => out.push_str("\\r"),
			'\t' => out.push_str("\\t"),
			c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
			c => match lone::unit_of(c) {
				Some(unit) => out.push_str(&format!("\\u{unit:04x}")),
				None => out.push(c),
			},
		}
	}
	out.push('"');
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::parse;

	#[test]
	fn numbers_print_like_javascript() {
		let cases = [
			(0.0, "0"),
			(-0.0, "0"),
			(1.0, "1"),
			(-12.5, "-12.5"),
			(0.1 + 0.2, "0.30000000000000004"),
			(1e21, "1e+21"),
			(1e20, "100000000000000000000"),
			(123456789012345680000.0, "123456789012345680000"),
			(1e-6, "0.000001"),
			(1e-7, "1e-7"),
			(1.5e-10, "1.5e-10"),
			(5e-324, "5e-324"),
			(f64::MAX, "1.7976931348623157e+308"),
			(9007199254740993.0, "9007199254740992"),
		];
		for (n, text) in cases {
			assert_eq!(number_text(n), text, "{n}");
		}
		assert_eq!(number_text(f64::NAN), "null");
		assert_eq!(number_text(f64::NEG_INFINITY), "null");
	}

	#[test]
	fn strings_escape_like_json_stringify() {
		assert_eq!(quote("a\"b\\c/d"), r#""a\"b\\c/d""#);
		assert_eq!(quote("\u{0}\u{1f}\u{7f}\u{8}\u{c}\n\r\t"), "\"\\u0000\\u001f\u{7f}\\b\\f\\n\\r\\t\"");
		assert_eq!(quote("\u{2028}\u{2029}é😀"), "\"\u{2028}\u{2029}é😀\"");
		let half = parse(r#""x\uD83D""#).unwrap();
		assert_eq!(stringify(&half), r#""x\ud83d""#);
		let halves = format!("{}{}", lone::standin(0xD83D), lone::standin(0xDE00));
		assert_eq!(quote(&halves), "\"😀\"");
	}

	#[test]
	fn pretty_matches_tab_indent() {
		let v = parse(r#"{"a":[1,{"b":[]},{}],"c":"d","e":{"f":null}}"#).unwrap();
		assert_eq!(stringify(&v), r#"{"a":[1,{"b":[]},{}],"c":"d","e":{"f":null}}"#);
		assert_eq!(stringify_pretty(&v, "\t"), "{\n\t\"a\": [\n\t\t1,\n\t\t{\n\t\t\t\"b\": []\n\t\t},\n\t\t{}\n\t],\n\t\"c\": \"d\",\n\t\"e\": {\n\t\t\"f\": null\n\t}\n}");
		assert_eq!(stringify_pretty(&parse("[]").unwrap(), "\t"), "[]");
		assert_eq!(stringify_pretty(&parse("5").unwrap(), "  "), "5");
		assert_eq!(stringify_pretty(&v, ""), stringify(&v));
	}
}

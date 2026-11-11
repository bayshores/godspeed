//! JavaScript's `+text` for strings (StringToNumber), which TypeBox's Convert uses to read
//! numbers out of strings.

use gs_base::re::Re;
use gs_base::text::trim;

/// `+text`: NaN when the text is not a number literal.
pub fn string_to_number(text: &str) -> f64 {
	let t = trim(text);
	if t.is_empty() {
		return 0.0;
	}
	for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
		if let Some(digits) = t.strip_prefix(prefix) {
			return radix_number(digits, radix);
		}
	}
	match t {
		"Infinity" | "+Infinity" => return f64::INFINITY,
		"-Infinity" => return f64::NEG_INFINITY,
		_ => {}
	}
	if !Re::new(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$", "").test(t) {
		return f64::NAN;
	}
	t.parse().unwrap_or(f64::NAN)
}

fn radix_number(digits: &str, radix: u32) -> f64 {
	if digits.is_empty() {
		return f64::NAN;
	}
	let mut n = 0.0;
	for c in digits.chars() {
		match c.to_digit(radix) {
			Some(d) => n = n * f64::from(radix) + f64::from(d),
			None => return f64::NAN,
		}
	}
	n
}

/// TypeBox's last try for a string number: `"12n"` reads as 12 when it is a safe integer.
pub fn bigint_literal(text: &str) -> Option<f64> {
	let digits = text.strip_suffix('n')?;
	if !Re::new(r"^-?(0|[1-9]\d*)$", "").test(digits) {
		return None;
	}
	let n: f64 = digits.parse().ok()?;
	(n.abs() <= 9_007_199_254_740_991.0).then_some(if n == 0.0 { 0.0 } else { n })
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_like_javascript() {
		for (text, n) in [("", 0.0), ("  12 ", 12.0), ("0x1F", 31.0), ("1e3", 1000.0), (".5", 0.5), ("5.", 5.0), ("-Infinity", f64::NEG_INFINITY), ("\n7\t", 7.0)] {
			assert_eq!(string_to_number(text), n, "{text:?}");
		}
		for text in ["abc", "1,5", "inf", "nan", "0x", "1e", "--1", "12n"] {
			assert!(string_to_number(text).is_nan(), "{text:?}");
		}
		assert_eq!(bigint_literal("12n"), Some(12.0));
		assert_eq!(bigint_literal("012n"), None);
		assert_eq!(bigint_literal("99999999999999999999n"), None);
	}
}

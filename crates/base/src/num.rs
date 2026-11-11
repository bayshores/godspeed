//! JavaScript number operations whose results differ from Rust's: `Math.round` rounds halves up
//! (toward +∞), `toFixed` rounds exact halves away from zero, and `String(n)`/`toString(36)`.

/// `Math.round(x)`.
pub fn math_round(x: f64) -> f64 {
	if !x.is_finite() {
		return x;
	}
	let floor = x.floor();
	if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

/// `x.toFixed(digits)` for digits 0..=100.
pub fn to_fixed(x: f64, digits: usize) -> String {
	if !x.is_finite() || x.abs() >= 1e21 {
		return gs_json::number_text(x).replace("null", if x.is_nan() { "NaN" } else if x > 0.0 { "Infinity" } else { "-Infinity" });
	}
	// Rust rounds an exact tie to even; JavaScript picks the larger magnitude.
	if is_exact_tie(x.abs(), digits) {
		let step = 10f64.powi(-(digits as i32)) / 2.0;
		let up = x.abs() + step;
		let text = format!("{up:.digits$}");
		return if x < 0.0 { format!("-{text}") } else { text };
	}
	let text = format!("{x:.digits$}");
	if x == 0.0 { text.trim_start_matches('-').to_owned() } else { text }
}

/// True when `x * 10^digits` is exactly an integer plus one half.
fn is_exact_tie(x: f64, digits: usize) -> bool {
	if x == 0.0 {
		return false;
	}
	let bits = x.to_bits();
	let exp = ((bits >> 52) & 0x7ff) as i64;
	let mut mantissa = bits & ((1 << 52) - 1);
	let mut e = if exp == 0 { -1074 } else { exp - 1075 };
	if exp != 0 {
		mantissa |= 1 << 52;
	}
	e += mantissa.trailing_zeros() as i64;
	// x = odd * 2^e; times 10^d = odd * 5^d * 2^(e+d), whose fraction is exactly .5 iff e+d = -1.
	e + digits as i64 == -1
}

/// `n.toString(36)` for a non-negative integer (the time part of ids such as `chat_…`).
pub fn base36(mut n: u64) -> String {
	const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
	if n == 0 {
		return "0".to_owned();
	}
	let mut out = Vec::new();
	while n > 0 {
		out.push(DIGITS[(n % 36) as usize]);
		n /= 36;
	}
	out.reverse();
	String::from_utf8(out).expect("ascii digits")
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn rounds_like_math_round() {
		for (x, r) in [(2.5, 3.0), (-2.5, -2.0), (0.49999999999999994, 0.0), (-0.5, -0.0), (1.4, 1.0), (-1.6, -2.0)] {
			assert_eq!(math_round(x), r, "{x}");
		}
	}

	#[test]
	fn fixed_matches_to_fixed() {
		let cases = [
			(1.125, 2, "1.13"),
			(-1.125, 2, "-1.13"),
			(1.005, 2, "1.00"),
			(2.5, 0, "3"),
			(0.5, 0, "1"),
			(1.45, 1, "1.4"),
			(10.0 / 3.0, 1, "3.3"),
			(1536.0 / 1024.0, 1, "1.5"),
			(-0.0001, 2, "-0.00"),
			(0.0, 1, "0.0"),
			(-0.0, 1, "0.0"),
			(1e21, 2, "1e+21"),
		];
		for (x, d, text) in cases {
			assert_eq!(to_fixed(x, d), text, "{x}.toFixed({d})");
		}
	}

	#[test]
	fn base36_matches_to_string_36() {
		assert_eq!(base36(0), "0");
		assert_eq!(base36(35), "z");
		assert_eq!(base36(1_762_718_400_000), "mhs50u80");
	}
}

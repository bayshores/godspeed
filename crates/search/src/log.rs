//! `Math.log` as the server's V8 (Electron's) computes it: correctly rounded. The platform `ln` is
//! off by one unit in rare cases, which would move BM25 scores and could swap near ties, so this
//! works in double-double precision (about 100 bits) and rounds once at the end.

/// A value as an unevaluated sum `hi + lo` with `|lo| <= ulp(hi) / 2`.
#[derive(Clone, Copy)]
struct Dd(f64, f64);

fn two_sum(a: f64, b: f64) -> Dd {
	let s = a + b;
	let bb = s - a;
	Dd(s, (a - (s - bb)) + (b - bb))
}

fn quick_two_sum(a: f64, b: f64) -> Dd {
	let s = a + b;
	Dd(s, b - (s - a))
}

fn two_prod(a: f64, b: f64) -> Dd {
	let p = a * b;
	Dd(p, a.mul_add(b, -p))
}

impl Dd {
	fn add(self, o: Dd) -> Dd {
		let s = two_sum(self.0, o.0);
		let t = two_sum(self.1, o.1);
		let s = quick_two_sum(s.0, s.1 + t.0);
		quick_two_sum(s.0, s.1 + t.1)
	}

	fn mul(self, o: Dd) -> Dd {
		let p = two_prod(self.0, o.0);
		quick_two_sum(p.0, p.1 + (self.0 * o.1 + self.1 * o.0))
	}

	fn div(self, o: Dd) -> Dd {
		let q1 = self.0 / o.0;
		let r = self.add(o.mul(Dd(-q1, 0.0)));
		let q2 = r.0 / o.0;
		let r = r.add(o.mul(Dd(-q2, 0.0)));
		let q3 = r.0 / o.0;
		quick_two_sum(q1, q2).add(Dd(q3, 0.0))
	}
}

/// ln 2 to about 107 bits.
const LN2: Dd = Dd(std::f64::consts::LN_2, 2.319_046_813_846_299_6e-17);
/// Terms of atanh's series: enough for |s| < 0.172 to pass 2^-106.
const TERMS: u32 = 24;

/// `Math.log(x)`.
pub fn js_log(x: f64) -> f64 {
	if x.is_nan() || x < 0.0 {
		return f64::NAN;
	}
	if x == 0.0 {
		return f64::NEG_INFINITY;
	}
	if x.is_infinite() {
		return x;
	}
	// x = m * 2^k with m in [sqrt(1/2), sqrt(2)).
	let (mut m, mut k) = if x < f64::MIN_POSITIVE { (x * 2f64.powi(54), -54) } else { (x, 0) };
	let bits = m.to_bits();
	k += ((bits >> 52) & 0x7ff) as i32 - 1023;
	m = f64::from_bits((bits & !(0x7ff << 52)) | (1023 << 52));
	if m > std::f64::consts::SQRT_2 {
		m /= 2.0;
		k += 1;
	}
	// ln m = 2 atanh(s) with s = (m - 1) / (m + 1); m - 1 is exact here.
	let s = Dd(m - 1.0, 0.0).div(two_sum(m, 1.0));
	let s2 = s.mul(s);
	let mut sum = Dd(0.0, 0.0);
	for n in (0..TERMS).rev() {
		sum = Dd(1.0, 0.0).div(Dd(f64::from(2 * n + 1), 0.0)).add(s2.mul(sum));
	}
	let ln_m = s.mul(sum).mul(Dd(2.0, 0.0));
	let total = LN2.mul(Dd(f64::from(k), 0.0)).add(ln_m);
	total.0 + total.1
}

#[cfg(test)]
mod tests {
	use super::js_log;

	#[test]
	fn edges_match_math_log() {
		assert_eq!(js_log(1.0), 0.0);
		assert_eq!(js_log(0.0), f64::NEG_INFINITY);
		assert!(js_log(-1.0).is_nan());
		assert!(js_log(f64::NAN).is_nan());
		assert_eq!(js_log(f64::INFINITY), f64::INFINITY);
		assert_eq!(js_log(std::f64::consts::E), 1.0);
		assert_eq!(js_log(2.0), std::f64::consts::LN_2);
		assert_eq!(js_log(5e-324), -744.440_071_921_381_2);
	}

	/// Math.log in Electron for BM25's idf arguments and others (tests/golden/search.json).
	#[test]
	fn values_match_electron_bit_for_bit() {
		let file = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/search.json");
		let golden = gs_json::parse(&std::fs::read_to_string(file).unwrap()).unwrap();
		let case = golden.as_arr().unwrap().iter().find(|c| c["name"] == gs_json::Json::from("log")).unwrap();
		for pair in case["output"].as_arr().unwrap() {
			let (x, want) = (pair[0].as_f64().unwrap(), pair[1].as_f64().unwrap());
			assert_eq!(js_log(x).to_bits(), want.to_bits(), "Math.log({x})");
		}
	}
}

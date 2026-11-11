//! Dates as JavaScript's `Date` handles them: `toISOString`, `Date.parse` for ISO text, and the
//! local time zone from `TZ` (what `getHours()` and `Intl` use).

use jiff::civil::DateTime;
use jiff::tz::TimeZone;
use jiff::{Timestamp, Zoned};

use crate::clock;

const DAY_MS: i64 = 86_400_000;

/// `new Date(ms).toISOString()`.
pub fn iso(ms: i64) -> String {
	let days = ms.div_euclid(DAY_MS);
	let rest = ms.rem_euclid(DAY_MS);
	let (y, m, d) = civil_from_days(days);
	let year = if (0..=9999).contains(&y) { format!("{y:04}") } else if y < 0 { format!("-{:06}", -y) } else { format!("+{y:06}") };
	format!("{year}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rest / 3_600_000, rest / 60_000 % 60, rest / 1000 % 60, rest % 1000)
}

/// `new Date().toISOString()` on the app clock.
pub fn iso_now() -> String {
	iso(clock::now_ms())
}

/// `Date.parse(text)` for the ISO forms the app writes and reads: `YYYY[-MM[-DD]]`, then
/// optionally `THH:mm[:ss[.fff]]` and `Z` or `±HH:mm`. A date alone is UTC; a time with no zone
/// is local. Days past the month's end roll over, as V8 does. Other text is None (NaN).
pub fn parse_date(text: &str) -> Option<i64> {
	let mut p = Cursor { s: text.as_bytes(), i: 0 };
	let year = match p.peek() {
		Some(sign @ (b'+' | b'-')) => {
			p.i += 1;
			let y = p.digits(6)?;
			if sign == b'-' {
				if y == 0 {
					return None;
				}
				-y
			} else {
				y
			}
		}
		_ => p.digits(4)?,
	};
	let has_month = p.eat(b'-');
	let month = if has_month { p.digits(2)? } else { 1 };
	let day = if has_month && p.eat(b'-') { p.digits(2)? } else { 1 };
	if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
		return None;
	}
	let days = days_from_civil(year, month, 1) + day - 1;
	if p.done() {
		return Some(days * DAY_MS);
	}
	if !(p.eat(b'T') || p.eat(b't') || p.eat(b' ')) {
		return None;
	}
	let hour = p.digits(2)?;
	if !p.eat(b':') {
		return None;
	}
	let minute = p.digits(2)?;
	let (mut second, mut millis) = (0, 0);
	if p.eat(b':') {
		second = p.digits(2)?;
		if p.eat(b'.') {
			let start = p.i;
			while p.peek().is_some_and(|b| b.is_ascii_digit()) {
				p.i += 1;
			}
			let frac = &text[start..p.i];
			if frac.is_empty() {
				return None;
			}
			millis = format!("{frac:0<3}")[..3].parse().ok()?;
		}
	}
	if hour > 24 || minute > 59 || second > 59 || (hour == 24 && (minute, second, millis) != (0, 0, 0)) {
		return None;
	}
	let wall = days * DAY_MS + ((hour * 60 + minute) * 60 + second) * 1000 + millis;
	if p.done() {
		return local_wall_to_utc(wall);
	}
	let offset_min = if p.eat(b'Z') || p.eat(b'z') {
		0
	} else {
		let sign = match p.peek()? {
			b'+' => 1,
			b'-' => -1,
			_ => return None,
		};
		p.i += 1;
		let h = p.digits(2)?;
		if !p.eat(b':') {
			return None;
		}
		let m = p.digits(2)?;
		if h > 23 || m > 59 {
			return None;
		}
		sign * (h * 60 + m)
	};
	p.done().then_some(wall - offset_min * 60_000)
}

struct Cursor<'a> {
	s: &'a [u8],
	i: usize,
}

impl Cursor<'_> {
	fn peek(&self) -> Option<u8> {
		self.s.get(self.i).copied()
	}
	fn eat(&mut self, b: u8) -> bool {
		let hit = self.peek() == Some(b);
		if hit {
			self.i += 1;
		}
		hit
	}
	fn done(&self) -> bool {
		self.i == self.s.len()
	}
	fn digits(&mut self, n: usize) -> Option<i64> {
		let part = self.s.get(self.i..self.i + n)?;
		if !part.iter().all(u8::is_ascii_digit) {
			return None;
		}
		self.i += n;
		std::str::from_utf8(part).ok()?.parse().ok()
	}
}

/// A local wall-clock time (as ms on a UTC scale) to the real instant, in the `TZ` zone. A
/// time skipped by a DST change moves forward and a repeated one takes the first, like V8.
fn local_wall_to_utc(wall: i64) -> Option<i64> {
	let ts = Timestamp::from_millisecond(wall).ok()?;
	let civil: DateTime = ts.to_zoned(TimeZone::UTC).datetime();
	Some(civil.to_zoned(TimeZone::system()).ok()?.timestamp().as_millisecond())
}

/// The local date and time of an instant, in the `TZ` zone (`getHours()`, `getDate()`, …).
pub fn local(ms: i64) -> Zoned {
	Timestamp::from_millisecond(ms).unwrap_or(Timestamp::UNIX_EPOCH).to_zoned(TimeZone::system())
}

/// `Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"`.
pub fn tz_name() -> String {
	TimeZone::system().iana_name().unwrap_or("UTC").to_owned()
}

/// Days since 1970-01-01 of a proleptic Gregorian date (month 1..=12).
pub fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
	let y = if m <= 2 { y - 1 } else { y };
	let era = y.div_euclid(400);
	let yoe = y - era * 400;
	let mp = (m + 9) % 12;
	let doy = (153 * mp + 2) / 5 + d - 1;
	let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
	era * 146_097 + doe - 719_468
}

/// The (year, month, day) of a day count since 1970-01-01.
pub fn civil_from_days(days: i64) -> (i64, i64, i64) {
	let z = days + 719_468;
	let era = z.div_euclid(146_097);
	let doe = z - era * 146_097;
	let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
	let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
	let mp = (5 * doy + 2) / 153;
	let d = doy - (153 * mp + 2) / 5 + 1;
	let m = if mp < 10 { mp + 3 } else { mp - 9 };
	(yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn iso_matches_to_iso_string() {
		assert_eq!(iso(1_794_254_400_000), "2026-11-09T20:00:00.000Z");
		assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
		assert_eq!(iso(-1), "1969-12-31T23:59:59.999Z");
		assert_eq!(iso(-62_198_755_200_000), "-000001-01-01T00:00:00.000Z");
		assert_eq!(iso(253_402_300_800_000), "+010000-01-01T00:00:00.000Z");
	}

	#[test]
	fn parses_what_date_parse_takes() {
		assert_eq!(parse_date("2026-11-09T20:00:00.000Z"), Some(1_794_254_400_000));
		assert_eq!(parse_date("2026-11-09"), Some(1_794_182_400_000));
		assert_eq!(parse_date("2026-02-30"), Some(1_772_409_600_000));
		assert_eq!(parse_date("2026-11-09T10:00:00.123456Z"), Some(1_794_218_400_123));
		assert_eq!(parse_date("2026-11-09t10:00z"), Some(1_794_218_400_000));
		assert_eq!(parse_date("2026-11"), Some(1_793_491_200_000));
		assert_eq!(parse_date("2026"), Some(1_767_225_600_000));
		assert_eq!(parse_date("+002026-11-09T00:00:00Z"), Some(1_794_182_400_000));
		assert_eq!(parse_date("2026-11-09T24:00:00Z"), Some(1_794_268_800_000));
		assert_eq!(parse_date("2026-11-09T10:00+05:30"), Some(1_794_198_600_000));
		for bad in ["2026-11-09T10:00:60Z", "2026-13-01", "", "x", "2026-11-09T10", "2026-11-09T10:00Q", "-000000-01-01"] {
			assert_eq!(parse_date(bad), None, "{bad}");
		}
	}

	#[test]
	fn civil_days_round_trip() {
		for days in [-800_000, -1, 0, 1, 20_000, 2_900_000] {
			let (y, m, d) = civil_from_days(days);
			assert_eq!(days_from_civil(y, m, d), days);
		}
	}
}

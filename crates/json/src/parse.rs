//! `JSON.parse`: strict JSON (no BOM, no comments, no trailing commas), whitespace is only
//! space, tab, LF and CR. A repeated key keeps its first place and its last value. `\uXXXX`
//! escapes that pair up become one char; lone ones become stand-ins (lone.rs).

use std::fmt;

use crate::{Json, Obj, lone};

/// Deeper nesting than this is refused instead of overflowing a worker thread's stack.
const MAX_DEPTH: usize = 512;

#[derive(Debug, Clone, PartialEq)]
pub struct ParseError {
	/// Byte offset in the input where parsing stopped.
	pub at: usize,
	pub reason: &'static str,
}

impl fmt::Display for ParseError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{} in JSON at position {}", self.reason, self.at)
	}
}

impl std::error::Error for ParseError {}

pub fn parse(text: &str) -> Result<Json, ParseError> {
	let mut p = Parser { s: text.as_bytes(), text, i: 0, depth: 0 };
	p.ws();
	let value = p.value()?;
	p.ws();
	if p.i != p.s.len() {
		return Err(p.err("Unexpected non-whitespace character after JSON"));
	}
	Ok(value)
}

struct Parser<'a> {
	s: &'a [u8],
	text: &'a str,
	i: usize,
	depth: usize,
}

impl Parser<'_> {
	fn err(&self, reason: &'static str) -> ParseError {
		ParseError { at: self.i, reason }
	}

	fn ws(&mut self) {
		while let Some(b' ' | b'\t' | b'\n' | b'\r') = self.s.get(self.i) {
			self.i += 1;
		}
	}

	fn peek(&self) -> Option<u8> {
		self.s.get(self.i).copied()
	}

	fn literal(&mut self, word: &'static str, value: Json) -> Result<Json, ParseError> {
		if self.s[self.i..].starts_with(word.as_bytes()) {
			self.i += word.len();
			Ok(value)
		} else {
			Err(self.err("Unexpected token"))
		}
	}

	fn value(&mut self) -> Result<Json, ParseError> {
		match self.peek() {
			None => Err(self.err("Unexpected end of JSON input")),
			Some(b'{') => self.nested(Parser::object),
			Some(b'[') => self.nested(Parser::array),
			Some(b'"') => self.string().map(Json::Str),
			Some(b't') => self.literal("true", Json::Bool(true)),
			Some(b'f') => self.literal("false", Json::Bool(false)),
			Some(b'n') => self.literal("null", Json::Null),
			Some(b'-' | b'0'..=b'9') => self.number(),
			Some(_) => Err(self.err("Unexpected token")),
		}
	}

	fn nested(&mut self, f: fn(&mut Self) -> Result<Json, ParseError>) -> Result<Json, ParseError> {
		self.depth += 1;
		if self.depth > MAX_DEPTH {
			return Err(self.err("Maximum nesting depth exceeded"));
		}
		let out = f(self);
		self.depth -= 1;
		out
	}

	fn object(&mut self) -> Result<Json, ParseError> {
		self.i += 1;
		let mut obj = Obj::new();
		self.ws();
		if self.peek() == Some(b'}') {
			self.i += 1;
			return Ok(Json::Obj(obj));
		}
		loop {
			self.ws();
			if self.peek() != Some(b'"') {
				return Err(self.err(if self.peek().is_none() { "Unexpected end of JSON input" } else { "Expected property name" }));
			}
			let key = self.string()?;
			self.ws();
			if self.peek() != Some(b':') {
				return Err(self.err("Expected ':' after property name"));
			}
			self.i += 1;
			self.ws();
			let value = self.value()?;
			obj.insert(key, value);
			self.ws();
			match self.peek() {
				Some(b',') => self.i += 1,
				Some(b'}') => {
					self.i += 1;
					return Ok(Json::Obj(obj));
				}
				None => return Err(self.err("Unexpected end of JSON input")),
				Some(_) => return Err(self.err("Expected ',' or '}' after property value")),
			}
		}
	}

	fn array(&mut self) -> Result<Json, ParseError> {
		self.i += 1;
		let mut items = Vec::new();
		self.ws();
		if self.peek() == Some(b']') {
			self.i += 1;
			return Ok(Json::Arr(items));
		}
		loop {
			self.ws();
			items.push(self.value()?);
			self.ws();
			match self.peek() {
				Some(b',') => self.i += 1,
				Some(b']') => {
					self.i += 1;
					return Ok(Json::Arr(items));
				}
				None => return Err(self.err("Unexpected end of JSON input")),
				Some(_) => return Err(self.err("Expected ',' or ']' after array element")),
			}
		}
	}

	fn number(&mut self) -> Result<Json, ParseError> {
		let start = self.i;
		if self.peek() == Some(b'-') {
			self.i += 1;
		}
		match self.peek() {
			Some(b'0') => self.i += 1,
			Some(b'1'..=b'9') => self.digits(),
			_ => return Err(self.err("No number after minus sign")),
		}
		if self.peek() == Some(b'.') {
			self.i += 1;
			if !matches!(self.peek(), Some(b'0'..=b'9')) {
				return Err(self.err("Unterminated fractional number"));
			}
			self.digits();
		}
		if let Some(b'e' | b'E') = self.peek() {
			self.i += 1;
			if let Some(b'+' | b'-') = self.peek() {
				self.i += 1;
			}
			if !matches!(self.peek(), Some(b'0'..=b'9')) {
				return Err(self.err("Exponent part is missing a number"));
			}
			self.digits();
		}
		// The grammar above is a subset of what f64's parser takes; it rounds correctly like V8.
		let n: f64 = self.text[start..self.i].parse().map_err(|_| self.err("Bad number"))?;
		Ok(Json::Num(n))
	}

	fn digits(&mut self) {
		while let Some(b'0'..=b'9') = self.peek() {
			self.i += 1;
		}
	}

	fn hex4(&mut self) -> Result<u16, ParseError> {
		let Some(hex) = self.text.get(self.i..self.i + 4).filter(|h| h.bytes().all(|b| b.is_ascii_hexdigit())) else {
			return Err(self.err("Bad Unicode escape"));
		};
		self.i += 4;
		Ok(u16::from_str_radix(hex, 16).expect("checked hex digits"))
	}

	fn string(&mut self) -> Result<String, ParseError> {
		self.i += 1;
		let mut out = String::new();
		loop {
			let run = self.i;
			while let Some(&b) = self.s.get(self.i) {
				if b == b'"' || b == b'\\' || b < 0x20 {
					break;
				}
				self.i += 1;
			}
			out.push_str(&self.text[run..self.i]);
			match self.peek() {
				None => return Err(self.err("Unterminated string in JSON")),
				Some(b'"') => {
					self.i += 1;
					return Ok(out);
				}
				Some(b'\\') => {
					self.i += 1;
					self.escape(&mut out)?;
				}
				Some(_) => return Err(self.err("Bad control character in string literal")),
			}
		}
	}

	fn escape(&mut self, out: &mut String) -> Result<(), ParseError> {
		let c = match self.peek() {
			Some(b'"') => '"',
			Some(b'\\') => '\\',
			Some(b'/') => '/',
			Some(b'b') => '\u{8}',
			Some(b'f') => '\u{c}',
			Some(b'n') => '\n',
			Some(b'r') => '\r',
			Some(b't') => '\t',
			Some(b'u') => {
				self.i += 1;
				let unit = self.hex4()?;
				out.push(self.unit_char(unit)?);
				return Ok(());
			}
			_ => return Err(self.err("Bad escaped character")),
		};
		self.i += 1;
		out.push(c);
		Ok(())
	}

	/// The char for one `\uXXXX` unit: a high surrogate pairs with an immediately following
	/// `\uDC00..\uDFFF` escape; any other surrogate is lone.
	fn unit_char(&mut self, unit: u16) -> Result<char, ParseError> {
		if let Some(c) = char::from_u32(u32::from(unit)) {
			return Ok(c);
		}
		if (0xD800..0xDC00).contains(&unit) && self.s[self.i..].starts_with(b"\\u") {
			let save = self.i;
			self.i += 2;
			if let Ok(low @ 0xDC00..=0xDFFF) = self.hex4() {
				return Ok(char::from_u32(0x10000 + ((u32::from(unit) - 0xD800) << 10) + (u32::from(low) - 0xDC00)).expect("valid pair"));
			}
			self.i = save;
		}
		Ok(lone::standin(unit))
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn rejects_what_json_parse_rejects() {
		for bad in ["", " ", "\u{feff}{}", "{,}", "[1,]", "{\"a\":1,}", "01", "1.", ".5", "+1", "-", "1e", "\"\t\"", "\"\\x\"", "\"\\u12\"", "nul", "NaN", "{'a':1}", "[1] 2", "\u{a0}1", "\"a"] {
			assert!(parse(bad).is_err(), "{bad:?} should fail");
		}
	}

	#[test]
	fn reads_numbers_like_v8() {
		assert_eq!(parse("-0").unwrap(), Json::Num(-0.0));
		assert!(parse("-0").unwrap().as_f64().unwrap().is_sign_negative());
		assert_eq!(parse("1e400").unwrap(), Json::Num(f64::INFINITY));
		assert_eq!(parse("9007199254740993").unwrap(), Json::Num(9007199254740992.0));
		assert_eq!(parse("0.1").unwrap(), Json::Num(0.1));
		assert_eq!(parse(" \t\r\n 2E-3 ").unwrap(), Json::Num(0.002));
	}

	#[test]
	fn pairs_surrogates_and_keeps_lone_ones() {
		assert_eq!(parse(r#""\ud83d\ude00""#).unwrap(), Json::from("😀"));
		let half = parse(r#""a\ud83d""#).unwrap();
		assert_eq!(half.as_str().unwrap().chars().nth(1).and_then(lone::unit_of), Some(0xD83D));
		let swapped = parse(r#""\ude00\ud83d""#).unwrap();
		let units: Vec<_> = swapped.as_str().unwrap().chars().filter_map(lone::unit_of).collect();
		assert_eq!(units, [0xDE00, 0xD83D]);
		assert_eq!(parse(r#""\ud83dx""#).unwrap().as_str().unwrap().chars().count(), 2);
	}

	#[test]
	fn repeated_keys_keep_first_place_and_last_value() {
		let v = parse(r#"{"a":1,"b":2,"a":3}"#).unwrap();
		let keys: Vec<_> = v.as_obj().unwrap().keys().cloned().collect();
		assert_eq!(keys, ["a", "b"]);
		assert_eq!(v["a"], Json::Num(3.0));
	}

	#[test]
	fn deep_nesting_is_refused_not_a_crash() {
		let deep = "[".repeat(MAX_DEPTH + 1) + &"]".repeat(MAX_DEPTH + 1);
		assert!(parse(&deep).is_err());
		let ok = "[".repeat(MAX_DEPTH) + &"]".repeat(MAX_DEPTH);
		assert!(parse(&ok).is_ok());
	}
}

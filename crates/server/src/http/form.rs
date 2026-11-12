//! `req.formData()` as undici reads it: a multipart body (or a URL-encoded one) into its entries,
//! None where formData() throws. The steps follow undici's formdata-parser.js, quirks included
//! (the body ends 4 bytes before the next boundary text, wherever that text shows up).

use crate::http::paths::search_params;

pub struct Entry {
	pub name: String,
	/// Set for a file part (a part with a filename).
	pub file_name: Option<String>,
	pub value: Vec<u8>,
}

impl Entry {
	/// A text entry's value (UTF-8 without taking off a BOM, bad bytes as U+FFFD).
	pub fn text(&self) -> String {
		String::from_utf8_lossy(&self.value).into_owned()
	}
}

pub fn parse(content_type: &str, body: &[u8]) -> Option<Vec<Entry>> {
	let (essence, params) = content_type_of(content_type)?;
	if essence == "application/x-www-form-urlencoded" {
		let text = String::from_utf8_lossy(body);
		// URLSearchParams drops one leading "?"; the "&" keeps search_params from dropping more.
		let query = format!("&{}", text.strip_prefix('?').unwrap_or(&text));
		return Some(search_params(&query).into_iter().map(|(name, value)| Entry { name, file_name: None, value: value.into_bytes() }).collect());
	}
	if essence != "multipart/form-data" {
		return None;
	}
	let boundary = params.into_iter().find(|(k, _)| k == "boundary")?.1;
	multipart(body, format!("--{boundary}").as_bytes())
}

const fn is_http_ws(c: char) -> bool {
	matches!(c, '\t' | '\n' | '\r' | ' ')
}

fn is_token_str(s: &str) -> bool {
	!s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

/// Collects an HTTP quoted string at `at` (which is a `"`): the raw text, or its value.
fn quoted_string(chars: &[char], at: &mut usize, extract: bool) -> String {
	let start = *at;
	let mut value = String::new();
	*at += 1;
	loop {
		while *at < chars.len() && chars[*at] != '"' && chars[*at] != '\\' {
			value.push(chars[*at]);
			*at += 1;
		}
		if *at >= chars.len() {
			break;
		}
		let quote_or_backslash = chars[*at];
		*at += 1;
		if quote_or_backslash == '\\' {
			if *at >= chars.len() {
				value.push('\\');
				break;
			}
			value.push(chars[*at]);
			*at += 1;
		} else {
			break;
		}
	}
	if extract { value } else { chars[start..*at].iter().collect() }
}

/// The Content-Type header's MIME type as fetch extracts it: the header split at commas
/// outside quotes, and the last value that parses wins. Its essence and parameters.
fn content_type_of(header: &str) -> Option<(String, Vec<(String, String)>)> {
	let chars: Vec<char> = header.chars().collect();
	let (mut at, mut value, mut found) = (0, String::new(), None);
	loop {
		while at < chars.len() && chars[at] != '"' && chars[at] != ',' {
			value.push(chars[at]);
			at += 1;
		}
		if at < chars.len() && chars[at] == '"' {
			value.push_str(&quoted_string(&chars, &mut at, false));
			if at < chars.len() {
				continue;
			}
		}
		if let Some(mime) = mime_type(value.trim_matches(['\t', ' '])).filter(|m| m.0 != "*/*") {
			found = Some(mime);
		}
		value.clear();
		if at >= chars.len() {
			return found;
		}
		at += 1;
	}
}

/// WHATWG "parse a MIME type": its essence and parameters (first of a name wins).
fn mime_type(input: &str) -> Option<(String, Vec<(String, String)>)> {
	let chars: Vec<char> = input.trim_matches(is_http_ws).chars().collect();
	let mut at = 0;
	let collect = |at: &mut usize, stop: &dyn Fn(char) -> bool| {
		let start = *at;
		while *at < chars.len() && !stop(chars[*at]) {
			*at += 1;
		}
		chars[start..*at].iter().collect::<String>()
	};
	let kind = collect(&mut at, &|c| c == '/');
	if !is_token_str(&kind) || at >= chars.len() {
		return None;
	}
	at += 1;
	let subtype = collect(&mut at, &|c| c == ';');
	let subtype = subtype.trim_end_matches(is_http_ws);
	if !is_token_str(subtype) {
		return None;
	}
	let essence = format!("{kind}/{subtype}").to_ascii_lowercase();
	let mut params: Vec<(String, String)> = Vec::new();
	while at < chars.len() {
		at += 1;
		collect(&mut at, &|c| !is_http_ws(c));
		let name = collect(&mut at, &|c| c == ';' || c == '=').to_ascii_lowercase();
		if at < chars.len() {
			if chars[at] == ';' {
				continue;
			}
			at += 1;
		}
		if at >= chars.len() {
			break;
		}
		let value = if chars[at] == '"' {
			let value = quoted_string(&chars, &mut at, true);
			collect(&mut at, &|c| c == ';');
			value
		} else {
			let value = collect(&mut at, &|c| c == ';');
			let value = value.trim_end_matches(is_http_ws).to_owned();
			if value.is_empty() {
				continue;
			}
			value
		};
		let quoted_ok = value.chars().all(|c| c == '\t' || (' '..='~').contains(&c) || ('\u{80}'..='\u{ff}').contains(&c));
		if is_token_str(&name) && quoted_ok && !params.iter().any(|(k, _)| *k == name) {
			params.push((name, value));
		}
	}
	Some((essence, params))
}

fn starts_with(input: &[u8], at: usize, prefix: &[u8]) -> bool {
	input.get(at..).is_some_and(|rest| rest.starts_with(prefix))
}

fn index_of(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
	if needle.is_empty() {
		return Some(from.min(hay.len()));
	}
	hay.get(from..)?.windows(needle.len()).position(|w| w == needle).map(|i| i + from)
}

fn crlf_at(input: &[u8], at: usize) -> bool {
	starts_with(input, at, b"\r\n")
}

fn multipart(input: &[u8], boundary: &[u8]) -> Option<Vec<Entry>> {
	let mut entries = Vec::new();
	// Anything before the first boundary is a preamble.
	let mut at = index_of(input, boundary, 0)?;
	loop {
		if !starts_with(input, at, boundary) {
			return None;
		}
		at += boundary.len();
		// The closing boundary: anything after it is an epilogue.
		if starts_with(input, at, b"--") {
			return Some(entries);
		}
		if !crlf_at(input, at) {
			return None;
		}
		at += 2;
		let part = headers(input, &mut at)?;
		at += 2;
		let end = index_of(input, &boundary[2..], at)?;
		let mut body = input.get(at..end.saturating_sub(4).max(at)).unwrap_or_default().to_vec();
		at += body.len();
		if part.encoding.as_deref() == Some("base64") {
			body = gs_base::base64::decode(&String::from_utf8_lossy(&body));
		}
		if !crlf_at(input, at) {
			return None;
		}
		at += 2;
		entries.push(Entry { name: part.name, file_name: part.file_name, value: body });
	}
}

struct Part {
	name: String,
	file_name: Option<String>,
	encoding: Option<String>,
}

fn collect<'a>(input: &'a [u8], at: &mut usize, keep: impl Fn(u8) -> bool) -> &'a [u8] {
	let start = *at;
	while *at < input.len() && keep(input[*at]) {
		*at += 1;
	}
	&input[start..*at]
}

const fn is_space(b: u8) -> bool {
	b == b' ' || b == b'\t'
}

const fn is_token(b: u8) -> bool {
	b < 0x7f && b > 0x1f && b != b' ' && !matches!(b, b'(' | b')' | b'<' | b'>' | b'@' | b',' | b';' | b':' | b'\\' | b'"' | b'/' | b'[' | b']' | b'?' | b'=')
}

/// undici's removeChars: the trailing loop never takes the first byte.
fn trim(bytes: &[u8], leading: bool) -> &[u8] {
	let mut lead = 0;
	if leading {
		while lead < bytes.len() && is_space(bytes[lead]) {
			lead += 1;
		}
	}
	let mut trail = bytes.len();
	while trail > 1 && is_space(bytes[trail - 1]) {
		trail -= 1;
	}
	bytes.get(lead..trail).unwrap_or_default()
}

/// TextDecoder's default decode: UTF-8 with a leading BOM taken off.
fn decode(bytes: &[u8]) -> String {
	String::from_utf8_lossy(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes)).into_owned()
}

/// A part's headers, up to the blank line that ends them (left at `at`).
fn headers(input: &[u8], at: &mut usize) -> Option<Part> {
	let (mut name, mut file_name, mut encoding) = (None, None, None);
	loop {
		if crlf_at(input, *at) {
			return Some(Part { name: name?, file_name, encoding });
		}
		let header = trim(collect(input, at, |b| b != b'\n' && b != b'\r' && b != b':'), true);
		if !is_token_str(&String::from_utf8_lossy(header)) || input.get(*at) != Some(&b':') {
			return None;
		}
		*at += 1;
		collect(input, at, is_space);
		match header.to_ascii_lowercase().as_slice() {
			b"content-disposition" => {
				name = None;
				file_name = None;
				let mut extended_file_name = false;
				if !collect(input, at, is_token).eq_ignore_ascii_case(b"form-data") {
					return None;
				}
				while *at < input.len() && !crlf_at(input, *at) {
					let Some((attribute, value, extended)) = attribute(input, at).ok()? else { break };
					if attribute == "name" {
						name = Some(value);
					} else if attribute == "filename" && (extended || !extended_file_name) {
						file_name = Some(value);
						extended_file_name |= extended;
					}
				}
				name.as_ref()?;
			}
			b"content-transfer-encoding" => {
				let value = trim(collect(input, at, |b| b != b'\n' && b != b'\r'), false);
				encoding = Some(value.iter().map(|&b| char::from(b)).collect());
			}
			_ => {
				collect(input, at, |b| b != b'\n' && b != b'\r');
			}
		}
		if !crlf_at(input, *at) {
			return None;
		}
		*at += 2;
	}
}

/// One content-disposition attribute: Ok(None) ends the list, Err where undici throws.
fn attribute(input: &[u8], at: &mut usize) -> Result<Option<(String, String, bool)>, ()> {
	if input.get(*at) == Some(&b';') {
		*at += 1;
	}
	collect(input, at, is_space);
	let name = collect(input, at, |b| is_token(b) && b != b'*').to_ascii_lowercase();
	if name.is_empty() {
		return Ok(None);
	}
	let extended = input.get(*at) == Some(&b'*');
	if extended {
		*at += 1;
	}
	if input.get(*at) != Some(&b'=') {
		return Ok(None);
	}
	*at += 1;
	collect(input, at, is_space);
	let value = if extended {
		let raw = collect(input, at, |b| b != b' ' && b != b'\r' && b != b'\n' && b != b';');
		if raw.len() < 5 || !raw[..3].eq_ignore_ascii_case(b"utf") || &raw[3..5] != b"-8" {
			return Err(());
		}
		decode_uri_component(&decode(raw.get(7..).unwrap_or_default())).ok_or(())?
	} else if input.get(*at) == Some(&b'"') {
		*at += 1;
		let raw = collect(input, at, |b| b != b'\n' && b != b'\r' && b != b'"');
		if input.get(*at) != Some(&b'"') {
			return Err(());
		}
		*at += 1;
		unescape(&decode(raw))
	} else {
		decode(collect(input, at, is_token))
	};
	Ok(Some((String::from_utf8_lossy(&name).into_owned(), value, extended)))
}

/// %0A, %0D (either case) and %22 back to the characters a browser escaped.
fn unescape(s: &str) -> String {
	let mut out = String::with_capacity(s.len());
	let mut rest = s;
	while let Some(i) = rest.find('%') {
		out.push_str(&rest[..i]);
		let code = rest.get(i + 1..i + 3).map(str::to_ascii_uppercase);
		match code.as_deref() {
			Some("0A") => out.push('\n'),
			Some("0D") => out.push('\r'),
			Some("22") => out.push('"'),
			_ => {
				out.push('%');
				rest = &rest[i + 1..];
				continue;
			}
		}
		rest = &rest[i + 3..];
	}
	out.push_str(rest);
	out
}

/// decodeURIComponent: None where it throws (a bad escape, or bytes that are not UTF-8).
fn decode_uri_component(s: &str) -> Option<String> {
	let bytes = s.as_bytes();
	let mut out = Vec::with_capacity(bytes.len());
	let mut i = 0;
	while i < bytes.len() {
		if bytes[i] == b'%' {
			let hex = s.get(i + 1..i + 3).filter(|h| h.bytes().all(|b| b.is_ascii_hexdigit()))?;
			out.push(u8::from_str_radix(hex, 16).ok()?);
			i += 3;
		} else {
			out.push(bytes[i]);
			i += 1;
		}
	}
	String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
	use gs_json::{Json, parse as parse_json};

	use super::*;

	fn unhex(h: &str) -> Vec<u8> {
		(0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect()
	}

	fn hex(bytes: &[u8]) -> String {
		bytes.iter().map(|b| format!("{b:02x}")).collect()
	}

	/// Parity with undici (tests/golden/space-forms.json, made by space-forms.golden.ts).
	#[test]
	fn forms_match_undici() {
		let golden = parse_json(include_str!("../../tests/golden/space-forms.json")).unwrap();
		let cases = golden[0]["output"].as_arr().unwrap();
		assert!(cases.len() > 30);
		for case in cases {
			let got = parse(case["contentType"].as_str().unwrap(), &unhex(case["hex"].as_str().unwrap())).map(|entries| {
				Json::Arr(
					entries
						.iter()
						.map(|e| match &e.file_name {
							Some(file_name) => gs_json::json!({ "name": e.name.as_str(), "fileName": file_name.as_str(), "hex": hex(&e.value) }),
							None => gs_json::json!({ "name": e.name.as_str(), "text": e.text() }),
						})
						.collect(),
				)
			});
			assert_eq!(got.unwrap_or(Json::Null), case["entries"], "{}", case["name"].as_str().unwrap());
		}
	}

}

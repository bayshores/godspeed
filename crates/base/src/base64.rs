//! Base64 as Node's Buffer reads and writes it.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// `buffer.toString("base64")`.
pub fn encode(bytes: &[u8]) -> String {
	let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
	for chunk in bytes.chunks(3) {
		let n = chunk.iter().enumerate().fold(0u32, |acc, (i, &b)| acc | u32::from(b) << (16 - 8 * i));
		for i in 0..4 {
			out.push(if i <= chunk.len() { ALPHABET[(n >> (18 - 6 * i)) as usize & 63] as char } else { '=' });
		}
	}
	out
}

/// `Buffer.from(text, "base64")`: the URL-safe letters count too, other characters are skipped and
/// decoding stops at "=".
pub fn decode(text: &str) -> Vec<u8> {
	let sextets: Vec<u8> = text
		.chars()
		.take_while(|&c| c != '=')
		.filter_map(|c| match c {
			'A'..='Z' => Some(c as u8 - b'A'),
			'a'..='z' => Some(c as u8 - b'a' + 26),
			'0'..='9' => Some(c as u8 - b'0' + 52),
			'+' | '-' => Some(62),
			'/' | '_' => Some(63),
			_ => None,
		})
		.collect();
	let mut out = Vec::with_capacity(sextets.len() * 3 / 4);
	for chunk in sextets.chunks(4) {
		let n = chunk.iter().enumerate().fold(0u32, |n, (i, &s)| n | (u32::from(s) << (18 - 6 * i)));
		let [_, a, b, c] = n.to_be_bytes();
		out.extend_from_slice(&[a, b, c][..chunk.len().saturating_sub(1)]);
	}
	out
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn encodes_with_padding() {
		assert_eq!(encode(b""), "");
		assert_eq!(encode(b"f"), "Zg==");
		assert_eq!(encode(b"fo"), "Zm8=");
		assert_eq!(encode(b"foo"), "Zm9v");
		assert_eq!(encode(b"hi!?"), "aGkhPw==");
		assert_eq!(encode(&[0xff, 0xfe, 0xfd, 0x00]), "//79AA==");
	}

	#[test]
	fn decodes_like_buffer() {
		assert_eq!(decode("aGk="), b"hi");
		assert_eq!(decode("aG\r\nk"), b"hi");
		assert_eq!(decode("aGVsbG8"), b"hello");
		assert_eq!(decode("__79AA=="), [0xff, 0xfe, 0xfd, 0x00]);
		assert_eq!(decode("aGk=aGk="), b"hi");
	}

	#[test]
	fn round_trips_every_length() {
		for bytes in [&b""[..], b"a", b"ab", b"abc", b"abcd", b"%PDF-1.4\n\xff\x00"] {
			assert_eq!(decode(&encode(bytes)), bytes);
		}
	}
}

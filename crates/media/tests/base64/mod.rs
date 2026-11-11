//! Standard base64 decoding for the golden files.

pub fn decode(text: &str) -> Vec<u8> {
	let mut out = Vec::with_capacity(text.len() / 4 * 3);
	let (mut bits, mut have) = (0u32, 0);
	for c in text.bytes().filter(|&c| c != b'=') {
		let v = match c {
			b'A'..=b'Z' => c - b'A',
			b'a'..=b'z' => c - b'a' + 26,
			b'0'..=b'9' => c - b'0' + 52,
			b'+' => 62,
			b'/' => 63,
			_ => panic!("not base64: {c}"),
		};
		bits = bits << 6 | u32::from(v);
		have += 6;
		if have >= 8 {
			have -= 8;
			out.push((bits >> have) as u8);
			bits &= (1 << have) - 1;
		}
	}
	out
}

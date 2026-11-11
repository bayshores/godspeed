//! A PNG with its IDAT chunks merged into one (providerSafePng in headless.ts), the form every
//! image sent to a vision model has.

const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

/// `png` with one IDAT chunk at the first IDAT's place. Anything that is not a PNG, has fewer
/// than two IDAT chunks, or ends in a cut-off chunk comes back as it was, except that a cut-off
/// tail is dropped when merging.
pub(crate) fn provider_safe_png(png: Vec<u8>) -> Vec<u8> {
	if png.len() < SIGNATURE.len() + 12 || png[..SIGNATURE.len()] != SIGNATURE {
		return png;
	}
	let mut parts: Vec<(&[u8], &[u8])> = Vec::new();
	let mut at = SIGNATURE.len();
	while at + 12 <= png.len() {
		let len = u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]) as usize;
		if at + 12 + len > png.len() {
			break;
		}
		parts.push((&png[at + 4..at + 8], &png[at + 8..at + 8 + len]));
		at += 12 + len;
	}
	if parts.iter().filter(|(kind, _)| *kind == b"IDAT").count() < 2 {
		return png;
	}
	let merged: Vec<u8> = parts.iter().filter(|(kind, _)| *kind == b"IDAT").flat_map(|(_, data)| data.iter().copied()).collect();
	let mut out = SIGNATURE.to_vec();
	let mut wrote_idat = false;
	for (kind, data) in parts {
		if kind != b"IDAT" {
			chunk(&mut out, kind, data);
		} else if !wrote_idat {
			chunk(&mut out, kind, &merged);
			wrote_idat = true;
		}
	}
	out
}

/// One chunk: length, type, data, CRC-32 of type and data.
fn chunk(out: &mut Vec<u8>, kind: &[u8], data: &[u8]) {
	out.extend_from_slice(&(data.len() as u32).to_be_bytes());
	let body_start = out.len();
	out.extend_from_slice(kind);
	out.extend_from_slice(data);
	let crc = crc32(&out[body_start..]);
	out.extend_from_slice(&crc.to_be_bytes());
}

/// CRC-32 with PNG's polynomial.
fn crc32(bytes: &[u8]) -> u32 {
	let mut crc = !0u32;
	for &byte in bytes {
		crc ^= u32::from(byte);
		for _ in 0..8 {
			crc = (crc >> 1) ^ (0xedb8_8320 & 0u32.wrapping_sub(crc & 1));
		}
	}
	!crc
}

#[cfg(test)]
mod tests {
	use super::*;

	fn png(idats: &[&[u8]], tail: &[u8]) -> Vec<u8> {
		let mut out = SIGNATURE.to_vec();
		chunk(&mut out, b"IHDR", &[0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
		for data in idats {
			chunk(&mut out, b"IDAT", data);
		}
		chunk(&mut out, b"IEND", &[]);
		out.extend_from_slice(tail);
		out
	}

	fn kinds(png: &[u8]) -> Vec<String> {
		let mut at = SIGNATURE.len();
		let mut out = Vec::new();
		while at + 12 <= png.len() {
			out.push(String::from_utf8_lossy(&png[at + 4..at + 8]).into_owned());
			at += 12 + u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]) as usize;
		}
		out
	}

	#[test]
	fn crc32_matches_the_standard_check_value() {
		assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
		assert_eq!(crc32(b"IEND"), 0xae42_6082);
	}

	#[test]
	fn merges_idat_chunks_into_the_first_ones_place() {
		let merged = provider_safe_png(png(&[b"ab", b"cd", b"e"], &[]));
		assert_eq!(kinds(&merged), ["IHDR", "IDAT", "IEND"]);
		assert_eq!(merged, png(&[b"abcde"], &[]));
	}

	#[test]
	fn leaves_other_input_alone() {
		let one = png(&[b"ab"], &[]);
		assert_eq!(provider_safe_png(one.clone()), one);
		assert_eq!(provider_safe_png(b"not a png at all, just text".to_vec()), b"not a png at all, just text");
		assert_eq!(provider_safe_png(Vec::new()), Vec::<u8>::new());
	}

	#[test]
	fn drops_a_cut_off_tail_when_merging() {
		let cut = png(&[b"ab", b"cd"], &[0, 0, 0, 9, b'x', b'x']);
		assert_eq!(provider_safe_png(cut), png(&[b"abcd"], &[]));
	}
}

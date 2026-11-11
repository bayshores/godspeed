//! PNG fixes: merging split IDAT chunks, and adding the IEND chunk an attached PNG may lack,
//! which libpng forgives.

const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
/// Signature plus the smallest chunk (length, type, CRC).
const MIN_LEN: usize = 8 + 12;

struct Chunk<'a> {
	kind: [u8; 4],
	data: &'a [u8],
}

/// Merge a PNG's split IDAT chunks into one (same zlib stream, no re-encoding), because some
/// vision decoders refuse the 4 KB split Chrome and Skia write. Every chunk is rewritten with a
/// fresh CRC; bytes after the last whole chunk are dropped. A PNG without a split comes back as is.
pub fn provider_safe_png(png: &[u8]) -> Vec<u8> {
	if png.len() < MIN_LEN || png[..8] != SIGNATURE {
		return png.to_vec();
	}
	let (chunks, _) = whole_chunks(png);
	let is_idat = |c: &Chunk| &c.kind == b"IDAT";
	if chunks.iter().filter(|c| is_idat(c)).count() < 2 {
		return png.to_vec();
	}
	let merged: Vec<u8> = chunks.iter().filter(|c| is_idat(c)).flat_map(|c| c.data.iter().copied()).collect();
	let mut out = SIGNATURE.to_vec();
	let mut emitted_idat = false;
	for c in &chunks {
		if !is_idat(c) {
			out.extend(chunk(c.kind, c.data));
		} else if !emitted_idat {
			out.extend(chunk(c.kind, &merged));
			emitted_idat = true;
		}
	}
	out
}

/// The whole chunks after the signature and where the last one ends.
fn whole_chunks(png: &[u8]) -> (Vec<Chunk<'_>>, usize) {
	let mut chunks = Vec::new();
	let mut off = 8;
	while off + 12 <= png.len() {
		let len = u32::from_be_bytes([png[off], png[off + 1], png[off + 2], png[off + 3]]) as usize;
		if off + 12 + len > png.len() {
			break;
		}
		// Node reads the type as ASCII, which drops each byte's top bit.
		let kind = [png[off + 4] & 0x7f, png[off + 5] & 0x7f, png[off + 6] & 0x7f, png[off + 7] & 0x7f];
		chunks.push(Chunk { kind, data: &png[off + 8..off + 8 + len] });
		off += 12 + len;
	}
	(chunks, off)
}

/// The PNG with an IEND chunk added when it stops cleanly after a chunk without one, which
/// libpng reads and the png crate refuses; None when nothing needs adding.
pub(crate) fn with_end_chunk(png: &[u8]) -> Option<Vec<u8>> {
	let (chunks, end) = whole_chunks(png);
	if end != png.len() || chunks.iter().any(|c| &c.kind == b"IEND") {
		return None;
	}
	let mut out = png.to_vec();
	out.extend(chunk(*b"IEND", &[]));
	Some(out)
}

/// One PNG chunk: length, type, data, CRC of type and data.
fn chunk(kind: [u8; 4], data: &[u8]) -> Vec<u8> {
	let mut out = Vec::with_capacity(12 + data.len());
	out.extend((data.len() as u32).to_be_bytes());
	out.extend(kind);
	out.extend(data);
	out.extend(crc32(&out[4..]).to_be_bytes());
	out
}

/// CRC-32 with PNG's polynomial.
fn crc32(bytes: &[u8]) -> u32 {
	let mut c = !0u32;
	for &byte in bytes {
		c ^= u32::from(byte);
		for _ in 0..8 {
			c = (c >> 1) ^ (0xedb8_8320 & (c & 1).wrapping_neg());
		}
	}
	!c
}

#[cfg(test)]
mod tests {
	use super::*;

	fn png_of(chunks: &[(&[u8; 4], &[u8])]) -> Vec<u8> {
		let mut out = SIGNATURE.to_vec();
		for (kind, data) in chunks {
			out.extend(chunk(**kind, data));
		}
		out
	}

	#[test]
	fn crc32_known_values() {
		assert_eq!(crc32(b""), 0);
		assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
		assert_eq!(crc32(b"IEND"), 0xae42_6082);
	}

	#[test]
	fn chunk_layout() {
		assert_eq!(chunk(*b"IEND", &[]), [0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xae, 0x42, 0x60, 0x82]);
		let c = chunk(*b"IDAT", &[1, 2, 3]);
		assert_eq!(&c[..11], [0, 0, 0, 3, b'I', b'D', b'A', b'T', 1, 2, 3]);
		assert_eq!(&c[11..], crc32(&c[4..11]).to_be_bytes());
	}

	#[test]
	fn merges_split_idat_into_the_first_place() {
		let split = png_of(&[(b"IHDR", &[9; 13]), (b"IDAT", &[1, 2]), (b"tEXt", b"hi"), (b"IDAT", &[3]), (b"IEND", &[])]);
		let want = png_of(&[(b"IHDR", &[9; 13]), (b"IDAT", &[1, 2, 3]), (b"tEXt", b"hi"), (b"IEND", &[])]);
		assert_eq!(provider_safe_png(&split), want);
	}

	#[test]
	fn single_idat_and_non_png_pass_through() {
		let one = png_of(&[(b"IHDR", &[9; 13]), (b"IDAT", &[1, 2]), (b"IEND", &[])]);
		assert_eq!(provider_safe_png(&one), one);
		assert_eq!(provider_safe_png(b"not a png at all, just text"), b"not a png at all, just text");
		assert_eq!(provider_safe_png(&SIGNATURE), SIGNATURE);
	}

	#[test]
	fn a_truncated_tail_is_dropped_and_bad_crcs_are_fixed() {
		let mut png = png_of(&[(b"IDAT", &[1]), (b"IDAT", &[2])]);
		let crc_at = png.len() - 1;
		png[crc_at] ^= 0xff;
		png.extend([0, 0, 0, 200, b'I', b'D', b'A', b'T', 7]);
		assert_eq!(provider_safe_png(&png), png_of(&[(b"IDAT", &[1, 2])]));
	}

	#[test]
	fn a_missing_end_chunk_is_added_only_after_a_whole_chunk() {
		let whole = png_of(&[(b"IHDR", &[9; 13]), (b"IDAT", &[1, 2]), (b"IEND", &[])]);
		let cut = &whole[..whole.len() - 12];
		assert_eq!(with_end_chunk(cut), Some(whole.clone()));
		assert_eq!(with_end_chunk(&whole), None);
		assert_eq!(with_end_chunk(&cut[..cut.len() - 1]), None);
	}

	#[test]
	fn chunk_types_lose_their_top_bit_like_node() {
		let mut png = png_of(&[(b"IDAT", &[1]), (b"IDAT", &[2]), (b"abcd", &[5])]);
		let last = png.len() - 13;
		png[last + 4] |= 0x80;
		assert_eq!(provider_safe_png(&png), png_of(&[(b"IDAT", &[1, 2]), (b"abcd", &[5])]));
	}
}

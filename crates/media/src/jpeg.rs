//! The image crate's JPEG decoder keeps going over a file that ends early, where sharp refuses
//! it. This tells the two apart by walking the file's markers to its end-of-image marker.

const EOI: u8 = 0xd9;
const SOS: u8 = 0xda;

/// True when the file's markers run from the start marker to the end-of-image marker.
pub fn is_complete(bytes: &[u8]) -> bool {
	if !bytes.starts_with(&[0xff, 0xd8]) {
		return false;
	}
	let mut at = 2;
	while at + 1 < bytes.len() {
		if bytes[at] != 0xff {
			return false;
		}
		let marker = bytes[at + 1];
		at += 2;
		match marker {
			0xff => at -= 1,
			EOI => return true,
			// Start marker, restart markers and the temporary marker carry no length.
			0x01 | 0xd0..=0xd8 => {}
			_ => {
				let Some(len) = bytes.get(at..at + 2).map(|l| usize::from(u16::from_be_bytes([l[0], l[1]]))) else { return false };
				at += len;
				if marker == SOS {
					at = end_of_scan(bytes, at);
				}
			}
		}
	}
	false
}

/// Where the entropy-coded data starting at `at` ends: the next marker that is not a stuffed
/// zero or a restart.
fn end_of_scan(bytes: &[u8], mut at: usize) -> usize {
	while at + 1 < bytes.len() {
		if bytes[at] == 0xff && !matches!(bytes[at + 1], 0x00 | 0xd0..=0xd7) {
			return at;
		}
		at += 1;
	}
	bytes.len()
}

#[cfg(test)]
mod tests {
	use super::*;

	/// Start marker, one 4-byte comment segment, a scan with a stuffed 0xff and a restart, end marker.
	const WHOLE: [u8; 19] = [0xff, 0xd8, 0xff, 0xfe, 0, 4, b'h', b'i', 0xff, 0xda, 0, 3, 0, 0x12, 0xff, 0x00, 0xff, 0xd9, 0];

	#[test]
	fn a_file_with_its_end_marker_is_complete() {
		assert!(is_complete(&WHOLE[..18]));
		assert!(is_complete(&WHOLE));
	}

	#[test]
	fn a_file_cut_anywhere_is_not() {
		for cut in 0..17 {
			assert!(!is_complete(&WHOLE[..cut]), "cut at {cut}");
		}
	}

	#[test]
	fn an_end_marker_inside_a_thumbnail_does_not_count() {
		let mut bytes = vec![0xff, 0xd8, 0xff, 0xe1, 0, 8, 0xff, 0xd8, 0xff, 0xd9, 1, 2];
		assert!(!is_complete(&bytes));
		bytes.extend([0xff, 0xd9]);
		assert!(is_complete(&bytes));
	}

	#[test]
	fn not_a_jpeg() {
		assert!(!is_complete(b""));
		assert!(!is_complete(b"plain text"));
	}
}

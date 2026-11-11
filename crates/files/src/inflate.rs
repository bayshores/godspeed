//! Raw deflate, with the strictness of zlib (what `inflateRawSync` accepts and refuses). The zip
//! crate checks CRCs and declared sizes, which the TypeScript reader never did.

const MAX_BITS: usize = 15;
const LENGTH_BASE: [u16; 29] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA: [u8; 29] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE: [u16; 30] = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA: [u8; 30] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
/// The order the code-length code's own lengths come in.
const CLEN_ORDER: [usize; 19] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

struct Bits<'a> {
	data: &'a [u8],
	pos: usize,
	buf: u32,
	count: u32,
}

impl Bits<'_> {
	fn take(&mut self, n: u32) -> Option<u32> {
		while self.count < n {
			self.buf |= u32::from(*self.data.get(self.pos)?) << self.count;
			self.pos += 1;
			self.count += 8;
		}
		let v = self.buf & ((1u32 << n) - 1);
		self.buf >>= n;
		self.count -= n;
		Some(v)
	}
}

/// A canonical Huffman code: how many codes of each length, and the symbols in code order.
struct Code {
	count: [u16; MAX_BITS + 1],
	symbol: Vec<u16>,
}

impl Code {
	/// The code for these lengths and whether it is incomplete; None when over-subscribed.
	fn new(lengths: &[u8]) -> Option<(Code, bool)> {
		let mut count = [0u16; MAX_BITS + 1];
		for &l in lengths {
			count[usize::from(l)] += 1;
		}
		let mut code = Code { count, symbol: vec![0; lengths.len()] };
		if usize::from(count[0]) == lengths.len() {
			return Some((code, false));
		}
		let mut left = 1i32;
		for &n in &count[1..] {
			left = (left << 1) - i32::from(n);
			if left < 0 {
				return None;
			}
		}
		let mut offs = [0u16; MAX_BITS + 1];
		for len in 1..MAX_BITS {
			offs[len + 1] = offs[len] + count[len];
		}
		for (sym, &l) in lengths.iter().enumerate() {
			if l != 0 {
				code.symbol[usize::from(offs[usize::from(l)])] = sym as u16;
				offs[usize::from(l)] += 1;
			}
		}
		Some((code, left > 0))
	}

	fn decode(&self, bits: &mut Bits) -> Option<usize> {
		let (mut code, mut first, mut index) = (0i32, 0i32, 0i32);
		for len in 1..=MAX_BITS {
			code |= bits.take(1)? as i32;
			let count = i32::from(self.count[len]);
			if code - count < first {
				return Some(usize::from(self.symbol[(index + (code - first)) as usize]));
			}
			index += count;
			first = (first + count) << 1;
			code <<= 1;
		}
		None
	}
}

/// The data inflated, or None for a stream zlib refuses, one that ends early, or output past
/// `max_out` bytes. Bytes after the last block are ignored, like zlib.
pub(crate) fn inflate_raw(data: &[u8], max_out: usize) -> Option<Vec<u8>> {
	let mut bits = Bits { data, pos: 0, buf: 0, count: 0 };
	let mut out = Vec::new();
	loop {
		let last = bits.take(1)? == 1;
		match bits.take(2)? {
			0 => stored(&mut bits, &mut out, max_out)?,
			1 => {
				let (lit, dist) = fixed_codes();
				codes(&mut bits, &mut out, max_out, &lit, &dist)?;
			}
			2 => {
				let (lit, dist) = dynamic_codes(&mut bits)?;
				codes(&mut bits, &mut out, max_out, &lit, &dist)?;
			}
			_ => return None,
		}
		if last {
			return Some(out);
		}
	}
}

fn stored(bits: &mut Bits, out: &mut Vec<u8>, max_out: usize) -> Option<()> {
	bits.buf = 0;
	bits.count = 0;
	let head = bits.data.get(bits.pos..bits.pos + 4)?;
	let len = usize::from(u16::from_le_bytes([head[0], head[1]]));
	if len != usize::from(!u16::from_le_bytes([head[2], head[3]])) {
		return None;
	}
	bits.pos += 4;
	let block = bits.data.get(bits.pos..bits.pos + len)?;
	if out.len() + len > max_out {
		return None;
	}
	out.extend_from_slice(block);
	bits.pos += len;
	Some(())
}

fn fixed_codes() -> (Code, Code) {
	let mut lengths = [8u8; 288];
	lengths[144..256].fill(9);
	lengths[256..280].fill(7);
	let lit = Code::new(&lengths).map(|(c, _)| c).expect("the fixed code is complete");
	let dist = Code::new(&[5u8; 30]).map(|(c, _)| c).expect("the fixed distance code is valid");
	(lit, dist)
}

fn dynamic_codes(bits: &mut Bits) -> Option<(Code, Code)> {
	let nlen = bits.take(5)? as usize + 257;
	let ndist = bits.take(5)? as usize + 1;
	let ncode = bits.take(4)? as usize + 4;
	if nlen > 286 || ndist > 30 {
		return None;
	}
	let mut lengths = [0u8; 320];
	for &slot in &CLEN_ORDER[..ncode] {
		lengths[slot] = bits.take(3)? as u8;
	}
	let (clen, incomplete) = Code::new(&lengths[..19])?;
	if incomplete {
		return None;
	}
	lengths = [0u8; 320];
	let mut at = 0;
	while at < nlen + ndist {
		let sym = clen.decode(bits)?;
		if sym < 16 {
			lengths[at] = sym as u8;
			at += 1;
			continue;
		}
		let (value, repeat) = match sym {
			16 if at > 0 => (lengths[at - 1], 3 + bits.take(2)? as usize),
			16 => return None,
			17 => (0, 3 + bits.take(3)? as usize),
			_ => (0, 11 + bits.take(7)? as usize),
		};
		if at + repeat > nlen + ndist {
			return None;
		}
		lengths[at..at + repeat].fill(value);
		at += repeat;
	}
	if lengths[256] == 0 {
		return None;
	}
	// An incomplete code is fine only as a single code of length 1.
	let (lit, lit_incomplete) = Code::new(&lengths[..nlen])?;
	if lit_incomplete && nlen != usize::from(lit.count[0] + lit.count[1]) {
		return None;
	}
	let (dist, dist_incomplete) = Code::new(&lengths[nlen..nlen + ndist])?;
	if dist_incomplete && ndist != usize::from(dist.count[0] + dist.count[1]) {
		return None;
	}
	Some((lit, dist))
}

fn codes(bits: &mut Bits, out: &mut Vec<u8>, max_out: usize, lit: &Code, dist: &Code) -> Option<()> {
	loop {
		let sym = lit.decode(bits)?;
		if sym < 256 {
			if out.len() == max_out {
				return None;
			}
			out.push(sym as u8);
			continue;
		}
		if sym == 256 {
			return Some(());
		}
		let sym = sym - 257;
		if sym >= 29 {
			return None;
		}
		let len = usize::from(LENGTH_BASE[sym]) + bits.take(u32::from(LENGTH_EXTRA[sym]))? as usize;
		let dsym = dist.decode(bits)?;
		if dsym >= 30 {
			return None;
		}
		let back = usize::from(DIST_BASE[dsym]) + bits.take(u32::from(DIST_EXTRA[dsym]))? as usize;
		if back > out.len() || out.len() + len > max_out {
			return None;
		}
		for _ in 0..len {
			out.push(out[out.len() - back]);
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn reads_stored_fixed_and_empty_blocks() {
		assert_eq!(inflate_raw(&[1, 3, 0, 0xfc, 0xff, b'a', b'b', b'c'], 10).unwrap(), b"abc");
		assert_eq!(inflate_raw(&[0x03, 0x00], 10).unwrap(), b"");
		// "hello" as a fixed-Huffman block, then trailing bytes that are ignored.
		assert_eq!(inflate_raw(&[0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x07, 0x00, 9, 9], 10).unwrap(), b"hello");
	}

	#[test]
	fn refuses_what_zlib_refuses() {
		assert!(inflate_raw(&[], 10).is_none());
		assert!(inflate_raw(&[1, 5, 0, 0, 0, 1, 2, 3, 4, 5], 10).is_none());
		assert!(inflate_raw(&[0xcb, 0x48, 0xcd, 0xc9], 10).is_none());
		assert!(inflate_raw(&[0x07], 10).is_none());
		assert!(inflate_raw(&[1, 3, 0, 0xfc, 0xff, b'a', b'b', b'c'], 2).is_none());
	}
}

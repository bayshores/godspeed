//! A zip archive's files by name, read lazily from the central directory exactly as office-text.ts
//! does: sizes and offsets are taken on trust and checksums are never looked at.

use std::collections::HashMap;

use gs_base::text::from_utf8_lossy;

use crate::inflate::inflate_raw;

pub(crate) const NOT_OFFICE: &str = "This file can't be opened as a Word or PowerPoint file. Save it again as .docx, .pptx or PDF.";
pub(crate) const LOCKED: &str = "This file is password-protected. Save a copy without a password, or as PDF.";
/// Most one part may unpack to: a real document's XML is far smaller, and a tiny file that
/// unpacks to gigabytes would stall the server.
const MAX_PART_BYTES: usize = 64 * 1024 * 1024;

struct Entry {
	flags: u16,
	method: u16,
	size: usize,
	local: usize,
}

pub(crate) struct Zip {
	buf: Vec<u8>,
	/// Names in the order they first appear; a repeated name keeps its place and takes the later entry.
	names: Vec<String>,
	entries: HashMap<String, Entry>,
}

fn le16(buf: &[u8], at: usize) -> usize {
	usize::from(u16::from_le_bytes([buf[at], buf[at + 1]]))
}

fn le32(buf: &[u8], at: usize) -> usize {
	u32::from_le_bytes([buf[at], buf[at + 1], buf[at + 2], buf[at + 3]]) as usize
}

impl Zip {
	pub(crate) fn open(buf: Vec<u8>) -> Result<Zip, String> {
		// Office files with a password are not zips but OLE compound files.
		if buf.starts_with(&[0xd0, 0xcf, 0x11, 0xe0]) {
			return Err(LOCKED.to_owned());
		}
		let last_start = buf.len().checked_sub(22).ok_or(NOT_OFFICE)?;
		let eocd = (buf.len().saturating_sub(65_557)..=last_start).rev().find(|&i| buf[i..].starts_with(&[0x50, 0x4b, 0x05, 0x06])).ok_or(NOT_OFFICE)?;
		let count = le16(&buf, eocd + 10);
		let mut at = le32(&buf, eocd + 16);
		let (mut names, mut entries) = (Vec::new(), HashMap::new());
		for _ in 0..count {
			if at + 46 > buf.len() || !buf[at..].starts_with(&[0x50, 0x4b, 0x01, 0x02]) {
				return Err(NOT_OFFICE.to_owned());
			}
			let name_len = le16(&buf, at + 28);
			let name = from_utf8_lossy(&buf[at + 46..(at + 46 + name_len).min(buf.len())]);
			let entry = Entry { flags: le16(&buf, at + 8) as u16, method: le16(&buf, at + 10) as u16, size: le32(&buf, at + 20), local: le32(&buf, at + 42) };
			at += 46 + name_len + le16(&buf, at + 30) + le16(&buf, at + 32);
			if entries.insert(name.clone(), entry).is_none() {
				names.push(name);
			}
		}
		Ok(Zip { buf, names, entries })
	}

	pub(crate) fn has(&self, name: &str) -> bool {
		self.entries.contains_key(name)
	}

	pub(crate) fn names(&self) -> impl Iterator<Item = &str> {
		self.names.iter().map(String::as_str)
	}

	/// The file's bytes, or None when the archive has no such file.
	pub(crate) fn read(&self, name: &str) -> Result<Option<Vec<u8>>, String> {
		let Some(entry) = self.entries.get(name) else { return Ok(None) };
		if entry.flags & 1 != 0 {
			return Err(LOCKED.to_owned());
		}
		let buf = &self.buf;
		if entry.local + 30 > buf.len() || !buf[entry.local..].starts_with(&[0x50, 0x4b, 0x03, 0x04]) {
			return Err(NOT_OFFICE.to_owned());
		}
		let start = (entry.local + 30 + le16(buf, entry.local + 26) + le16(buf, entry.local + 28)).min(buf.len());
		let data = &buf[start..(start + entry.size).min(buf.len())];
		match entry.method {
			0 => Ok(Some(data.to_vec())),
			8 => inflate_raw(data, MAX_PART_BYTES).map(Some).ok_or_else(|| NOT_OFFICE.to_owned()),
			_ => Err(NOT_OFFICE.to_owned()),
		}
	}

	/// `read` as UTF-8 text.
	pub(crate) fn read_text(&self, name: &str) -> Result<Option<String>, String> {
		Ok(self.read(name)?.map(|bytes| from_utf8_lossy(&bytes)))
	}
}

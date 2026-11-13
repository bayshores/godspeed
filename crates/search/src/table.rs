//! One stored search table: `<base>.json` (format, model, rows, and for passages each indexed
//! file's fingerprint and size) next to `<base>.f32` (one 384-float little-endian vector per row,
//! in row order).

use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use gs_base::{fsx, text};
use gs_json::{Json, Obj, js_number, parse, quote, stringify};

use crate::embed::{DIMS, MODEL_ID};
use crate::keyword::KeywordIndex;

/// Bump when the stored rows change shape.
const FORMAT: f64 = 1.0;

pub struct Table {
	/// Passages `{ id, fileId, range, from, to, text, hash }` or facts `{ id, hash }`, kept as read.
	/// A table written from another shares its rows, as the TS's filtered arrays share objects.
	pub rows: Vec<Arc<Json>>,
	pub vectors: Vec<f32>,
	/// Passages only: file id to `{ fp, extent }`.
	pub files: Obj,
	/// Built on first search, dropped with the table.
	pub keywords: OnceLock<Result<Arc<KeywordIndex>, String>>,
}

impl Table {
	pub fn new(rows: Vec<Arc<Json>>, vectors: Vec<f32>, files: Obj) -> Table {
		Table { rows, vectors, files, keywords: OnceLock::new() }
	}

	pub fn empty() -> Table {
		Table::new(Vec::new(), Vec::new(), Obj::new())
	}

	pub fn vector(&self, row: usize) -> &[f32] {
		&self.vectors[row * DIMS..(row + 1) * DIMS]
	}

	/// The rows that pass `keep`, with their vectors.
	pub fn keep_rows(&self, keep: impl Fn(&Json) -> bool) -> (Vec<Arc<Json>>, Vec<f32>) {
		let mut rows = Vec::with_capacity(self.rows.len());
		let mut vectors = Vec::with_capacity(self.vectors.len());
		for (i, row) in self.rows.iter().enumerate() {
			if keep(row) {
				vectors.extend_from_slice(self.vector(i));
				rows.push(row.clone());
			}
		}
		(rows, vectors)
	}

	/// `keep_rows` that moves the kept vectors down in this table's own buffer.
	pub fn into_kept_rows(self, keep: impl Fn(&Json) -> bool) -> (Vec<Arc<Json>>, Vec<f32>) {
		let Table { rows, mut vectors, .. } = self;
		let mut kept = Vec::with_capacity(rows.len());
		for (i, row) in rows.into_iter().enumerate() {
			if keep(&row) {
				vectors.copy_within(i * DIMS..(i + 1) * DIMS, kept.len() * DIMS);
				kept.push(row);
			}
		}
		vectors.truncate(kept.len() * DIMS);
		(kept, vectors)
	}
}

fn with_suffix(base: &Path, suffix: &str) -> PathBuf {
	let mut name = base.as_os_str().to_owned();
	name.push(suffix);
	PathBuf::from(name)
}

/// The table at `base`; empty when absent, unreadable, from another model or format, or when its
/// two files disagree.
pub fn load(base: &Path) -> Table {
	let Ok(text) = fsx::read_text(&with_suffix(base, ".json")) else { return Table::empty() };
	let Ok(mut meta) = parse(&text) else { return Table::empty() };
	drop(text);
	let Ok(bytes) = std::fs::read(with_suffix(base, ".f32")) else { return Table::empty() };
	let Some(rows) = meta["rows"].as_arr() else { return Table::empty() };
	if bytes.len() % 4 != 0 || meta["format"] != Json::from(FORMAT) || meta["model"] != Json::from(MODEL_ID) || bytes.len() / 4 != rows.len() * DIMS {
		return Table::empty();
	}
	let vectors = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
	// Taken, not copied: a space's rows run to tens of MB in memory.
	let Some(Json::Arr(rows)) = meta.get_mut("rows").map(std::mem::take) else { return Table::empty() };
	let rows = rows.into_iter().map(Arc::new).collect();
	let files = match meta.get_mut("files").map(std::mem::take) {
		Some(Json::Obj(files)) => files,
		_ => Obj::new(),
	};
	Table::new(rows, vectors, files)
}

/// Writes the vectors and the rows (files only when there are any), both before either is renamed
/// into place, as the TS's writeTable does. Both stream to disk: the text is written row by row, as
/// `JSON.stringify` of `{ format, model, rows, files? }` would. An index rebuild writes its table
/// once per file, and whole copies of it lingered as freed memory.
pub fn save(base: &Path, table: &Table) -> io::Result<()> {
	let vectors = |out: &mut dyn Write| table.vectors.iter().try_for_each(|v| out.write_all(&v.to_le_bytes()));
	let rows = |out: &mut dyn Write| {
		write!(out, "{{\"format\":{},\"model\":{},\"rows\":[", js_number(FORMAT), quote(MODEL_ID))?;
		for (i, row) in table.rows.iter().enumerate() {
			if i > 0 {
				out.write_all(b",")?;
			}
			out.write_all(&text::utf8_bytes(&stringify(row)))?;
		}
		out.write_all(b"]")?;
		if !table.files.is_empty() {
			out.write_all(b",\"files\":")?;
			out.write_all(&text::utf8_bytes(&stringify(&Json::Obj(table.files.clone()))))?;
		}
		out.write_all(b"}")
	};
	fsx::write_atomic_pair(&with_suffix(base, ".f32"), vectors, &with_suffix(base, ".json"), rows)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_table_round_trips_and_bad_ones_read_empty() {
		let dir = std::env::temp_dir().join(format!("gs-search-table-{}", std::process::id()));
		let base = dir.join("search").join("facts");
		let row = parse(r#"{"id":"n1","hash":"abc","extra":[1]}"#).unwrap();
		save(&base, &Table::new(vec![Arc::new(row.clone())], vec![0.5; DIMS], Obj::new())).unwrap();
		assert_eq!(std::fs::read_to_string(dir.join("search/facts.json")).unwrap(), r#"{"format":1,"model":"Snowflake/snowflake-arctic-embed-xs","rows":[{"id":"n1","hash":"abc","extra":[1]}]}"#);
		let back = load(&base);
		assert_eq!((back.rows, back.vectors.len(), back.files.len()), (vec![Arc::new(row)], DIMS, 0));
		fsx::write_atomic(&dir.join("search/facts.f32"), &[0u8; 6], None).unwrap();
		assert!(load(&base).rows.is_empty());
		assert!(load(&dir.join("missing")).rows.is_empty());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn rows_kept_in_place_match_rows_kept_by_copy() {
		let rows: Vec<Arc<Json>> = (0..5).map(|i| Arc::new(parse(&format!(r#"{{"id":"r{i}","keep":{}}}"#, i % 2 == 0)).unwrap())).collect();
		let vectors = (0..5).flat_map(|i| vec![i as f32; DIMS]).collect();
		let table = Table::new(rows, vectors, Obj::new());
		let keep = |r: &Json| r["keep"].truthy();
		let copied = table.keep_rows(keep);
		assert_eq!(copied.1.iter().step_by(DIMS).copied().collect::<Vec<_>>(), [0.0, 2.0, 4.0]);
		assert_eq!(table.into_kept_rows(keep), copied);
	}

	#[test]
	fn a_table_with_files_writes_what_json_stringify_writes() {
		let dir = std::env::temp_dir().join(format!("gs-search-table-files-{}", std::process::id()));
		let base = dir.join("search").join("passages");
		let rows = vec![
			parse(r#"{"id":"p1","fileId":"f_a","range":"p. 1","from":0,"to":12.5,"text":"Sets \"and\"\nfunctions é","hash":"h1"}"#).unwrap(),
			parse(r#"{"id":"p2","fileId":"f_b","range":"","from":-0,"to":1e21,"text":"\ud800 lone","hash":"h2"}"#).unwrap(),
		];
		let files = parse(r#"{"2":{"fp":"x","extent":"1"},"f_a":{"fp":"fa","extent":"3 pages"},"f_b":{"fp":"fb","extent":"9 lines"}}"#).unwrap();
		let Json::Obj(files) = files else { unreachable!() };
		save(&base, &Table::new(rows.iter().cloned().map(Arc::new).collect(), vec![0.25; 2 * DIMS], files.clone())).unwrap();
		let mut meta = Obj::new();
		meta.insert("format", FORMAT);
		meta.insert("model", MODEL_ID);
		meta.insert("rows", Json::Arr(rows.clone()));
		meta.insert("files", files.clone());
		assert_eq!(fsx::read_text(&dir.join("search/passages.json")).unwrap(), stringify(&Json::Obj(meta)));
		let back = load(&base);
		assert_eq!((back.rows, back.vectors, back.files), (rows.into_iter().map(Arc::new).collect(), vec![0.25; 2 * DIMS], files));
		std::fs::remove_dir_all(dir).unwrap();
	}
}

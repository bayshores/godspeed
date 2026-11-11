//! One stored search table: `<base>.json` (format, model, rows, and for passages each indexed
//! file's fingerprint and size) next to `<base>.f32` (one 384-float little-endian vector per row,
//! in row order).

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use gs_base::fsx;
use gs_json::{Json, Obj, parse, stringify};

use crate::embed::{DIMS, MODEL_ID};
use crate::keyword::KeywordIndex;

/// Bump when the stored rows change shape.
const FORMAT: f64 = 1.0;

pub struct Table {
	/// Passages `{ id, fileId, range, from, to, text, hash }` or facts `{ id, hash }`, kept as read.
	pub rows: Vec<Json>,
	pub vectors: Vec<f32>,
	/// Passages only: file id to `{ fp, extent }`.
	pub files: Obj,
	/// Built on first search, dropped with the table.
	pub keywords: OnceLock<Result<Arc<KeywordIndex>, String>>,
}

impl Table {
	pub fn new(rows: Vec<Json>, vectors: Vec<f32>, files: Obj) -> Table {
		Table { rows, vectors, files, keywords: OnceLock::new() }
	}

	pub fn empty() -> Table {
		Table::new(Vec::new(), Vec::new(), Obj::new())
	}

	pub fn vector(&self, row: usize) -> &[f32] {
		&self.vectors[row * DIMS..(row + 1) * DIMS]
	}

	/// The rows that pass `keep`, with their vectors.
	pub fn keep_rows(&self, keep: impl Fn(&Json) -> bool) -> (Vec<Json>, Vec<f32>) {
		let mut rows = Vec::new();
		let mut vectors = Vec::new();
		for (i, row) in self.rows.iter().enumerate() {
			if keep(row) {
				vectors.extend_from_slice(self.vector(i));
				rows.push(row.clone());
			}
		}
		(rows, vectors)
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
	let Ok(meta) = parse(&text) else { return Table::empty() };
	let Ok(bytes) = std::fs::read(with_suffix(base, ".f32")) else { return Table::empty() };
	let Some(rows) = meta["rows"].as_arr() else { return Table::empty() };
	if bytes.len() % 4 != 0 || meta["format"] != Json::from(FORMAT) || meta["model"] != Json::from(MODEL_ID) || bytes.len() / 4 != rows.len() * DIMS {
		return Table::empty();
	}
	let vectors = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
	Table::new(rows.clone(), vectors, meta["files"].as_obj().cloned().unwrap_or_default())
}

/// Writes the vectors, then the rows (files only when there are any).
pub fn save(base: &Path, table: &Table) -> io::Result<()> {
	let mut meta = Obj::new();
	meta.insert("format", FORMAT);
	meta.insert("model", MODEL_ID);
	meta.insert("rows", Json::Arr(table.rows.clone()));
	if !table.files.is_empty() {
		meta.insert("files", table.files.clone());
	}
	let bytes: Vec<u8> = table.vectors.iter().flat_map(|v| v.to_le_bytes()).collect();
	fsx::write_atomic(&with_suffix(base, ".f32"), &bytes, None)?;
	fsx::write_text_atomic(&with_suffix(base, ".json"), &stringify(&Json::Obj(meta)))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_table_round_trips_and_bad_ones_read_empty() {
		let dir = std::env::temp_dir().join(format!("gs-search-table-{}", std::process::id()));
		let base = dir.join("search").join("facts");
		let row = parse(r#"{"id":"n1","hash":"abc","extra":[1]}"#).unwrap();
		save(&base, &Table::new(vec![row.clone()], vec![0.5; DIMS], Obj::new())).unwrap();
		assert_eq!(std::fs::read_to_string(dir.join("search/facts.json")).unwrap(), r#"{"format":1,"model":"Snowflake/snowflake-arctic-embed-xs","rows":[{"id":"n1","hash":"abc","extra":[1]}]}"#);
		let back = load(&base);
		assert_eq!((back.rows, back.vectors.len(), back.files.len()), (vec![row], DIMS, 0));
		fsx::write_atomic(&dir.join("search/facts.f32"), &[0u8; 6], None).unwrap();
		assert!(load(&base).rows.is_empty());
		assert!(load(&dir.join("missing")).rows.is_empty());
		std::fs::remove_dir_all(dir).unwrap();
	}
}

//! A space's passage table: indexing and dropping files, search_space_files and read_passage
//! (the space-file half of src/backend/server/search-index.ts).

use std::collections::HashMap;

use gs_base::text;
use gs_json::{Json, Obj};

use crate::chunks::{chunk_file, range_point, snippet_of};
use crate::index::{PassageRef, Search, field, hash_of, keywords_of, rank};
use crate::table::Table;

/// Most characters read_passage returns.
const READ_LIMIT_CHARS: usize = 6000;

/// A space file's id to its name, from the space record's `files`; a file without a name shows its
/// id, like the TS's `?? fileId`.
fn file_names(files: &[Json]) -> HashMap<&str, &str> {
	files.iter().filter_map(|f| Some((field(f, "id"), f["name"].as_str()?))).collect()
}

/// `row.from` / `row.to` compared like JS: null (a NaN written to JSON) reads as 0.
fn place(row: &Json, key: &str) -> f64 {
	match &row[key] {
		Json::Num(n) => *n,
		Json::Null if row.get(key).is_some() => 0.0,
		_ => f64::NAN,
	}
}

/// The rows `at` names, by index. A place as the index wrote it wins over the rows around its
/// point: a transcript's label is rounded, so its number can miss.
fn picked(rows: &[Json], at: &PassageRef) -> Vec<usize> {
	match at {
		PassageRef::Passage(id) => (0..rows.len()).filter(|&i| field(&rows[i], "id") == id).collect(),
		PassageRef::Place { file_id, range } => {
			let in_file = |i: &usize| rows[*i]["fileId"] == Json::from(file_id.as_str());
			let exact: Vec<usize> = (0..rows.len()).filter(in_file).filter(|&i| rows[i]["range"] == Json::from(range.as_str())).collect();
			if !exact.is_empty() {
				return exact;
			}
			match range_point(range) {
				Some(point) => (0..rows.len()).filter(in_file).filter(|&i| place(&rows[i], "from") <= point && point <= place(&rows[i], "to")).collect(),
				None => Vec::new(),
			}
		}
	}
}

impl Search {
	/// Drop a deleted space's tables from memory: nothing reads them again. Its writer locks stay,
	/// so an index run still in flight keeps its order.
	pub fn forget_space_search(&self, space_id: &str) {
		self.drop_cached(&self.passages_file(space_id));
		self.drop_cached(&self.facts_file(Some(space_id)));
	}

	/// True when this version of the file is in the space's index.
	pub fn is_file_indexed(&self, space_id: &str, file_id: &str, fp: &str) -> bool {
		self.read_table(&self.passages_file(space_id)).files.get(file_id).is_some_and(|f| f["fp"] == Json::from(fp))
	}

	/// Each indexed file's size ("98 pages", "52 min", "420 lines"), by file id.
	pub fn file_extents(&self, space_id: &str) -> Obj {
		self.read_table(&self.passages_file(space_id)).files.iter().map(|(id, f)| (id.clone(), f["extent"].clone())).collect()
	}

	/// Put one version of a space file in its space's index, replacing the old one. `text` is what
	/// search reads: a PDF's page-headed text, a caption file's raw cues, or plain text.
	/// `still_listed` runs after embedding: None when the space no longer has the file (a file
	/// removed meanwhile, or its space deleted, is never put back), else a guard (the space lock)
	/// held over the write, so no removal slips in between the check and the write.
	pub async fn index_space_file<G>(&self, space_id: &str, file_id: &str, name: &str, fp: &str, text: &str, still_listed: impl FnOnce() -> Option<G>) -> Result<(), String> {
		let at = self.passages_file(space_id);
		let writer = self.writer(&at);
		let _turn = writer.lock().await;
		let old = self.read_table(&at);
		if old.files.get(file_id).is_some_and(|f| f["fp"] == Json::from(fp)) {
			return Ok(());
		}
		let chunked = chunk_file(name, text);
		let texts: Vec<String> = chunked.chunks.iter().map(|c| c.text.clone()).collect();
		let hashes: Vec<String> = texts.iter().map(|t| hash_of(t)).collect();
		let vectors = self.with_vectors(&old, &hashes, &texts).await?;
		let Some(_listed) = still_listed() else { return Ok(()) };
		let (mut rows, mut all) = old.keep_rows(|r| r["fileId"] != Json::from(file_id));
		for (n, (chunk, hash)) in chunked.chunks.into_iter().zip(hashes).enumerate() {
			let mut row = Obj::new();
			row.insert("id", format!("{file_id}:{}", n + 1));
			row.insert("fileId", file_id);
			row.insert("range", chunk.range);
			row.insert("from", chunk.from);
			row.insert("to", chunk.to);
			row.insert("text", chunk.text);
			row.insert("hash", hash);
			rows.push(Json::Obj(row));
		}
		all.extend(vectors);
		let mut files = old.files.clone();
		let mut entry = Obj::new();
		entry.insert("fp", fp);
		entry.insert("extent", chunked.extent);
		files.insert(file_id, entry);
		self.write_table(&at, Table::new(rows, all, files)).map(drop)
	}

	/// Take a removed file out of its space's index.
	pub async fn drop_space_file(&self, space_id: &str, file_id: &str) -> Result<(), String> {
		let at = self.passages_file(space_id);
		let writer = self.writer(&at);
		let _turn = writer.lock().await;
		let old = self.read_table(&at);
		if !old.files.get(file_id).is_some_and(Json::truthy) {
			return Ok(());
		}
		let (rows, vectors) = old.keep_rows(|r| r["fileId"] != Json::from(file_id));
		let mut files = old.files.clone();
		files.remove(file_id);
		self.write_table(&at, Table::new(rows, vectors, files)).map(drop)
	}

	/// The best passages for a query, as compact lines: id, file, place, snippet. `files` is the
	/// space record's file list.
	pub async fn search_space_files(&self, space_id: &str, files: &[Json], query: &str, limit: usize) -> Result<String, String> {
		let table = self.read_table(&self.passages_file(space_id));
		if table.rows.is_empty() {
			return Ok("No space files are indexed for search yet (files are indexed once their text is read).".to_owned());
		}
		let query_vector = self.embed(&[query.to_owned()], true).await?;
		let keywords = keywords_of(&table, || table.rows.iter().map(|r| (field(r, "id").to_owned(), field(r, "text").to_owned())).collect())?;
		let by_id: HashMap<&str, &Json> = table.rows.iter().map(|r| (field(r, "id"), r)).collect();
		let hits = rank(&table, &[&query_vector], query, &keywords, limit);
		let names = file_names(files);
		let indexed = files.iter().filter(|f| table.files.get(field(f, "id")).is_some_and(Json::truthy)).count();
		let mut lines = Vec::new();
		if indexed < files.len() {
			lines.push(format!("(Searching {indexed} of the space's {} files; the others are not indexed yet.)", files.len()));
		}
		lines.push(format!("Top {} of {} passages for \"{query}\":", hits.len(), table.rows.len()));
		for id in &hits {
			let p = by_id[id.as_str()];
			let file_id = field(p, "fileId");
			lines.push(format!("{id} · {} · {}", names.get(file_id).copied().unwrap_or(file_id), field(p, "range")));
			lines.push(format!("  {}", snippet_of(field(p, "text"), query)));
		}
		lines.push("Open one with read_passage.".to_owned());
		Ok(lines.join("\n"))
	}

	/// The stored passages a reference names: the one passage of an id, or every passage of a
	/// file that covers a place. Empty when there is none.
	pub fn passages_at(&self, space_id: &str, at: &PassageRef) -> Vec<Json> {
		let table = self.read_table(&self.passages_file(space_id));
		picked(&table.rows, at).into_iter().map(|i| table.rows[i].clone()).collect()
	}

	/// A passage's text (a whole page when opened by file and place) with its file, place and the
	/// ids of its neighbours.
	pub fn read_passage(&self, space_id: &str, files: &[Json], at: &PassageRef) -> String {
		let table = self.read_table(&self.passages_file(space_id));
		let rows = &table.rows;
		let picked = picked(rows, at);
		if picked.is_empty() {
			return match at {
				PassageRef::Passage(id) => format!("No passage \"{id}\". Ids come from search_space_files."),
				PassageRef::Place { file_id, range } => {
					let all: Vec<&Json> = rows.iter().filter(|r| r["fileId"] == Json::from(file_id.as_str())).collect();
					match (all.first(), all.last()) {
						(Some(first), Some(last)) => format!("No passage of file \"{file_id}\" at \"{range}\". Its passages run from \"{}\" to \"{}\".", field(first, "range"), field(last, "range")),
						_ => format!("No passage of file \"{file_id}\": it is not indexed. A file id is the part of a passage id before the \":\" (or from read_space with files: true)."),
					}
				}
			};
		}
		let head = &rows[picked[0]];
		let in_file: Vec<usize> = (0..rows.len()).filter(|&i| rows[i]["fileId"] == head["fileId"]).collect();
		let first = in_file.iter().position(|&i| i == picked[0]).unwrap_or(0);
		let last = in_file.iter().position(|&i| i == picked[picked.len() - 1]).unwrap_or(0);
		let prev = first.checked_sub(1).map(|k| field(&rows[in_file[k]], "id")).filter(|id| !id.is_empty());
		let next = in_file.get(last + 1).map(|&i| field(&rows[i], "id")).filter(|id| !id.is_empty());
		let file_id = field(head, "fileId");
		let name = file_names(files).get(file_id).copied().unwrap_or(file_id).to_owned();
		let mut body = picked.iter().map(|&i| field(&rows[i], "text")).collect::<Vec<_>>().join("\n");
		if text::len16(&body) > READ_LIMIT_CHARS {
			body = format!("{}\n[cut at {READ_LIMIT_CHARS} characters]", text::slice16(&body, 0, Some(READ_LIMIT_CHARS as i64)));
		}
		let ids = if picked.len() == 1 { field(head, "id").to_owned() } else { format!("{} to {}", field(head, "id"), field(&rows[picked[picked.len() - 1]], "id")) };
		let steps = [prev.map_or("first passage of the file".to_owned(), |p| format!("previous: {p}")), next.map_or("last passage of the file".to_owned(), |n| format!("next: {n}"))].join(" · ");
		format!("{name} · {} · {ids}\n({steps})\n\n{body}", field(head, "range"))
	}
}

#[cfg(test)]
mod tests {
	use std::path::PathBuf;

	use gs_base::config::Paths;
	use gs_json::{json, stringify};

	use super::*;
	use crate::embed::DIMS;
	use crate::table;

	const SPACE: &str = "cls_test";

	/// A Search on a temp folder with no model: every vector these tests need is already stored.
	fn search(tag: &str) -> (Search, PathBuf) {
		let dir = std::env::temp_dir().join(format!("gs-search-passages-{tag}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		(Search::new(&Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), PathBuf::from("/nowhere"))), dir)
	}

	fn notes() -> String {
		(1..=40).map(|i| format!("line {i} {}", "x".repeat(90))).collect::<Vec<_>>().join("\n")
	}

	/// The table indexSpaceFile would have written for `notes()` as file f_a, version "v1", with
	/// row r's vector all r.
	fn seed(s: &Search) {
		let chunked = chunk_file("a.txt", &notes());
		let rows = chunked
			.chunks
			.iter()
			.enumerate()
			.map(|(n, c)| json!({ "id": format!("f_a:{}", n + 1), "fileId": "f_a", "range": c.range, "from": c.from, "to": c.to, "text": c.text, "hash": hash_of(&c.text) }))
			.collect::<Vec<_>>();
		let vectors = (0..rows.len()).flat_map(|r| vec![r as f32; DIMS]).collect();
		let mut files = Obj::new();
		files.insert("f_a", json!({ "fp": "v1", "extent": chunked.extent }));
		table::save(&s.passages_file(SPACE), &Table::new(rows, vectors, files)).unwrap();
	}

	fn stored(s: &Search) -> Json {
		gs_json::parse(&std::fs::read_to_string(s.passages_file(SPACE).with_extension("json")).unwrap()).unwrap()
	}

	#[tokio::test]
	async fn a_new_version_with_the_same_text_reuses_its_vectors() {
		let (s, dir) = search("reuse");
		seed(&s);
		assert!(s.is_file_indexed(SPACE, "f_a", "v1"));
		assert_eq!(stringify(&Json::Obj(s.file_extents(SPACE))), r#"{"f_a":"40 lines"}"#);
		s.index_space_file(SPACE, "f_a", "a.txt", "v1", "ignored: this version is indexed", || -> Option<()> { panic!("not re-indexed") }).await.unwrap();
		s.index_space_file(SPACE, "f_a", "a.txt", "v2", &notes(), || Some(())).await.unwrap();
		assert!(s.is_file_indexed(SPACE, "f_a", "v2"));
		assert_eq!(stored(&s)["files"], json!({ "f_a": { "fp": "v2", "extent": "40 lines" } }));
		let f32 = std::fs::read(s.passages_file(SPACE).with_extension("f32")).unwrap();
		assert_eq!(f32[DIMS * 4..DIMS * 4 + 4], 1f32.to_le_bytes());
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[tokio::test]
	async fn a_file_gone_while_embedding_is_not_put_back() {
		let (s, dir) = search("gone");
		seed(&s);
		s.index_space_file(SPACE, "f_a", "a.txt", "v2", &notes(), || None::<()>).await.unwrap();
		assert!(s.is_file_indexed(SPACE, "f_a", "v1"));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[tokio::test]
	async fn dropping_the_last_file_leaves_no_files_key() {
		let (s, dir) = search("drop");
		seed(&s);
		s.drop_space_file(SPACE, "f_missing").await.unwrap();
		s.drop_space_file(SPACE, "f_a").await.unwrap();
		assert_eq!(std::fs::read_to_string(s.passages_file(SPACE).with_extension("json")).unwrap(), r#"{"format":1,"model":"Snowflake/snowflake-arctic-embed-xs","rows":[]}"#);
		assert!(s.search_space_files(SPACE, &[], "x", 3).await.unwrap().starts_with("No space files are indexed"));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[tokio::test]
	async fn read_passage_names_the_file_and_its_neighbours() {
		let (s, dir) = search("read");
		seed(&s);
		let files = [json!({ "id": "f_a", "name": "a.txt" })];
		let one = s.read_passage(SPACE, &files, &PassageRef::Passage("f_a:2".into()));
		assert!(one.starts_with("a.txt · lines 17–32 · f_a:2\n(previous: f_a:1 · next: f_a:3)\n\nline 17 "), "{one}");
		let first = s.read_passage(SPACE, &[], &PassageRef::Place { file_id: "f_a".into(), range: "lines 3".into() });
		assert!(first.starts_with("f_a · lines 1–16 · f_a:1\n(first passage of the file · next: f_a:2)"), "{first}");
		let nameless = s.read_passage(SPACE, &[json!({ "id": "f_a" })], &PassageRef::Passage("f_a:3".into()));
		assert!(nameless.starts_with("f_a · lines 33–40 · f_a:3\n(previous: f_a:2 · last passage of the file)"), "{nameless}");
		assert_eq!(s.read_passage(SPACE, &files, &PassageRef::Passage("f_a:9".into())), "No passage \"f_a:9\". Ids come from search_space_files.");
		assert_eq!(s.read_passage(SPACE, &files, &PassageRef::Place { file_id: "f_a".into(), range: "the end".into() }), "No passage of file \"f_a\" at \"the end\". Its passages run from \"lines 1–16\" to \"lines 33–40\".");
		assert!(s.read_passage(SPACE, &files, &PassageRef::Place { file_id: "f_b".into(), range: "1".into() }).ends_with("it is not indexed. A file id is the part of a passage id before the \":\" (or from read_space with files: true)."));
		s.forget_space_search(SPACE);
		assert!(s.is_file_indexed(SPACE, "f_a", "v1"));
		std::fs::remove_dir_all(dir).unwrap();
	}

	#[test]
	fn a_place_as_the_index_wrote_it_wins_over_its_point() {
		// A transcript's place is rounded down, so its number is before the passage starts.
		let rows = [
			json!({ "id": "f_t:1", "fileId": "f_t", "range": "12:30–13:40", "from": 750.5, "to": 820 }),
			json!({ "id": "f_t:2", "fileId": "f_t", "range": "13:40–15:00", "from": 820, "to": 900 }),
		];
		let place = |range: &str| picked(&rows, &PassageRef::Place { file_id: "f_t".into(), range: range.into() });
		assert_eq!(place("12:30–13:40"), [0]);
		assert_eq!(place("13:40"), [0, 1]);
		assert_eq!(place("12:30"), Vec::<usize>::new());
		assert_eq!(picked(&rows, &PassageRef::Passage("f_t:2".into())), [1]);
		assert_eq!(picked(&rows, &PassageRef::Place { file_id: "f_x".into(), range: "12:30–13:40".into() }), Vec::<usize>::new());
	}

	#[test]
	fn places_compare_like_javascript() {
		let row = json!({ "from": null, "to": 3 });
		assert_eq!((place(&row, "from"), place(&row, "to")), (0.0, 3.0));
		assert!(place(&row, "missing").is_nan());
	}
}

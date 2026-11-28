//! A .tex file and the PDF built from it are one item: the PDF is read into facts and shown, the
//! .tex is its source, which the teacher reads and edits. Purely from names and paths.

use gs_json::Json;

use super::file_state::FileStatus;
use crate::contracts::space::{FILE_NOT_FOUND, display_name, extension_of, name_of};

/// The folder a file sits in: a linked file's folder in the linked tree, or "" for the app's own
/// copies, which each sit in a folder of their own.
fn folder_of(file: &Json) -> Option<&str> {
	match file["origin"].as_str() {
		Some("linked") => Some(file["path"].str_or_empty().rsplit_once('/').map_or("", |(dir, _)| dir)),
		Some("copied") => Some(""),
		_ => None,
	}
}

/// Same origin, same folder and the same name stem.
fn beside(a: &Json, b: &Json) -> bool {
	a["origin"] == b["origin"] && folder_of(a).is_some() && folder_of(a) == folder_of(b) && display_name(name_of(a)) == display_name(name_of(b))
}

/// The PDF a .tex builds: the one PDF with the same name stem, in the same folder of the same
/// space (for copied files, any copied PDF with that stem). Pairs are one to one: None for a file
/// that isn't .tex, with no such PDF, with two, or when another .tex has the same place.
pub fn tex_output_for<'a>(tex: &Json, files: &'a [Json]) -> Option<&'a Json> {
	if extension_of(name_of(tex)) != ".tex" || files.iter().any(|f| f["id"] != tex["id"] && extension_of(name_of(f)) == ".tex" && beside(f, tex)) {
		return None;
	}
	let mut outputs = files.iter().filter(|f| extension_of(name_of(f)) == ".pdf" && beside(f, tex));
	match (outputs.next(), outputs.next()) {
		(Some(pdf), None) => Some(pdf),
		_ => None,
	}
}

/// Stores each .tex file's PDF as `pdfId` (removed when it has none), so every reader joins the
/// two from the record. Returns the settled .tex files whose PDF came or went: one that gained a
/// PDF drops its own facts, one that lost it is read after all. A file still waiting sees its PDF
/// when its turn comes, and one that is gone waits for the folder scan.
pub fn pair_tex_files(files: &mut [Json]) -> Vec<String> {
	let outputs: Vec<Option<Json>> = files.iter().map(|f| tex_output_for(f, files).map(|pdf| pdf["id"].clone())).collect();
	let mut recheck = Vec::new();
	for (file, output) in files.iter_mut().zip(outputs) {
		if output.as_ref() == file.get("pdfId") {
			continue;
		}
		if !FileStatus::of(file).is_some_and(FileStatus::is_waiting) && file["error"].as_str() != Some(FILE_NOT_FOUND) {
			recheck.push(file["id"].str_or_empty().to_owned());
		}
		if let Some(obj) = file.as_obj_mut() {
			match output {
				Some(id) => obj.insert("pdfId", id),
				None => obj.remove("pdfId"),
			};
		}
	}
	recheck
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	fn linked(id: &str, path: &str) -> Json {
		json!({ "id": id, "name": path.rsplit('/').next().unwrap(), "path": path, "origin": "linked", "kind": "study", "status": "ready" })
	}

	fn copied(id: &str, name: &str) -> Json {
		json!({ "id": id, "name": name, "path": format!("{id}/{name}"), "origin": "copied", "kind": "study", "status": "ready" })
	}

	fn output(files: &[Json]) -> Option<&str> {
		tex_output_for(&files[0], files).and_then(|f| f["id"].as_str())
	}

	#[test]
	fn a_tex_builds_the_pdf_with_its_stem_in_its_folder() {
		assert_eq!(output(&[linked("t", "hw/HW 3.tex"), linked("p", "hw/HW 3.pdf"), linked("o", "hw/HW 3 key.pdf")]), Some("p"));
		assert_eq!(output(&[copied("t", "HW 3.tex"), copied("p", "HW 3.PDF")]), Some("p"), "copies sit in folders of their own");
		assert_eq!(output(&[linked("t", "hw/HW 3.tex"), linked("p", "old/HW 3.pdf")]), None, "another folder");
		assert_eq!(output(&[linked("t", "HW 3.tex"), copied("p", "HW 3.pdf")]), None, "a copy is not in the linked folder");
		assert_eq!(output(&[linked("t", "hw/HW 3.tex"), linked("n", "hw/HW 3.md")]), None, "no PDF");
		assert_eq!(output(&[copied("t", "HW 3.tex"), copied("p", "HW 3.pdf"), copied("q", "HW 3.pdf")]), None, "two PDFs: neither");
		assert_eq!(output(&[copied("t", "HW 3.tex"), copied("p", "HW 3.pdf"), copied("u", "HW 3.tex")]), None, "two .tex files: neither");
		assert_eq!(output(&[linked("t", "a/HW 3.tex"), linked("p", "a/HW 3.pdf"), linked("u", "b/HW 3.tex")]), Some("p"), "a .tex in another folder is no rival");
		assert_eq!(output(&[linked("p", "hw/HW 3.pdf"), linked("t", "hw/HW 3.tex")]), None, "a PDF builds nothing");
	}

	#[test]
	fn the_pdf_is_stored_and_a_settled_tex_is_rechecked_when_it_comes_or_goes() {
		let mut files = vec![linked("t", "HW 3.tex"), linked("p", "HW 3.pdf"), json!({ "id": "w", "name": "a.tex", "path": "a.tex", "origin": "linked", "status": "pending" }), linked("a", "a.pdf")];
		assert_eq!(pair_tex_files(&mut files), ["t"], "a waiting file sees its PDF at its turn");
		assert_eq!((files[0]["pdfId"].as_str(), files[2]["pdfId"].as_str()), (Some("p"), Some("a")));
		assert!(pair_tex_files(&mut files).is_empty(), "nothing changed");
		files.remove(1);
		assert_eq!(pair_tex_files(&mut files), ["t"]);
		assert!(files[0].get("pdfId").is_none());
	}
}

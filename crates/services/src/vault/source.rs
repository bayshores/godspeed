//! The "Check yourself" line of a note: the space file and page a passage id names. A file
//! inside the vault is embedded; a file outside it is a link that opens in its own app.

use std::path::Path;

use gs_core::vault::note_file::Source;
use gs_json::Json;
use gs_search::chunks::range_point;

use crate::App;
use crate::spaces::citations::passage_range;
use crate::spaces::space_card::space_file_path;

/// The percent-encoded `file://` address of an absolute path.
fn file_address(path: &str) -> String {
	let mut out = String::from("file://");
	if !path.starts_with('/') {
		out.push('/');
	}
	for byte in path.replace('\\', "/").bytes() {
		match byte {
			b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' | b':' => out.push(char::from(byte)),
			other => out.push_str(&format!("%{other:02X}")),
		}
	}
	out
}

/// The source for passage id `<file id>:<n>` of the space `record`; Err when the space holds no
/// such passage.
pub fn source_for(app: &App, record: &Json, vault: &Path, passage_id: &str) -> Result<Source, String> {
	let no_passage = || format!("There is no passage {passage_id} in this space.");
	let (file_id, n) = passage_id.split_once(':').ok_or_else(no_passage)?;
	let file = record["files"].items().iter().find(|f| f["id"].as_str() == Some(file_id)).ok_or_else(no_passage)?;
	let range = passage_range(app, file_id, n).ok_or_else(no_passage)?;
	let name = file["name"].str_or_empty();
	let is_pdf = name.to_lowercase().ends_with(".pdf");
	let page = range_point(&range).filter(|_| is_pdf).map(|p| p as i64);
	let title = page.map_or_else(|| name.to_owned(), |p| format!("{name}, page {p}"));
	let on_disk = space_file_path(app, record, file);
	let inside = on_disk.as_deref().and_then(|path| Path::new(path).strip_prefix(vault).ok()).map(|rel| rel.to_string_lossy().replace('\\', "/"));
	let line = match (inside, on_disk) {
		(Some(rel), _) => format!("![[{rel}{}]]", page.map_or_else(String::new, |p| format!("#page={p}"))),
		(None, Some(path)) => format!("[Open {title}]({}{})", file_address(&path), page.map_or_else(String::new, |p| format!("#page={p}"))),
		(None, None) => title.clone(),
	};
	Ok(Source { title, line })
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn an_address_encodes_spaces_and_keeps_slashes() {
		assert_eq!(file_address("/Users/me/Day6 Stars.pdf"), "file:///Users/me/Day6%20Stars.pdf");
		assert_eq!(file_address(r"C:\Users\me\a b.pdf"), "file:///C:/Users/me/a%20b.pdf");
	}
}

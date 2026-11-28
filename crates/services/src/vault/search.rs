//! `search_vault`: the teacher's only way to read the learner's vault. A query finds notes by
//! their words; a path reads one note whole.

use std::path::{Component, Path};

use gs_base::fsx;
use gs_core::vault::frontmatter::{Doc, Owner};
use gs_core::vault::note_tool::{SEARCH_DEFAULT_LIMIT, SEARCH_MAX_LIMIT, WHOLE_NOTE_CHARS};
use gs_json::{Json, json};
use gs_search::vault::VaultOwner;

use super::{NO_VAULT, VaultError, rescan, with_reader};
use crate::App;

/// How many hits are ranked before a space narrows them.
const NARROWING_POOL: usize = 100;

fn owner_word(owned_by_godspeed: bool) -> &'static str {
	if owned_by_godspeed { "godspeed" } else { "you" }
}

pub(crate) fn search_vault(app: &App, args: &Json) -> Result<Json, String> {
	let vault = super::setup::setting(app)?.path.ok_or(NO_VAULT)?;
	match rescan(app) {
		Ok(_) => {}
		Err(VaultError::NoVault) => return Err(NO_VAULT.to_owned()),
		Err(err) => return Err(err.message()),
	}
	if let Some(path) = args["path"].as_str().filter(|p| !p.is_empty()) {
		return read_note(Path::new(&vault), path);
	}
	let query = args["query"].as_str().map(str::trim).filter(|q| !q.is_empty()).ok_or("Send a query or a path.")?;
	let limit = args["limit"].as_i64().map_or(SEARCH_DEFAULT_LIMIT, |n| n.clamp(1, SEARCH_MAX_LIMIT as i64) as usize);
	// A space's notes are the ones in its folder, which the learner cannot change by editing a key.
	let folder = match args["space_id"].as_str().filter(|s| !s.is_empty()) {
		Some(id) => {
			app.stores.spaces.get_space(id).ok_or_else(|| crate::spaces::space_actions::no_space_text(id))?;
			Some(app.stores.vault_notes.read()["folders"][id].as_str().map(|f| format!("{f}/")).unwrap_or_default())
		}
		None => None,
	};
	with_reader(app, |reader| {
		let hits = reader.search(query, if folder.is_some() { NARROWING_POOL } else { limit });
		let notes: Vec<Json> = hits
			.into_iter()
			.filter_map(|hit| {
				let note = reader.note(&hit.path)?;
				if folder.as_deref().is_some_and(|prefix| prefix.is_empty() || !hit.path.starts_with(prefix)) {
					return None;
				}
				let mut out = json!({ "name": hit.name, "path": hit.path, "owner": owner_word(hit.owner == VaultOwner::Godspeed), "snippet": hit.snippet });
				if let Some(fields) = out.as_obj_mut() {
					if let Some(class) = &note.space {
						fields.insert("class", class.as_str());
					}
					if let Some(confidence) = note.standing.as_deref().filter(|c| !c.is_empty()) {
						fields.insert("confidence", confidence);
					}
				}
				Some(out)
			})
			.take(limit)
			.collect();
		json!({ "notes": notes, "indexed": reader.len() })
	})
	.map_err(|e| e.message())
}

/// One note whole. The path is relative to the vault and stays inside it.
fn read_note(vault: &Path, path: &str) -> Result<Json, String> {
	let inside = Path::new(path).components().all(|c| matches!(c, Component::Normal(_))) && path.to_lowercase().ends_with(".md");
	if !inside {
		return Err("That path is not a note in the vault. Use a path from a query, relative to the vault.".to_owned());
	}
	let text = fsx::read_text(&vault.join(path)).map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { "There is no note at that path.".to_owned() } else { format!("The note could not be read: {e}") })?;
	let owned_by_godspeed = matches!(Doc::parse(&text).owner(), Some(Owner::Topic(_)));
	let name = path.rsplit('/').next().unwrap_or(path).trim_end_matches(".md");
	let cut = text.chars().count() > WHOLE_NOTE_CHARS;
	let mut out = json!({ "name": name, "path": path, "owner": owner_word(owned_by_godspeed), "text": text.chars().take(WHOLE_NOTE_CHARS).collect::<String>() });
	if let (true, Some(fields)) = (cut, out.as_obj_mut()) {
		fields.insert("cut", true);
	}
	Ok(out)
}

#[cfg(test)]
mod tests {
	use super::super::test_support::Fixture;
	use super::*;

	#[test]
	fn a_query_finds_notes_and_says_whose_they_are() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		fx.write("Mine/Pigeonhole.md", "Pigeonhole principle, my words.\n");
		super::super::write_vault_note(&fx.app, &fx.request("t1", json!({ "text": "Halve the range, pigeonhole style." }))).unwrap();
		let found = search_vault(&fx.app, &json!({ "query": "pigeonhole" })).unwrap();
		assert_eq!(found["indexed"].as_i64(), Some(2));
		let owner = |name: &str| found["notes"].items().iter().find(|n| n["name"].as_str() == Some(name)).map(|n| n["owner"].as_str().unwrap().to_owned());
		assert_eq!((owner("Pigeonhole").as_deref(), owner("Binary search").as_deref()), (Some("you"), Some("godspeed")));
		fx.write("Mine/Claims.md", "---\nclass: CSE 21\n---\nPigeonhole, claiming the class.\n");
		let only = search_vault(&fx.app, &json!({ "query": "pigeonhole", "space_id": fx.space_id })).unwrap();
		assert_eq!(only["notes"].items().len(), 1, "only the notes in that space's folder, whatever their class key says");
		assert_eq!(only["notes"][0]["name"].as_str(), Some("Binary search"));
		assert_eq!(search_vault(&fx.app, &json!({ "query": "pigeonhole", "space_id": "space_nope" })).unwrap_err(), crate::spaces::space_actions::no_space_text("space_nope"));
		assert_eq!(search_vault(&fx.app, &json!({ "query": "pigeonhole", "limit": 1 })).unwrap()["notes"].items().len(), 1);
	}

	#[test]
	fn a_path_reads_the_whole_note_and_stays_inside_the_vault() {
		let fx = Fixture::new(&[]);
		fx.write("Mine/Long.md", &"x".repeat(WHOLE_NOTE_CHARS + 5));
		fx.write("Mine/Short.md", "short");
		let long = search_vault(&fx.app, &json!({ "path": "Mine/Long.md" })).unwrap();
		assert_eq!((long["text"].as_str().unwrap().len(), long["cut"].as_bool()), (WHOLE_NOTE_CHARS, Some(true)));
		let short = search_vault(&fx.app, &json!({ "path": "Mine/Short.md" })).unwrap();
		assert_eq!((short["text"].as_str(), short["owner"].as_str(), short.get("cut")), (Some("short"), Some("you"), None));
		for path in ["../outside.md", "/etc/passwd.md", "Mine/../../x.md", "Mine/Short.txt"] {
			assert!(search_vault(&fx.app, &json!({ "path": path })).unwrap_err().contains("not a note in the vault"), "{path}");
		}
		assert_eq!(search_vault(&fx.app, &json!({ "path": "Mine/Nope.md" })).unwrap_err(), "There is no note at that path.");
	}

	#[test]
	fn no_vault_and_no_question_are_refused() {
		let root = crate::app::test_support::scratch_dir("vault-search-none");
		let app = crate::app::test_support::test_app(&root);
		assert_eq!(search_vault(&app, &json!({ "query": "x" })).unwrap_err(), NO_VAULT);
		let fx = Fixture::new(&[]);
		assert!(search_vault(&fx.app, &json!({})).is_err());
	}
}

//! A scratch app with a vault folder picked and a space with topics, for the vault's unit tests.

use std::path::PathBuf;
use std::sync::Arc;

use gs_base::{clock, fsx, time};
use gs_json::{Json, json};
use gs_store::graph::Ledger;

use super::setup::change_vault;
use crate::App;
use crate::app::test_support::{Scratch, scratch_dir, test_app};

pub struct Fixture {
	_root: Scratch,
	pub app: Arc<App>,
	pub vault: PathBuf,
	pub space_id: String,
}

impl Fixture {
	/// A space "CSE 21" with the given `(id, name)` topics, and an empty vault folder picked.
	pub fn new(topics: &[(&str, &str)]) -> Fixture {
		let root = scratch_dir("vault");
		let app = test_app(&root);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 21" })).unwrap()["id"].as_str().unwrap().to_owned();
		let at = time::iso(clock::now_ms());
		let mut snapshot = Vec::new();
		for (id, name) in topics {
			let fact = json!({ "id": format!("f_{id}"), "name": name, "statement": name, "createdAt": at, "aliases": [], "provenance": [] });
			app.stores.graphs.append(Some(&space_id), Ledger::Nodes, &fact).unwrap();
			snapshot.push(json!({ "id": id, "name": name, "members": [format!("f_{id}")] }));
		}
		app.stores.graphs.append(Some(&space_id), Ledger::Topics, &json!({ "at": at, "topics": snapshot })).unwrap();
		let vault = root.join("Notes");
		std::fs::create_dir_all(&vault).unwrap();
		change_vault(&app, &json!({ "path": vault.to_string_lossy() })).unwrap();
		Fixture { _root: root, app, vault, space_id }
	}

	pub fn write(&self, rel: &str, text: &str) {
		let file = self.vault.join(rel);
		std::fs::create_dir_all(file.parent().unwrap()).unwrap();
		fsx::write_text_atomic(&file, text).unwrap();
	}

	pub fn read(&self, rel: &str) -> String {
		fsx::read_text(&self.vault.join(rel)).unwrap()
	}

	/// A `write_vault_note` request for `topic_id` with `extra` fields.
	pub fn request(&self, topic_id: &str, extra: Json) -> Json {
		let mut args = json!({ "space_id": self.space_id, "topic_id": topic_id });
		for (key, value) in extra.as_obj().into_iter().flatten() {
			args.set(key, value.clone());
		}
		args
	}
}

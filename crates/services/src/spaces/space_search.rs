//! Search over one space's files for the lesson and cheat-sheet agents (searchSpaceFiles and
//! readPassage in search-index.ts): the space record is read at call time, so new files count.

use std::sync::Arc;

use gs_agent::tools::space::SpaceSearch;
use gs_json::Json;

use crate::App;

/// The space's files, as the search reads them (none when the space is gone).
fn space_files(app: &App, space_id: &str) -> Vec<Json> {
	app.stores.spaces.get_space(space_id).and_then(|record| record["files"].as_arr().cloned()).unwrap_or_default()
}

pub fn space_search(app: &Arc<App>, space_id: &str) -> SpaceSearch {
	let (search_app, search_space) = (app.clone(), space_id.to_owned());
	let (read_app, read_space) = (app.clone(), space_id.to_owned());
	SpaceSearch {
		search_files: Box::new(move |query, limit| {
			let (app, space_id) = (search_app.clone(), search_space.clone());
			Box::pin(async move { app.search.search_space_files(&space_id, &space_files(&app, &space_id), &query, limit).await })
		}),
		read_passage: Box::new(move |at| read_app.search.read_passage(&read_space, &space_files(&read_app, &read_space), &at)),
	}
}

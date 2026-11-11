//! Search over one class's files for the lesson and cheat-sheet agents (searchClassFiles and
//! readPassage in search-index.ts): the class record is read at call time, so new files count.

use std::sync::Arc;

use gs_agent::tools::class::ClassSearch;
use gs_json::Json;

use crate::App;

/// The class's files, as the search reads them (none when the class is gone).
fn class_files(app: &App, class_id: &str) -> Vec<Json> {
	app.stores.classes.get_class(class_id).and_then(|record| record["files"].as_arr().cloned()).unwrap_or_default()
}

pub fn class_search(app: &Arc<App>, class_id: &str) -> ClassSearch {
	let (search_app, search_class) = (app.clone(), class_id.to_owned());
	let (read_app, read_class) = (app.clone(), class_id.to_owned());
	ClassSearch {
		search_files: Box::new(move |query, limit| {
			let (app, class_id) = (search_app.clone(), search_class.clone());
			Box::pin(async move { app.search.search_class_files(&class_id, &class_files(&app, &class_id), &query, limit).await })
		}),
		read_passage: Box::new(move |at| read_app.search.read_passage(&read_class, &class_files(&read_app, &read_class), &at)),
	}
}

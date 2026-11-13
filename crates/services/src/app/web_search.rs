//! Settings → Web search: the person's Tavily key and its searches this month. Only the key's
//! last four characters reach the window, and the numbers are asked of Tavily each time, so
//! nothing about the key's state is stored.

use gs_json::{Json, json};
use gs_web::tavily::{self, Failure, Usage};

use crate::App;

const NOT_ACCEPTED: &str = "Tavily did not accept that key.";

/// Why a key was not saved: `Refused` is in words for the person, `Disk` is the file not saving.
pub enum KeyError {
	Refused(String),
	Disk(String),
}

/// `{ keyEnd, used, limit, error }`, all null with no key.
pub async fn web_search_view(app: &App) -> Json {
	match app.stores.search_key.read_search_key() {
		Some(key) => {
			let usage = tavily::usage(&key).await;
			view(Some(&key), Some(usage))
		}
		None => view(None, None),
	}
}

/// Saves `key` once Tavily accepts it, and answers with the view.
pub async fn save_search_key(app: &App, key: &str) -> Result<Json, KeyError> {
	let key = key.trim();
	// A header cannot carry anything else, so such a key can never work.
	if key.is_empty() || !key.chars().all(|c| c.is_ascii_graphic()) {
		return Err(KeyError::Refused(NOT_ACCEPTED.to_owned()));
	}
	match tavily::usage(key).await {
		Ok(usage) => {
			app.stores.search_key.write_search_key(key).map_err(KeyError::Disk)?;
			Ok(view(Some(key), Some(Ok(usage))))
		}
		Err(Failure::KeyRefused) => Err(KeyError::Refused(NOT_ACCEPTED.to_owned())),
		Err(failure) => Err(KeyError::Refused(failure_sentence(&failure))),
	}
}

pub fn remove_search_key(app: &App) -> Result<Json, String> {
	app.stores.search_key.remove_search_key()?;
	Ok(view(None, None))
}

fn view(key: Option<&str>, usage: Option<Result<Usage, Failure>>) -> Json {
	let (used, limit, error) = match usage {
		Some(Ok(usage)) => (usage.used, usage.limit, None),
		Some(Err(failure)) => (None, None, Some(failure_sentence(&failure))),
		None => (None, None, None),
	};
	json!({ "keyEnd": key.map(key_end), "used": used, "limit": limit, "error": error })
}

/// The last four characters, enough to tell keys apart.
fn key_end(key: &str) -> String {
	let start = key.char_indices().rev().nth(3).map_or(0, |(at, _)| at);
	key[start..].to_owned()
}

fn failure_sentence(failure: &Failure) -> String {
	match failure {
		Failure::KeyRefused => "Tavily did not accept the saved key.".to_owned(),
		Failure::OutOfSearches => "This key is out of searches for now.".to_owned(),
		Failure::Busy => "Tavily is busy. Try again in a minute.".to_owned(),
		Failure::Unreachable => "Could not reach Tavily. Check the internet connection and try again.".to_owned(),
		Failure::Status(status) => format!("Tavily answered with an error (HTTP {status}). Try again later."),
	}
}

#[cfg(test)]
mod tests {
	use gs_json::stringify;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn the_window_sees_only_the_last_four_characters() {
		assert_eq!(key_end("tvly-dev-abcdWXYZ"), "WXYZ");
		assert_eq!(key_end("abc"), "abc");
		let shown = stringify(&view(Some("tvly-dev-secret1234"), Some(Ok(Usage { used: Some(412), limit: Some(1000) }))));
		assert_eq!(shown, r#"{"keyEnd":"1234","used":412,"limit":1000,"error":null}"#);
		assert!(!shown.contains("secret"));
	}

	#[test]
	fn a_refused_or_unreachable_tavily_is_a_sentence_and_the_key_end_stays() {
		let refused = view(Some("tvly-abcd"), Some(Err(Failure::KeyRefused)));
		assert_eq!(stringify(&refused), r#"{"keyEnd":"abcd","used":null,"limit":null,"error":"Tavily did not accept the saved key."}"#);
		let offline = view(Some("tvly-abcd"), Some(Err(Failure::Unreachable)));
		assert_eq!(offline["error"].as_str(), Some("Could not reach Tavily. Check the internet connection and try again."));
	}

	#[tokio::test]
	async fn with_no_key_everything_is_null() {
		let root = scratch_dir("web-search-none");
		let app = test_app(&root);
		assert_eq!(stringify(&web_search_view(&app).await), r#"{"keyEnd":null,"used":null,"limit":null,"error":null}"#);
	}

	#[tokio::test]
	async fn a_blank_or_malformed_key_is_refused_without_asking_tavily() {
		let root = scratch_dir("web-search-blank");
		let app = test_app(&root);
		for key in ["", "   ", "tvly key", "tvly-\u{e9}"] {
			let Err(KeyError::Refused(message)) = save_search_key(&app, key).await else { panic!("{key:?} was accepted") };
			assert_eq!(message, NOT_ACCEPTED);
		}
		assert_eq!(app.stores.search_key.read_search_key(), None);
	}

	#[test]
	fn removing_the_key_deletes_the_file() {
		let root = scratch_dir("web-search-remove");
		let app = test_app(&root);
		app.stores.search_key.write_search_key("tvly-abcd").unwrap();
		assert_eq!(stringify(&remove_search_key(&app).unwrap()), r#"{"keyEnd":null,"used":null,"limit":null,"error":null}"#);
		assert!(!root.join("data").join("search-key").exists());
	}
}

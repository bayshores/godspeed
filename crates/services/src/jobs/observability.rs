//! The activity feed: the dock's one poll for every background process in every view. Running
//! sub-agent jobs of listed lessons (with their lesson's title and the model's context limit),
//! the extraction runs, the deadline and plugin requests, and jobs that failed in the last 10 minutes.
//! Teacher turns stay out: sessions show their own.

use std::borrow::Borrow;
use std::collections::HashMap;
use std::sync::Arc;

use gs_base::{clock, locale, text, time};
use gs_core::records::settings::OUTSIDE_AGENT_CONTEXT_WINDOW;
use gs_engine::turn::messages::agent_model_id;
use gs_json::{Json, Obj, json};

use super::list_all_jobs;
use crate::App;
use crate::graph::extraction_runs::extraction_statuses;
use crate::plugins::plugin_ask_rows;
use crate::spaces::deadline_requests::deadline_request_rows;

/// Failed jobs stay in the feed this long.
const FAILED_JOB_WINDOW_MS: i64 = 10 * 60_000;

/// `{ jobs, extractions, failed, requests }` now.
pub fn activity_feed(app: &Arc<App>) -> Json {
	let now = clock::now_ms();
	let chats = app.stores.chats.list_chats();
	let jobs = list_all_jobs(app);
	let mut feed = compose_feed(now, &chats, &jobs, &extraction_statuses(app));
	if let Json::Obj(fields) = &mut feed {
		let mut requests = deadline_request_rows(app);
		requests.extend(plugin_ask_rows(app));
		fields.insert("requests", Json::from(requests));
	}
	feed
}

/// The feed from lesson summaries, job records and extraction runs: jobs oldest activity first,
/// extractions by start, failures newest first. Jobs of unlisted lessons stay out.
pub fn compose_feed<J: Borrow<Json>>(now: i64, chats: &[Json], all_jobs: &[J], runs: &[Json]) -> Json {
	// Every job runs on the learner's agent: one context window.
	let agent_window = Json::from(OUTSIDE_AGENT_CONTEXT_WINDOW as f64);
	let agent_model = agent_model_id();
	let mut by_chat: HashMap<&str, Vec<&Json>> = HashMap::new();
	for job in all_jobs.iter().map(Borrow::borrow) {
		by_chat.entry(job["chatId"].str_or_empty()).or_default().push(job);
	}
	let mut jobs = Vec::new();
	let mut failed = Vec::new();
	for chat in chats {
		let title = title_or_id(chat);
		for job in by_chat.get(chat["id"].str_or_empty()).map_or(&[][..], Vec::as_slice) {
			let updated_at = job["updatedAt"].str_or_empty();
			let recent = time::parse_date(updated_at).is_some_and(|at| now - at < FAILED_JOB_WINDOW_MS);
			if job["status"].as_str() == Some("error") && recent {
				let error = job["error"].as_str().map(text::trim).filter(|e| !e.is_empty()).unwrap_or("Something went wrong");
				failed.push(json!({ "id": job["id"].clone(), "kind": job["kind"].clone(), "chatId": job["chatId"].clone(), "title": title.clone(), "error": error, "at": updated_at }));
			}
			if job["status"].as_str() == Some("running") {
				let mut row = job.as_obj().cloned().unwrap_or_default();
				row.insert("title", title.clone());
				let limit = if job["usage"]["model"].as_str() == Some(agent_model.as_str()) { agent_window.clone() } else { Json::Null };
				row.insert("contextLimit", limit);
				jobs.push(Json::Obj(row));
			}
		}
	}
	let titles: HashMap<&str, &Json> = chats.iter().filter_map(|c| Some((c["id"].as_str()?, &c["title"]))).collect();
	let mut extractions: Vec<Json> = runs.iter().map(|run| extraction_row(run, &titles)).collect();
	jobs.sort_by(|a, b| locale::compare(a["updatedAt"].str_or_empty(), b["updatedAt"].str_or_empty()));
	extractions.sort_by(|a, b| a["startedAt"].as_f64().unwrap_or(0.0).total_cmp(&b["startedAt"].as_f64().unwrap_or(0.0)));
	failed.sort_by(|a, b| locale::compare(b["at"].str_or_empty(), a["at"].str_or_empty()));
	json!({ "jobs": jobs, "extractions": extractions, "failed": failed })
}

/// `chat.title ?? chat.id`.
fn title_or_id(chat: &Json) -> Json {
	match &chat["title"] {
		Json::Null => chat["id"].clone(),
		title => title.clone(),
	}
}

/// One extraction job's row: its id carries the chunk (`src#i`), its title is the run's own
/// label, else the lesson's title, else the id, with the `(i/N)` suffix when the source fanned out.
fn extraction_row(run: &Json, titles: &HashMap<&str, &Json>) -> Json {
	let chat_id = run["chatId"].str_or_empty();
	let part = run.get("part").filter(|p| !p.is_null());
	let mut row = Obj::new();
	row.insert("id", match part {
		Some(p) => format!("{chat_id}#{}", gs_json::js_number(p["i"].as_f64().unwrap_or(0.0))),
		None => chat_id.to_owned(),
	});
	row.insert("chatId", chat_id);
	row.insert("kind", run["kind"].clone());
	if let Some(p) = part {
		row.insert("part", p.clone());
	}
	let label = match &run["label"] {
		Json::Null => titles.get(chat_id).filter(|t| !t.is_null()).and_then(|t| t.as_str()).unwrap_or(chat_id).to_owned(),
		label => label.str_or_empty().to_owned(),
	};
	let suffix = part.map_or(String::new(), |p| format!(" ({}/{})", gs_json::js_number(p["i"].as_f64().unwrap_or(0.0)), gs_json::js_number(p["n"].as_f64().unwrap_or(0.0))));
	row.insert("title", format!("{label}{suffix}"));
	row.insert("phase", run["phase"].clone());
	row.insert("startedAt", run["startedAt"].clone());
	Json::Obj(row)
}

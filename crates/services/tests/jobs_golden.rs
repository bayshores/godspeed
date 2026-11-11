//! Parity with the TypeScript for jobs (tests/golden/jobs.json, made by
//! jobs.golden.ts from synthetic lessons and job records): the recovery sweep's writes, the
//! activity feed, and what aborting and acknowledging leave in job records.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{fsx, ids};
use gs_json::{Json, json, parse, stringify, stringify_pretty};
use gs_services::App;
use gs_services::jobs::jobs::{abort_job, list_all_jobs, note_steers_durable};
use gs_services::jobs::observability::compose_feed;

fn case(name: &str) -> Json {
	let golden = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/jobs.json")).unwrap()).unwrap();
	golden.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(name)).unwrap()["output"].clone()
}

/// An app over a fresh data folder holding the case's lessons and jobs.
fn app_with(before: &Json) -> (Arc<App>, PathBuf) {
	let dir = std::env::temp_dir().join(format!("gs-jobs-golden-{}", ids::uuid()));
	let data = dir.join("data");
	for (folder, key) in [("chats", "chats"), ("jobs", "jobs")] {
		std::fs::create_dir_all(data.join(folder)).unwrap();
		for record in before[key].as_arr().unwrap() {
			let file = data.join(folder).join(format!("{}.json", record["id"].as_str().unwrap()));
			fsx::write_text_atomic(&file, &format!("{}\n", stringify_pretty(record, "\t"))).unwrap();
		}
	}
	(App::new(Paths::new(data.clone(), dir.join("home"), dir.join("tmp"), dir), None), data)
}

/// A job's file, its updatedAt masked when it changed (the TS side masks the same way).
fn record(data: &Path, before: &Json, id: &str) -> Json {
	let Ok(text) = std::fs::read_to_string(data.join("jobs").join(format!("{id}.json"))) else { return Json::Null };
	let mut job = parse(&text).unwrap();
	let was = before["jobs"].as_arr().unwrap().iter().find(|j| j["id"].as_str() == Some(id)).map(|j| j["updatedAt"].clone());
	if was.as_ref() != Some(&job["updatedAt"]) {
		job.as_obj_mut().unwrap().insert("updatedAt", "<now>");
	}
	job
}

fn records(data: &Path, before: &Json) -> Json {
	Json::Arr(before["jobs"].as_arr().unwrap().iter().map(|j| record(data, before, j["id"].as_str().unwrap())).collect())
}

#[tokio::test]
async fn sweep_and_feed_match_node() {
	let out = case("feed and sweep");
	let (app, data) = app_with(&out["before"]);
	list_all_jobs(&app);
	assert_eq!(stringify(&records(&data, &out["before"])), stringify(&out["sweep"]));
	let c = &out["compose"];
	let feed = compose_feed(c["now"].as_i64().unwrap(), c["chats"].as_arr().unwrap(), c["jobs"].as_arr().unwrap(), c["runs"].as_arr().unwrap());
	assert_eq!(stringify(&feed), stringify(&c["feed"]));
	let _ = std::fs::remove_dir_all(data.parent().unwrap());
}

#[tokio::test]
async fn aborts_and_acknowledgements_match_node() {
	let out = case("aborts and acknowledgements");
	let before = &out["before"];
	let (app, data) = app_with(before);
	for step in out["steps"].as_arr().unwrap() {
		match step["op"].as_str().unwrap() {
			"abort" => {
				let id = step["id"].as_str().unwrap();
				let outcome = match abort_job(&app, id).unwrap() {
					Ok(()) => json!({ "ok": true }),
					Err(refusal) => json!({ "ok": false, "reason": refusal.reason() }),
				};
				assert_eq!(stringify(&outcome), stringify(&step["outcome"]), "{id}");
				assert_eq!(stringify(&record(&data, before, id)), stringify(&step["job"]), "{id}");
			}
			_ => {
				note_steers_durable(&app, step["chatId"].as_str().unwrap(), step["persisted"].as_arr().unwrap());
				assert_eq!(stringify(&records(&data, before)), stringify(&step["jobs"]));
			}
		}
	}
	let _ = std::fs::remove_dir_all(data.parent().unwrap());
}

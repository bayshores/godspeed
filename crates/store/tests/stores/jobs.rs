use gs_base::events::EventKind;
use gs_json::{Json, json, stringify_pretty};
use gs_store::jobs::{CreateJobInit, JobStore};

use crate::support::Lab;

fn store(lab: &Lab) -> JobStore {
	JobStore::new(&lab.paths, &lab.events, &lab.locks)
}

fn init<'a>(chat_id: &'a str, tool_call_id: &'a str) -> CreateJobInit<'a> {
	CreateJobInit { kind: "pdf", chat_id, tool_call_id, activity: None, input: None }
}

fn job_text(id: &str, chat_id: &str, updated_at: &str) -> String {
	format!(r#"{{"id":"{id}","kind":"pdf","chatId":"{chat_id}","toolCallId":"t_{id}","status":"running","activity":"starting","createdAt":"2026-11-01T00:00:00.000Z","updatedAt":"{updated_at}"}}"#)
}

#[test]
fn a_new_job_is_running_saved_and_announced() {
	let lab = Lab::new("jobs-create");
	let mut events = lab.events.subscribe();
	let jobs = store(&lab);
	let job = jobs.create_job(&CreateJobInit { activity: Some("reading"), input: Some(json!({ "path": "/x.pdf" })), ..init("chat_1", "call_1") }).unwrap();
	let id = job["id"].as_str().unwrap();
	assert!(id.starts_with("job_"));
	assert_eq!(job["status"].as_str(), Some("running"));
	assert_eq!(job["activity"].as_str(), Some("reading"));
	assert_eq!(job["createdAt"], job["updatedAt"]);
	assert_eq!(lab.get(&format!("jobs/{id}.json")), stringify_pretty(&job, "\t"));
	let event = events.try_recv().unwrap();
	assert_eq!(event.kind, EventKind::JobsChanged);
	assert_eq!(event.payload["chatId"].as_str(), Some("chat_1"));
	assert!(events.try_recv().is_err());
	let plain = jobs.create_job(&init("chat_1", "call_2")).unwrap();
	assert_eq!(plain["activity"].as_str(), Some("starting"));
	assert!(plain.get("input").is_none());
}

#[test]
fn an_update_merges_the_patch_keeps_the_identity_and_announces() {
	let lab = Lab::new("jobs-update");
	let jobs = store(&lab);
	let job = jobs.create_job(&init("chat_1", "call_1")).unwrap();
	let id = job["id"].as_str().unwrap();
	let mut events = lab.events.subscribe();
	let patch = json!({ "id": "job_other", "kind": "x", "chatId": "chat_2", "toolCallId": "t", "createdAt": "never", "status": "done", "result": { "text": "ok" } });
	let next = jobs.update_job(id, &patch).unwrap().unwrap();
	for key in ["id", "kind", "chatId", "toolCallId", "createdAt"] {
		assert_eq!(next[key], job[key], "{key}");
	}
	assert_eq!(next["status"].as_str(), Some("done"));
	assert_eq!(next["result"]["text"].as_str(), Some("ok"));
	assert_eq!(jobs.get_job(id).unwrap().as_ref(), &next);
	let event = events.try_recv().unwrap();
	assert_eq!((event.kind, event.payload["chatId"].as_str()), (EventKind::JobsChanged, Some("chat_1")));
	let set = jobs.update_job(id, &json!({ "updatedAt": "2030-01-01T00:00:00.000Z" })).unwrap().unwrap();
	assert_eq!(set["updatedAt"].as_str(), Some("2030-01-01T00:00:00.000Z"));
	assert_eq!(jobs.update_job("job_missing", &json!({})), Ok(None));
}

#[test]
fn a_checked_update_writes_only_while_its_check_holds() {
	let lab = Lab::new("jobs-update-if");
	let jobs = store(&lab);
	let job = jobs.create_job(&init("chat_1", "call_1")).unwrap();
	let id = job["id"].as_str().unwrap();
	let running = |now: &Json| now["status"].as_str() == Some("running");
	assert!(jobs.update_job_if(id, &json!({ "status": "done" }), running).unwrap().is_some());
	assert_eq!(jobs.update_job_if(id, &json!({ "status": "error" }), running), Ok(None));
	assert_eq!(jobs.get_job(id).unwrap()["status"].as_str(), Some("done"));
}

#[test]
fn an_id_that_could_be_a_path_is_unknown() {
	let lab = Lab::new("jobs-ids");
	lab.put("evil.json", &job_text("evil", "chat_1", "2026-11-02T00:00:00.000Z"));
	let jobs = store(&lab);
	for id in ["../evil", "a/b", "", "a b", "job.json"] {
		assert!(jobs.get_job(id).is_none(), "{id}");
		assert_eq!(jobs.update_job(id, &json!({ "status": "done" })), Ok(None), "{id}");
	}
	assert_eq!(lab.get("evil.json"), job_text("evil", "chat_1", "2026-11-02T00:00:00.000Z"));
}

#[test]
fn files_that_are_not_jobs_read_as_unknown() {
	let lab = Lab::new("jobs-broken");
	lab.put("jobs/job_broken.json", "{\"id\":");
	lab.put("jobs/job_nostatus.json", r#"{"id":"job_nostatus","chatId":"c","updatedAt":"t"}"#);
	lab.put("jobs/job_list.json", "[]");
	lab.put("jobs/job_ok.json", &job_text("job_ok", "chat_1", "2026-11-02T00:00:00.000Z"));
	let jobs = store(&lab);
	assert!(jobs.get_job("job_broken").is_none() && jobs.get_job("job_nostatus").is_none() && jobs.get_job("job_list").is_none());
	let listed: Vec<String> = jobs.list_all_jobs().iter().map(|j| j["id"].as_str().unwrap().to_owned()).collect();
	assert_eq!(listed, ["job_ok"]);
	assert_eq!(lab.names("jobs").len(), 4);
}

#[test]
fn jobs_list_newest_first_and_by_chat() {
	let lab = Lab::new("jobs-list");
	lab.put("jobs/job_a.json", &job_text("job_a", "chat_1", "2026-11-02T00:00:00.000Z"));
	lab.put("jobs/job_b.json", &job_text("job_b", "chat_2", "2026-11-04T00:00:00.000Z"));
	lab.put("jobs/job_c.json", &job_text("job_c", "chat_1", "2026-11-03T00:00:00.000Z"));
	lab.put("jobs/job_d.json", &job_text("job_d", "chat_1", "2026-11-03T00:00:00.000Z"));
	let ids = |chat: Option<&str>| -> Vec<String> {
		let jobs = store(&lab);
		let list = chat.map_or_else(|| jobs.list_all_jobs(), |c| jobs.list_jobs(c));
		list.iter().map(|j| j["id"].as_str().unwrap().to_owned()).collect()
	};
	assert_eq!(ids(None), ["job_b", "job_c", "job_d", "job_a"]);
	assert_eq!(ids(Some("chat_1")), ["job_c", "job_d", "job_a"]);
	assert!(ids(Some("chat_9")).is_empty());
	let found = store(&lab).find_job_by_tool_call_id("chat_1", "t_job_a").unwrap();
	assert_eq!(found["id"].as_str(), Some("job_a"));
	assert!(store(&lab).find_job_by_tool_call_id("chat_2", "t_job_a").is_none());
}

#[test]
fn a_change_made_behind_the_cache_is_seen() {
	let lab = Lab::new("jobs-cache");
	lab.put("jobs/job_a.json", &job_text("job_a", "chat_1", "2026-11-02T00:00:00.000Z"));
	let jobs = store(&lab);
	assert_eq!(jobs.get_job("job_a").unwrap()["updatedAt"].as_str(), Some("2026-11-02T00:00:00.000Z"));
	lab.put("jobs/job_a.json", &format!("{}\n", job_text("job_a", "chat_1", "2026-11-09T00:00:00.000Z")));
	assert_eq!(jobs.get_job("job_a").unwrap()["updatedAt"].as_str(), Some("2026-11-09T00:00:00.000Z"));
	std::fs::remove_file(lab.file("jobs/job_a.json")).unwrap();
	assert!(jobs.get_job("job_a").is_none());
}

#[test]
fn deleting_a_chats_jobs_removes_only_its_files_and_announces_once() {
	let lab = Lab::new("jobs-delete");
	let jobs = store(&lab);
	let mine = [jobs.create_job(&init("chat_1", "a")).unwrap(), jobs.create_job(&init("chat_1", "b")).unwrap()];
	let other = jobs.create_job(&init("chat_2", "c")).unwrap();
	let mut events = lab.events.subscribe();
	assert_eq!(jobs.delete_jobs_for_chat("chat_1"), 2);
	let event = events.try_recv().unwrap();
	assert_eq!((event.kind, event.payload["chatId"].as_str()), (EventKind::JobsChanged, Some("chat_1")));
	assert!(events.try_recv().is_err());
	assert_eq!(jobs.delete_jobs_for_chat("chat_1"), 0);
	assert!(events.try_recv().is_err());
	assert!(mine.iter().all(|j| jobs.get_job(j["id"].as_str().unwrap()).is_none()));
	assert_eq!(lab.names("jobs"), [format!("{}.json", other["id"].as_str().unwrap())]);
}

#[test]
fn the_seed_jobs_all_read_and_lay_out_as_they_were_saved() {
	let lab = Lab::new("jobs-seed");
	if !lab.copy_seed("jobs") {
		return;
	}
	let names = lab.names("jobs");
	assert!(!names.is_empty());
	let jobs = store(&lab);
	for name in &names {
		let id = name.strip_suffix(".json").unwrap();
		let job = jobs.get_job(id).unwrap_or_else(|| panic!("{id} did not read"));
		assert_eq!(stringify_pretty(&job, "\t"), lab.get(&format!("jobs/{name}")), "{id}");
	}
	assert_eq!(jobs.list_all_jobs().len(), names.len());
	let newest = jobs.list_all_jobs();
	assert!(newest.windows(2).all(|w| w[0]["updatedAt"].as_str() >= w[1]["updatedAt"].as_str()));
}

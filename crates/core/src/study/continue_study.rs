//! A deadline's Study button reopens the latest unfinished Study session started from it, until it
//! is finished (its step bar's count reaches its last topic, or it reached its end)
//! (continue-study.ts).

use gs_base::time;
use gs_json::{Json, Obj};

use super::latest_session;
use crate::spaces::today_note::local_day;

/// The session a deadline's Study button reopens, `{ chatId, done, total, stop?, inTopic? }`: the
/// latest one started from it, while unfinished. `sessions` are `{ chatId, deadlineId, createdAt,
/// done, total, stop?, endedAt?, inTopic? }`: `stop` (`{at, next}`) is set while it waits at a stop
/// he has not kept going from, `endedAt` once it reached its end, `inTopic` while it is in the
/// middle of a topic.
pub fn continue_study_for(deadline_id: &str, sessions: &[Json]) -> Option<Json> {
	let latest = latest_session(deadline_id, sessions)?;
	let (done, total) = (latest["done"].as_f64(), latest["total"].as_f64());
	// `done >= total` is false when either is missing, so such a session stays open.
	if matches!((done, total), (Some(d), Some(t)) if d >= t) || latest["endedAt"].truthy() {
		return None;
	}
	let mut out = Obj::new();
	for key in ["chatId", "done", "total"] {
		out.insert(key, latest[key].clone());
	}
	for key in ["stop", "inTopic"] {
		if latest[key].truthy() {
			out.insert(key, latest[key].clone());
		}
	}
	Some(Json::Obj(out))
}

/// Whether the deadline's latest session reached its end on `today` (the learner's day,
/// YYYY-MM-DD).
pub fn ended_today_for(deadline_id: &str, sessions: &[Json], today: &str) -> bool {
	let ended_at = latest_session(deadline_id, sessions).and_then(|s| s["endedAt"].as_str()).and_then(time::parse_date);
	ended_at.is_some_and(|ms| local_day(ms) == today)
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn the_latest_unfinished_session_wins() {
		let s = |chat: &str, at: &str, done: i64| json!({ "chatId": chat, "deadlineId": "d1", "createdAt": at, "done": done, "total": 3 });
		let sessions = [s("a", "2026-01-01", 1), s("b", "2026-01-03", 2), s("c", "2026-01-02", 0), json!({ "chatId": "z", "deadlineId": "d2", "createdAt": "2027", "done": 0, "total": 1 })];
		assert_eq!(continue_study_for("d1", &sessions), Some(json!({ "chatId": "b", "done": 2, "total": 3 })));
		assert_eq!(continue_study_for("d1", &[s("a", "2026-01-01", 3)]), None);
		assert_eq!(continue_study_for("nope", &sessions), None);
	}

	#[test]
	fn it_carries_the_stop_and_the_topic_and_closes_at_the_end() {
		let stop = json!({ "at": "2026-11-18T21:48:00.000Z", "next": "Cross-validation" });
		let stopped = json!({ "chatId": "a", "deadlineId": "d1", "createdAt": "1", "done": 1, "total": 3, "stop": stop.clone(), "inTopic": "" });
		assert_eq!(continue_study_for("d1", &[stopped]), Some(json!({ "chatId": "a", "done": 1, "total": 3, "stop": stop })));
		let mid = json!({ "chatId": "a", "deadlineId": "d1", "createdAt": "1", "done": 2, "total": 3, "inTopic": "Cross-validation" });
		assert_eq!(continue_study_for("d1", &[mid]), Some(json!({ "chatId": "a", "done": 2, "total": 3, "inTopic": "Cross-validation" })));
		let fresh = json!({ "chatId": "a", "deadlineId": "d1", "createdAt": "1", "done": 0, "total": 3, "inTopic": "Regularization" });
		assert_eq!(continue_study_for("d1", &[fresh]), Some(json!({ "chatId": "a", "done": 0, "total": 3, "inTopic": "Regularization" })));
		let ended = json!({ "chatId": "a", "deadlineId": "d1", "createdAt": "1", "done": 2, "total": 3, "endedAt": "2026-11-18T22:40:00.000Z" });
		assert_eq!(continue_study_for("d1", &[ended]), None);
	}

	#[test]
	fn ended_today_is_the_learners_day_of_the_end() {
		let ended_at = time::parse_date("2026-11-18T22:40:00.000Z").unwrap();
		let today = local_day(ended_at);
		let tomorrow = local_day(ended_at + 86_400_000);
		let ended = json!({ "chatId": "a", "deadlineId": "d1", "createdAt": "2", "done": 3, "total": 3, "endedAt": "2026-11-18T22:40:00.000Z" });
		assert!(ended_today_for("d1", std::slice::from_ref(&ended), &today));
		assert!(!ended_today_for("d1", std::slice::from_ref(&ended), &tomorrow), "not the next day");
		let newer = json!({ "chatId": "b", "deadlineId": "d1", "createdAt": "3", "done": 0, "total": 3 });
		assert!(!ended_today_for("d1", &[ended, newer], &today), "only the latest session counts");
		assert!(!ended_today_for("d2", &[], &today));
	}
}

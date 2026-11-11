//! A deadline's Study button reopens the latest unfinished Study session started from it
//! (continue-study.ts).

use gs_json::{Json, json};

use super::latest_session;

/// The session a deadline's Study button reopens, `{ chatId, done, total }`: the latest one
/// started from it, while unfinished. `sessions` are `{ chatId, deadlineId, createdAt, done, total }`.
pub fn continue_study_for(deadline_id: &str, sessions: &[Json]) -> Option<Json> {
	let latest = latest_session(deadline_id, sessions)?;
	let (done, total) = (latest["done"].as_f64(), latest["total"].as_f64());
	// `done >= total` is false when either is missing, so such a session stays open.
	if matches!((done, total), (Some(d), Some(t)) if d >= t) {
		return None;
	}
	Some(json!({ "chatId": latest["chatId"], "done": latest["done"], "total": latest["total"] }))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_latest_unfinished_session_wins() {
		let s = |chat: &str, at: &str, done: i64| json!({ "chatId": chat, "deadlineId": "d1", "createdAt": at, "done": done, "total": 3 });
		let sessions = [s("a", "2026-01-01", 1), s("b", "2026-01-03", 2), s("c", "2026-01-02", 0), json!({ "chatId": "z", "deadlineId": "d2", "createdAt": "2027", "done": 0, "total": 1 })];
		assert_eq!(continue_study_for("d1", &sessions), Some(json!({ "chatId": "b", "done": 2, "total": 3 })));
		assert_eq!(continue_study_for("d1", &[s("a", "2026-01-01", 3)]), None);
		assert_eq!(continue_study_for("nope", &sessions), None);
	}
}

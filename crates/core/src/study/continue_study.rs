//! A deadline's Study button reopens the lesson tied to it that the learner last worked in, until
//! that one is finished: it reached its end, or it is at its last step with no stop left to go on
//! from.

use gs_base::time;
use gs_json::{Json, Obj};

use super::latest_session;
use crate::spaces::today_note::local_day;

/// The session a deadline's Study button reopens, `{ chatId, done?, total?, stop?, inTopic? }`:
/// the one tied to it last worked in, while unfinished. A count at its last topic still continues
/// at a stop, since a skipped topic may be left. `sessions` are `{ chatId, deadlineId, updatedAt,
/// done?, total?, stop?, endedAt?, inTopic? }`: the count is missing until the session has a plan,
/// `stop` (`{at, next}`) is set while it waits at a stop
/// he has not kept going from, `endedAt` once it reached its end, `inTopic` while it is in the
/// middle of a topic.
pub fn continue_study_for(deadline_id: &str, sessions: &[Json]) -> Option<Json> {
	let latest = last_worked(deadline_id, sessions)?;
	if plan_finished(latest) {
		return None;
	}
	let mut out = Obj::new();
	out.insert("chatId", latest["chatId"].clone());
	// A session whose plan the agent has not written yet has no count.
	for key in ["done", "total"] {
		out.insert_present(key, latest.get(key));
	}
	for key in ["stop", "inTopic"] {
		if latest[key].truthy() {
			out.insert(key, latest[key].clone());
		}
	}
	Some(Json::Obj(out))
}

/// The deadline's session last worked in: a lesson's `updatedAt` moves only when a message of
/// its conversation is saved.
fn last_worked<'a>(deadline_id: &str, sessions: &'a [Json]) -> Option<&'a Json> {
	latest_session(deadline_id, sessions, "updatedAt")
}

/// Whether a lesson's plan state (`{ step?, total?, stop?, endedAt? }`) is finished: it reached
/// its end, or it is at its last step with no stop left to go on from (a lesson from before stops
/// ends no other way).
pub fn plan_finished(state: &Json) -> bool {
	let (step, total) = (state["step"].as_f64(), state["total"].as_f64());
	// `step >= total` is false when either is missing, so a lesson with no count stays open.
	let at_last = matches!((step, total), (Some(s), Some(t)) if s >= t) && !state["stop"].truthy();
	at_last || state["endedAt"].truthy()
}

/// Whether the deadline's session last worked in reached its end on `today` (the learner's day,
/// YYYY-MM-DD).
pub fn ended_today_for(deadline_id: &str, sessions: &[Json], today: &str) -> bool {
	let ended_at = last_worked(deadline_id, sessions).and_then(|s| s["endedAt"].as_str()).and_then(time::parse_date);
	ended_at.is_some_and(|ms| local_day(ms) == today)
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn the_session_last_worked_in_wins_while_unfinished() {
		let s = |chat: &str, at: &str, done: i64| json!({ "chatId": chat, "deadlineId": "d1", "updatedAt": at, "done": done, "step": done, "total": 3 });
		let sessions = [s("a", "2026-01-01", 1), s("b", "2026-01-03", 2), s("c", "2026-01-02", 0), json!({ "chatId": "z", "deadlineId": "d2", "updatedAt": "2027", "done": 0, "total": 1 })];
		assert_eq!(continue_study_for("d1", &sessions), Some(json!({ "chatId": "b", "done": 2, "total": 3 })));
		assert_eq!(continue_study_for("d1", &[s("a", "2026-01-01", 3)]), None);
		assert_eq!(continue_study_for("nope", &sessions), None);
		let back_in_the_older = [json!({ "chatId": "old", "deadlineId": "d1", "createdAt": "2026-01-01", "updatedAt": "2026-01-09", "done": 1, "total": 3 }), json!({ "chatId": "new", "deadlineId": "d1", "createdAt": "2026-01-05", "updatedAt": "2026-01-06", "done": 0, "total": 7 })];
		assert_eq!(continue_study_for("d1", &back_in_the_older), Some(json!({ "chatId": "old", "done": 1, "total": 3 })), "the one worked in last, not the one made last");
		let unplanned = json!({ "chatId": "u", "deadlineId": "d1", "updatedAt": "2026-01-04" });
		assert_eq!(continue_study_for("d1", &[unplanned]), Some(json!({ "chatId": "u" })), "no plan yet: reopened with no count");
	}

	#[test]
	fn it_carries_the_stop_and_the_topic_and_closes_at_the_end() {
		let stop = json!({ "at": "2026-11-18T21:48:00.000Z", "next": "Cross-validation" });
		let stopped = json!({ "chatId": "a", "deadlineId": "d1", "updatedAt": "1", "done": 1, "total": 3, "stop": stop.clone(), "inTopic": "" });
		assert_eq!(continue_study_for("d1", &[stopped]), Some(json!({ "chatId": "a", "done": 1, "total": 3, "stop": stop })));
		let mid = json!({ "chatId": "a", "deadlineId": "d1", "updatedAt": "1", "done": 2, "total": 3, "inTopic": "Cross-validation" });
		assert_eq!(continue_study_for("d1", &[mid]), Some(json!({ "chatId": "a", "done": 2, "total": 3, "inTopic": "Cross-validation" })));
		let fresh = json!({ "chatId": "a", "deadlineId": "d1", "updatedAt": "1", "done": 0, "total": 3, "inTopic": "Regularization" });
		assert_eq!(continue_study_for("d1", &[fresh]), Some(json!({ "chatId": "a", "done": 0, "total": 3, "inTopic": "Regularization" })));
		let ended = json!({ "chatId": "a", "deadlineId": "d1", "updatedAt": "1", "done": 2, "total": 3, "endedAt": "2026-11-18T22:40:00.000Z" });
		assert_eq!(continue_study_for("d1", &[ended]), None);
	}

	#[test]
	fn a_full_count_still_continues_at_a_stop() {
		let stop = json!({ "at": "2026-11-18T21:48:00.000Z", "next": "Cross-validation" });
		let skipped_left = json!({ "chatId": "a", "deadlineId": "d1", "updatedAt": "1", "done": 3, "step": 3, "total": 3, "stop": stop.clone() });
		assert_eq!(continue_study_for("d1", &[skipped_left]), Some(json!({ "chatId": "a", "done": 3, "total": 3, "stop": stop })), "a skipped topic is left");
		let old_finished = json!({ "chatId": "a", "deadlineId": "d1", "updatedAt": "1", "done": 2, "step": 3, "total": 3 });
		assert_eq!(continue_study_for("d1", &[old_finished]), None, "finished before stops existed");
		let mid_last = json!({ "chatId": "a", "deadlineId": "d1", "updatedAt": "1", "done": 2, "step": 3, "total": 3, "inTopic": "Model selection" });
		assert_eq!(continue_study_for("d1", &[mid_last]), None, "in the middle of the last topic");
	}

	#[test]
	fn a_plan_is_finished_at_its_end_or_at_its_last_step_with_no_stop_left() {
		let stop = json!({ "at": "2026-11-18T21:48:00.000Z", "next": "Cross-validation" });
		assert!(!plan_finished(&json!({ "done": 1, "step": 2, "total": 3 })), "mid-way");
		assert!(!plan_finished(&json!({})), "no count yet");
		assert!(plan_finished(&json!({ "done": 2, "step": 3, "total": 3 })), "at its last step");
		assert!(plan_finished(&json!({ "done": 2, "step": 3, "total": 3, "inTopic": "Model selection" })), "in the last topic");
		assert!(!plan_finished(&json!({ "done": 3, "step": 3, "total": 3, "stop": stop })), "a skipped topic is left");
		assert!(!plan_finished(&json!({ "done": 3, "step": 2, "total": 3 })), "the step number decides, not the ticks");
		assert!(plan_finished(&json!({ "done": 1, "step": 1, "total": 3, "endedAt": "2026-11-18T22:40:00.000Z" })), "reached its end");
	}

	#[test]
	fn ended_today_is_the_learners_day_of_the_end() {
		let ended_at = time::parse_date("2026-11-18T22:40:00.000Z").unwrap();
		let today = local_day(ended_at);
		let tomorrow = local_day(ended_at + 86_400_000);
		let ended = json!({ "chatId": "a", "deadlineId": "d1", "updatedAt": "2", "done": 3, "total": 3, "endedAt": "2026-11-18T22:40:00.000Z" });
		assert!(ended_today_for("d1", std::slice::from_ref(&ended), &today));
		assert!(!ended_today_for("d1", std::slice::from_ref(&ended), &tomorrow), "not the next day");
		let newer = json!({ "chatId": "b", "deadlineId": "d1", "updatedAt": "3", "done": 0, "total": 3 });
		assert!(!ended_today_for("d1", &[ended, newer], &today), "only the session last worked in counts");
		assert!(!ended_today_for("d2", &[], &today));
	}
}

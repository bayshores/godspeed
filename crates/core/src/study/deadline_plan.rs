//! The path to a deadline: the topics that still need work, weakest first, spread over the days
//! until it is due (deadline-plan.ts). A topic is `{ id, name, rate, ... }` and stays whole.

use std::cmp::Ordering;

use gs_base::time;
use gs_json::{Json, json};

use super::progress::{TopicStatus, days_between, topic_status};

/// Weak first (lowest rate first), then not tried yet, then shaky.
fn rank(topic: &Json) -> u8 {
	match topic_status(topic["rate"].as_f64()) {
		TopicStatus::Weak => 0,
		TopicStatus::Untested => 1,
		TopicStatus::Shaky => 2,
		TopicStatus::Strong => 3,
	}
}

/// The topics that are not strong, in the order to work on them.
pub fn topics_to_work_on(topics: &[Json]) -> Vec<Json> {
	let mut work: Vec<&Json> = topics.iter().filter(|t| topic_status(t["rate"].as_f64()) != TopicStatus::Strong).collect();
	work.sort_by(|a, b| rank(a).cmp(&rank(b)).then(a["rate"].as_f64().unwrap_or(0.0).partial_cmp(&b["rate"].as_f64().unwrap_or(0.0)).unwrap_or(Ordering::Equal)));
	work.into_iter().cloned().collect()
}

/// "YYYY-MM-DD" plus n days.
fn add_days(day: &str, n: i64) -> String {
	let mut p = day.split('-').map(|x| x.parse::<i64>().unwrap_or(0));
	let (y, m, d) = (p.next().unwrap_or(0), p.next().unwrap_or(0), p.next().unwrap_or(0));
	// Month overflow rolls into the next year like Date.UTC.
	let (y, m) = (y + (m - 1).div_euclid(12), (m - 1).rem_euclid(12) + 1);
	let (y, m, d) = time::civil_from_days(time::days_from_civil(y, m, 1) + d - 1 + n);
	format!("{y:04}-{m:02}-{d:02}")
}

/// The study days with their topics, `[{ day, topics }]`, today first. Empty when the deadline is
/// past or nothing needs work. More topics than days puts several on a day (the earlier days take
/// the extra); fewer leaves the later days free.
///
/// A topic finished in a Study session today (`finishedToday`) goes after the others and never on
/// today: it moves to tomorrow, or out of the plan when tomorrow is the due day. Today then stays,
/// empty when nothing else is left.
pub fn plan_days(today: &str, due: &str, topics: &[Json]) -> Vec<Json> {
	let days = days_between(today, due);
	let finished = |t: &Json| t["finishedToday"].truthy();
	let (fresh, done): (Vec<Json>, Vec<Json>) = topics_to_work_on(topics).into_iter().partition(|t| !finished(t));
	let work: Vec<Json> = fresh.into_iter().chain(done).collect();
	if days < 0 || work.is_empty() {
		return vec![];
	}
	let count = days.min(work.len() as i64).max(1) as usize;
	let (base, extra) = (work.len() / count, work.len() % count);
	let mut next = 0;
	let mut plan: Vec<(String, Vec<Json>)> = (0..count)
		.map(|i| {
			let size = base + usize::from(i < extra);
			let day = (add_days(today, i as i64), work[next..next + size].to_vec());
			next += size;
			day
		})
		.collect();
	let (stay, moved): (Vec<Json>, Vec<Json>) = std::mem::take(&mut plan[0].1).into_iter().partition(|t| !finished(t));
	plan[0].1 = stay;
	if !moved.is_empty() && days >= 2 {
		if plan.len() < 2 {
			plan.push((add_days(today, 1), Vec::new()));
		}
		plan[1].1.splice(0..0, moved);
	}
	plan.into_iter().map(|(day, topics)| json!({ "day": day, "topics": topics })).collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	fn topic(id: &str, rate: Option<f64>) -> Json {
		json!({ "id": id, "name": id, "rate": rate })
	}

	#[test]
	fn weak_then_untested_then_shaky_and_strong_left_out() {
		let topics = [topic("shaky", Some(0.6)), topic("strong", Some(0.9)), topic("none", None), topic("weak2", Some(0.3)), topic("weak1", Some(0.1))];
		let ids: Vec<_> = topics_to_work_on(&topics).iter().map(|t| t["id"].as_str().unwrap().to_owned()).collect();
		assert_eq!(ids, ["weak1", "weak2", "none", "shaky"]);
	}

	#[test]
	fn topics_spread_over_the_days_before_the_deadline() {
		let topics = [topic("a", Some(0.1)), topic("b", Some(0.2)), topic("c", Some(0.3))];
		let plan = plan_days("2026-12-30", "2027-01-01", &topics);
		assert_eq!(plan.len(), 2);
		assert_eq!(plan[0]["day"], Json::from("2026-12-30"));
		assert_eq!(plan[1]["day"], Json::from("2026-12-31"));
		assert_eq!(plan[0]["topics"].as_arr().unwrap().len(), 2);
		assert_eq!(plan[1]["topics"].as_arr().unwrap().len(), 1);
		assert!(plan_days("2026-12-30", "2026-12-29", &topics).is_empty());
		assert_eq!(plan_days("2026-12-30", "2026-12-30", &topics).len(), 1);
	}

	fn finished(id: &str, rate: Option<f64>) -> Json {
		json!({ "id": id, "name": id, "rate": rate, "finishedToday": true })
	}

	fn day_ids(plan: &[Json]) -> Vec<Vec<String>> {
		plan.iter().map(|d| d["topics"].as_arr().unwrap().iter().map(|t| t["id"].as_str().unwrap().to_owned()).collect()).collect()
	}

	#[test]
	fn a_topic_finished_today_is_never_planned_today() {
		let topics = [finished("a", Some(0.6)), topic("b", Some(0.7)), finished("c", Some(0.3))];
		assert_eq!(day_ids(&plan_days("2026-11-10", "2026-11-14", &topics)), [vec!["b"], vec!["c"], vec!["a"]]);
		// Only finished topics left: today stays, empty, and they wait for later days.
		let done = [finished("a", Some(0.6)), finished("c", Some(0.3))];
		assert_eq!(day_ids(&plan_days("2026-11-10", "2026-11-14", &done)), [vec![], vec!["c", "a"]]);
		assert_eq!(day_ids(&plan_days("2026-11-10", "2026-11-14", &done[..1])), [vec![], vec!["a"]]);
		// Due today or tomorrow there is no later day: they are left out of the plan.
		assert_eq!(day_ids(&plan_days("2026-11-10", "2026-11-11", &done)), [Vec::<String>::new()]);
		assert_eq!(day_ids(&plan_days("2026-11-10", "2026-11-10", &topics)), [vec!["b"]]);
	}
}

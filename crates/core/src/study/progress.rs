//! Ported from src/shared/core/progress.ts.
//!
//! `days_between`, `answer_outcome` and `is_answer_data` were written with the foundations
//! because other packages call them; keep their signatures. The rest of the file lives in
//! sibling modules and is re-exported here under its TypeScript names.

use gs_base::{num, time};
use gs_json::Json;

pub use super::answers::{collect_answers, facts_by_message, facts_for_answer};
pub use super::derive_progress::derive_progress;
pub use super::fact_progress::topic_facts;

/// The topic ramp, red to green: CSS colors, so each background keeps them readable.
const RAMP_COLORS: [&str; 5] = ["var(--lh-ramp-1)", "var(--lh-ramp-2)", "var(--lh-ramp-3)", "var(--lh-ramp-4)", "var(--lh-ramp-5)"];
/// Untested (no answers yet): the quietest ink.
const UNTESTED_COLOR: &str = "var(--lh-ink-3)";

/// The ramp color for a right rate (0 to 1); gray when untested.
pub fn ramp_color(rate: Option<f64>) -> &'static str {
	let Some(rate) = rate.filter(|r| r.is_finite()) else { return UNTESTED_COLOR };
	RAMP_COLORS[[0.4, 0.55, 0.7, 0.85].iter().take_while(|&&limit| rate >= limit).count()]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TopicStatus {
	Strong,
	Shaky,
	Weak,
	Untested,
}

impl TopicStatus {
	pub fn as_str(self) -> &'static str {
		match self {
			TopicStatus::Strong => "strong",
			TopicStatus::Shaky => "shaky",
			TopicStatus::Weak => "weak",
			TopicStatus::Untested => "untested",
		}
	}

	pub fn parse(text: &str) -> Option<TopicStatus> {
		[TopicStatus::Strong, TopicStatus::Shaky, TopicStatus::Weak, TopicStatus::Untested].into_iter().find(|s| s.as_str() == text)
	}
}

/// Strong at 85% right or more, shaky from 55%, weak below, untested with no answers.
pub fn topic_status(rate: Option<f64>) -> TopicStatus {
	match rate {
		None => TopicStatus::Untested,
		Some(r) if r >= 0.85 => TopicStatus::Strong,
		Some(r) if r >= 0.55 => TopicStatus::Shaky,
		Some(_) => TopicStatus::Weak,
	}
}

/// Whole days from `today` to `date` (both `YYYY-MM-DD`), rounded like Math.round.
pub fn days_between(today: &str, date: &str) -> i64 {
	let utc = |d: &str| {
		let mut p = d.split('-').map(|x| x.parse::<i64>().unwrap_or(0));
		let (y, m, day) = (p.next().unwrap_or(0), p.next().unwrap_or(0), p.next().unwrap_or(0));
		(time::days_from_civil(y, 1, 1) + month_offset(y, m) + day - 1) as f64
	};
	num::math_round(utc(date) - utc(today)) as i64
}

/// Days from Jan 1 to the first of month `m` (1-based; overflowing months roll into later years
/// like Date.UTC).
fn month_offset(y: i64, m: i64) -> i64 {
	let (y2, m2) = (y + (m - 1).div_euclid(12), (m - 1).rem_euclid(12) + 1);
	time::days_from_civil(y2, m2, 1) - time::days_from_civil(y, 1, 1)
}

/// A quiz answer's outcome: "right", "wrong", "dontKnow", or None (not graded or dismissed).
pub fn answer_outcome(ad: &Json) -> Option<&'static str> {
	if ad["dismissed"].truthy() || ad["kind"].as_str() != Some("quiz") {
		return None;
	}
	if ad["dontKnow"].truthy() {
		return Some("dontKnow");
	}
	ad["correct"].as_bool().map(|c| if c { "right" } else { "wrong" })
}

/// An object with a string `kind`.
pub fn is_answer_data(v: &Json) -> bool {
	v["kind"].as_str().is_some()
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::*;

	#[test]
	fn days_and_outcomes() {
		assert_eq!(days_between("2026-11-09", "2026-11-17"), 8);
		assert_eq!(days_between("2026-11-09", "2026-10-31"), -9);
		assert_eq!(days_between("2026-12-31", "2027-01-01"), 1);
		assert_eq!(answer_outcome(&json!({ "kind": "quiz", "correct": true })), Some("right"));
		assert_eq!(answer_outcome(&json!({ "kind": "quiz" })), None);
		assert_eq!(answer_outcome(&json!({ "kind": "explain", "correct": true })), None);
	}

	#[test]
	fn statuses_and_colors_cut_at_the_same_rates() {
		let at = |r| (topic_status(Some(r)).as_str(), ramp_color(Some(r)));
		assert_eq!(at(0.85), ("strong", "var(--lh-ramp-5)"));
		assert_eq!(at(0.849), ("shaky", "var(--lh-ramp-4)"));
		assert_eq!(at(0.7), ("shaky", "var(--lh-ramp-4)"));
		assert_eq!(at(0.55), ("shaky", "var(--lh-ramp-3)"));
		assert_eq!(at(0.54), ("weak", "var(--lh-ramp-2)"));
		assert_eq!(at(0.4), ("weak", "var(--lh-ramp-2)"));
		assert_eq!(at(0.39), ("weak", "var(--lh-ramp-1)"));
		assert_eq!((topic_status(None), ramp_color(None)), (TopicStatus::Untested, "var(--lh-ink-3)"));
		assert_eq!(ramp_color(Some(f64::NAN)), "var(--lh-ink-3)");
		assert_eq!(TopicStatus::parse("weak"), Some(TopicStatus::Weak));
	}
}

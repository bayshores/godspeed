//! The spaces' gaps (`gs_core::spaces::space_gaps`) the learner has not waved off, and the
//! answer that waves one off. Answers are kept in `data/deadline-requests.json` (`gapAsked`).

use gs_core::spaces::space_gaps::{Gap, space_gap};
use gs_core::spaces::today_note::local_day;

use super::deadline_requests::{change_record, read_record};
use crate::App;
use crate::outcome::{Outcome, refuse};

/// Each open space's gap at `now` (ms), at most one per space, leaving out the answered ones.
pub fn open_gaps(app: &App, now: i64) -> Vec<Gap> {
	let today = local_day(now);
	let answered = read_record(app).gap_asked;
	app.stores.spaces.list_space_records().iter().filter_map(|space| space_gap(space, &today)).filter(|gap| !answered.contains(&gap.key)).collect()
}

/// The learner waved off the space's gap with this key: it is not asked again.
pub fn answer_gap(app: &App, space_id: &str, key: &str) -> Outcome<()> {
	if app.stores.spaces.get_space(space_id).is_none() {
		return refuse(404, "Unknown space");
	}
	if !key.strip_prefix(space_id).is_some_and(|rest| rest.starts_with(':')) {
		return refuse(404, "Unknown gap");
	}
	change_record(app, |r| r.answer_gap(key));
	Ok(())
}

#[cfg(test)]
mod tests {
	use gs_base::clock;
	use gs_core::study::deadline_plan::add_days;
	use gs_json::json;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	#[test]
	fn a_gap_waved_off_stays_gone_until_the_next_one() {
		let app = test_app(&scratch_dir("space-gaps-answer"));
		let now = clock::now_ms();
		let today = local_day(now);
		let space_id = app.stores.spaces.create_space(&json!({ "name": "CSE 29" })).unwrap()["id"].str_or_empty().to_owned();
		for (kind, name, days) in [("homework", "HW1", 9), ("exam", "Test 2", 2)] {
			app.stores.spaces.add_deadline(&space_id, &json!({ "kind": kind, "name": name, "date": add_days(&today, -days) })).unwrap();
		}
		let gaps = open_gaps(&app, now);
		assert_eq!(gaps.iter().map(|g| g.title.as_str()).collect::<Vec<_>>(), ["Nothing coming up in CSE 29"]);
		let key = gaps[0].key.clone();
		assert_eq!(answer_gap(&app, "spc_nope", &key), Err(crate::outcome::Stop::Refuse(404, "Unknown space".to_owned())));
		assert_eq!(answer_gap(&app, &space_id, "spc_other:ddl:recent"), Err(crate::outcome::Stop::Refuse(404, "Unknown gap".to_owned())));
		answer_gap(&app, &space_id, &key).unwrap();
		assert!(open_gaps(&app, now).is_empty());
		let later = open_gaps(&app, now + 20 * 86_400_000);
		assert_eq!(later.iter().map(|g| g.title.as_str()).collect::<Vec<_>>(), ["Is CSE 29 over?"], "the next stage asks again");
		answer_gap(&app, &space_id, &later[0].key).unwrap();
		assert_eq!(read_record(&app).gap_asked.into_iter().collect::<Vec<_>>(), [later[0].key.clone()], "one key per space");
	}
}

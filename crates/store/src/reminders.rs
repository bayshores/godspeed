//! data/reminders.json, the local day the last deadline reminder went out, so a second start on
//! the same day sends none. A file that cannot be read or parsed reads as no reminder yet.

use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::fsx;
use gs_json::{json, parse, stringify_pretty};

const FILE_NAME: &str = "reminders.json";
const VERSION: i64 = 1;

pub struct RemindersStore {
	file: PathBuf,
}

impl RemindersStore {
	pub fn new(paths: &Paths) -> RemindersStore {
		RemindersStore { file: paths.data.join(FILE_NAME) }
	}

	/// The day (YYYY-MM-DD) of the last reminder.
	pub fn last_reminder_day(&self) -> Option<String> {
		let record = parse(&fsx::read_text(&self.file).ok()?).ok()?;
		record["lastDay"].as_str().map(str::to_owned)
	}

	pub fn set_last_reminder_day(&self, day: &str) -> Result<(), String> {
		let record = json!({ "version": VERSION, "lastDay": day });
		fsx::write_text_atomic(&self.file, &stringify_pretty(&record, "\t")).map_err(|err| fsx::node_error_message(&err, "open", &self.file))
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_last_day_round_trips_and_a_bad_file_reads_as_none() {
		let root = std::env::temp_dir().join(format!("gs-reminders-{}", gs_base::ids::uuid()));
		let paths = Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res"));
		let store = RemindersStore::new(&paths);
		assert_eq!(store.last_reminder_day(), None);
		store.set_last_reminder_day("2026-11-13").unwrap();
		assert_eq!(store.last_reminder_day().as_deref(), Some("2026-11-13"));
		assert_eq!(std::fs::read_to_string(root.join("data/reminders.json")).unwrap(), "{\n\t\"version\": 1,\n\t\"lastDay\": \"2026-11-13\"\n}");
		fsx::write_text_atomic(&root.join("data/reminders.json"), "{").unwrap();
		assert_eq!(store.last_reminder_day(), None);
		let _ = std::fs::remove_dir_all(&root);
	}
}

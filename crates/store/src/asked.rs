//! data/deadline-requests.json, what godspeed asked its agent about (gs_core's
//! spaces::deadline_requests says what is kept). A file that cannot be read reads as nothing asked.

use gs_base::config::Paths;
use gs_base::locks::Locks;
use gs_core::spaces::deadline_requests::{ASKED_VERSION, AskedRecord};

use crate::app_file::AppFile;

pub struct AskedStore {
	file: AppFile,
}

impl AskedStore {
	pub fn new(paths: &Paths, locks: &Locks) -> AskedStore {
		AskedStore { file: AppFile::new(paths, locks, "deadline-requests.json", i64::from(ASKED_VERSION)) }
	}

	pub fn read(&self) -> AskedRecord {
		AskedRecord::read(&self.file.read())
	}

	/// Changes the record under the file's lock. A save that fails is logged: what was asked only
	/// stops the same ask from coming twice.
	pub fn update(&self, change: impl FnOnce(&mut AskedRecord)) {
		let saved = self.file.update(|saved| {
			let mut record = AskedRecord::read(saved);
			change(&mut record);
			Ok((Some(record.to_json()), ()))
		});
		if let Err(err) = saved {
			eprintln!("[store] could not save what was asked: {err}");
		}
	}
}

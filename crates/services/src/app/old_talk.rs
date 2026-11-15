//! The Talk chat an older build kept (`data/chats/chat_talk.json` and its `chat_talk/` folder of
//! PDFs) is the learner's and is only ever read here: once backed up inside the data folder, and
//! once exported as `Talk.md` with `Talk files/` in the godspeed folder so it stays readable.

use std::io;
use std::path::Path;

use gs_base::config::{Paths, VERSION};
use gs_base::fsx;
use gs_core::contracts::chat::TALK_CHAT_ID;
use gs_core::messages::talk_export::{TALK_FILES, talk_export};
use gs_core::records::settings::DEFAULT_TEACHER_NAME;

use crate::App;

const BACKUP_PREFIX: &str = "talk-backup-";
const TALK_MD: &str = "Talk.md";

/// First thing at start-up, before anything can read or change the record: copies it and its
/// folder to `data/talk-backup-<version>/`, once ever (an existing backup from any version
/// counts), and only when there is a record.
pub fn back_up_talk(paths: &Paths) {
	if let Err(err) = back_up(&paths.data, &paths.chats, VERSION) {
		eprintln!("[talk] backup failed: {err}");
	}
}

fn back_up(data: &Path, chats: &Path, version: &str) -> io::Result<()> {
	let record = chats.join(format!("{TALK_CHAT_ID}.json"));
	if !record.is_file() || backed_up(data)? {
		return Ok(());
	}
	let partial = data.join(format!("{BACKUP_PREFIX}{version}.partial"));
	if partial.exists() {
		std::fs::remove_dir_all(&partial)?;
	}
	std::fs::create_dir(&partial)?;
	std::fs::copy(&record, partial.join(format!("{TALK_CHAT_ID}.json")))?;
	let folder = chats.join(TALK_CHAT_ID);
	if folder.is_dir() {
		copy_dir(&folder, &partial.join(TALK_CHAT_ID))?;
	}
	std::fs::rename(&partial, data.join(format!("{BACKUP_PREFIX}{version}")))
}

fn backed_up(data: &Path) -> io::Result<bool> {
	for entry in std::fs::read_dir(data)? {
		let name = entry?.file_name().to_string_lossy().into_owned();
		if name.starts_with(BACKUP_PREFIX) && !name.ends_with(".partial") {
			return Ok(true);
		}
	}
	Ok(false)
}

fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
	std::fs::create_dir(to)?;
	for entry in std::fs::read_dir(from)? {
		let entry = entry?;
		let target = to.join(entry.file_name());
		if entry.file_type()?.is_dir() {
			copy_dir(&entry.path(), &target)?;
		} else {
			std::fs::copy(entry.path(), target)?;
		}
	}
	Ok(())
}

/// Writes `Talk.md` and `Talk files/` into `folder` unless `Talk.md` is already there (then
/// nothing is written). Answers whether `Talk.md` is there now (false: no Talk record, or nothing
/// in it was ever shown). Files already in `Talk files/` are left as they are; `Talk.md` is
/// renamed into place last, so it is there only once everything beside it is.
pub(super) fn export_talk(app: &App, folder: &Path) -> io::Result<bool> {
	let file = folder.join(TALK_MD);
	if file.exists() {
		return Ok(true);
	}
	let Some(record) = app.stores.chats.get_chat(TALK_CHAT_ID) else { return Ok(false) };
	let settings = app.stores.settings.read_settings().ok().flatten();
	let teacher = settings.as_ref().and_then(|s| s["general"]["teacherName"].as_str()).filter(|n| !n.trim().is_empty()).unwrap_or(DEFAULT_TEACHER_NAME);
	let Some(export) = talk_export(&record, teacher) else { return Ok(false) };
	let files = folder.join(TALK_FILES);
	for picture in &export.pictures {
		let target = files.join(&picture.name);
		if !target.exists() {
			fsx::write_atomic(&target, &picture.bytes, None)?;
		}
	}
	let pdfs = app.paths.chats.join(TALK_CHAT_ID);
	if pdfs.is_dir() {
		for entry in std::fs::read_dir(&pdfs)? {
			let entry = entry?;
			let target = files.join(entry.file_name());
			if entry.file_type()?.is_file() && !target.exists() {
				std::fs::create_dir_all(&files)?;
				let partial = partial_of(&target);
				std::fs::copy(entry.path(), &partial)?;
				std::fs::rename(&partial, target)?;
			}
		}
	}
	let partial = partial_of(&file);
	fsx::write_text_atomic(&partial, &export.text)?;
	std::fs::rename(&partial, &file)?;
	Ok(true)
}

/// A file is written under this name and renamed when whole, so a crash never leaves half of it
/// under the real name (and the next start makes it again).
fn partial_of(file: &Path) -> std::path::PathBuf {
	file.with_file_name(format!("{}.partial", file.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()))
}

#[cfg(test)]
mod tests {
	use std::collections::BTreeMap;
	use std::path::PathBuf;

	use gs_json::{parse, stringify};

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	/// Every file under `dir` and its bytes.
	fn snapshot(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
		let mut files = BTreeMap::new();
		let mut stack = vec![dir.to_path_buf()];
		while let Some(at) = stack.pop() {
			for entry in std::fs::read_dir(&at).unwrap().flatten() {
				if entry.file_type().unwrap().is_dir() {
					stack.push(entry.path());
				} else {
					files.insert(entry.path().strip_prefix(dir).unwrap().to_path_buf(), std::fs::read(entry.path()).unwrap());
				}
			}
		}
		files
	}

	/// The real Talk record from the fixtures, saved as an older build left it, with a PDF.
	fn old_talk(app: &App) {
		let all = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../core/tests/fixtures/session_chats.json")).unwrap()).unwrap();
		let talk = all["chats"].as_arr().unwrap().iter().find(|c| c["id"].as_str() == Some(TALK_CHAT_ID)).unwrap();
		fsx::write_text_atomic(&app.paths.chats.join("chat_talk.json"), &stringify(talk)).unwrap();
		fsx::write_atomic(&app.paths.chats.join("chat_talk/0123456789ab-Syllabus.pdf"), b"%PDF-1.4 made up", None).unwrap();
	}

	#[test]
	fn the_backup_and_the_export_leave_the_record_and_its_files_as_they_were() {
		let root = scratch_dir("old-talk");
		let app = test_app(&root);
		old_talk(&app);
		let before = snapshot(&app.paths.chats);
		back_up(&app.paths.data, &app.paths.chats, "0.6.7").unwrap();
		let folder = root.join("home/godspeed");
		assert!(export_talk(&app, &folder).unwrap());
		assert_eq!(snapshot(&app.paths.chats), before);

		let backup = snapshot(&app.paths.data.join("talk-backup-0.6.7"));
		assert_eq!(backup, before);
		let text = std::fs::read_to_string(folder.join(TALK_MD)).unwrap();
		assert!(text.starts_with("# Talk\n"));
		assert!(text.contains("\n**You**\n\nok nube gani on CSE29 I ratof gani on the lufotoh nig\n"), "{text}");
		assert!(text.contains("\n**Teacher**\n"));
		assert!(text.contains("\n- Bavori PS3 (Lufotoh Nig 3)\n"));
		assert!(text.contains("\n**godspeed**\n\nAsked Teacher to work out what's on Final (CSE 21) from your files.\n"), "the old space name is read too");
		assert!(!text.contains("[SESSION HISTORY COMPACTED]") && !text.contains("[Today]"));
		assert_eq!(std::fs::read(folder.join("Talk files/0123456789ab-Syllabus.pdf")).unwrap(), b"%PDF-1.4 made up");
	}

	#[test]
	fn a_second_start_changes_nothing() {
		let root = scratch_dir("old-talk-again");
		let app = test_app(&root);
		old_talk(&app);
		let folder = root.join("home/godspeed");
		back_up(&app.paths.data, &app.paths.chats, "0.6.7").unwrap();
		export_talk(&app, &folder).unwrap();
		let (data, exported) = (snapshot(&app.paths.data), snapshot(&folder));
		back_up(&app.paths.data, &app.paths.chats, "0.6.7").unwrap();
		back_up(&app.paths.data, &app.paths.chats, "0.6.8").unwrap();
		assert!(export_talk(&app, &folder).unwrap());
		assert_eq!(snapshot(&app.paths.data), data);
		assert_eq!(snapshot(&folder), exported);
	}

	#[test]
	fn a_talk_md_already_there_is_left_alone() {
		let root = scratch_dir("old-talk-mine");
		let app = test_app(&root);
		old_talk(&app);
		let folder = root.join("home/godspeed");
		fsx::write_text_atomic(&folder.join(TALK_MD), "my own notes").unwrap();
		assert!(export_talk(&app, &folder).unwrap());
		assert_eq!(std::fs::read_to_string(folder.join(TALK_MD)).unwrap(), "my own notes");
		assert!(!folder.join(TALK_FILES).exists());
	}

	#[test]
	fn an_export_cut_off_halfway_is_made_again_whole() {
		let root = scratch_dir("old-talk-cut");
		let app = test_app(&root);
		old_talk(&app);
		let folder = root.join("home/godspeed");
		fsx::write_text_atomic(&folder.join("Talk.md.partial"), "# Ta").unwrap();
		fsx::write_text_atomic(&folder.join("Talk files/0123456789ab-Syllabus.pdf.partial"), "%PD").unwrap();
		assert!(export_talk(&app, &folder).unwrap());
		assert!(std::fs::read_to_string(folder.join(TALK_MD)).unwrap().starts_with("# Talk\n\nYour Talk chat"));
		assert_eq!(std::fs::read(folder.join("Talk files/0123456789ab-Syllabus.pdf")).unwrap(), b"%PDF-1.4 made up");
		assert!(!snapshot(&folder).keys().any(|name| name.to_string_lossy().ends_with(".partial")));
	}

	#[test]
	fn without_a_talk_record_nothing_is_made() {
		let root = scratch_dir("old-talk-none");
		let app = test_app(&root);
		back_up(&app.paths.data, &app.paths.chats, "0.6.7").unwrap();
		let folder = root.join("home/godspeed");
		assert!(!export_talk(&app, &folder).unwrap());
		assert!(!app.paths.data.join("talk-backup-0.6.7").exists());
		assert!(!folder.join(TALK_MD).exists());
	}

	#[test]
	fn a_backup_left_half_made_is_made_again() {
		let root = scratch_dir("old-talk-partial");
		let app = test_app(&root);
		old_talk(&app);
		fsx::write_text_atomic(&app.paths.data.join("talk-backup-0.6.7.partial/chat_talk.json"), "cut off").unwrap();
		back_up(&app.paths.data, &app.paths.chats, "0.6.7").unwrap();
		assert!(!app.paths.data.join("talk-backup-0.6.7.partial").exists());
		assert_eq!(snapshot(&app.paths.data.join("talk-backup-0.6.7")), snapshot(&app.paths.chats));
	}
}

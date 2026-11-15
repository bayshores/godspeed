//! The Talk chat an older build kept (`data/chats/chat_talk.json` and its `chat_talk/` folder of
//! PDFs) is the learner's and is only ever read here: once backed up inside the data folder, and
//! once exported as `Talk.md` with `Talk files/` in the godspeed folder so it stays readable.

use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use gs_base::config::{Paths, VERSION};
use gs_base::{fsx, text};
use gs_core::contracts::chat::TALK_CHAT_ID;
use gs_core::messages::talk_export::{TalkExport, talk_export};
use gs_core::records::settings::DEFAULT_TEACHER_NAME;

use crate::App;

const BACKUP_PREFIX: &str = "talk-backup-";

/// The export and the folder of files beside it under its `n`th name: `Talk.md` with `Talk files`,
/// then `Talk (godspeed).md`, `Talk (godspeed) 2.md` and so on when those already hold other text.
fn export_names(n: usize) -> (String, String) {
	match n {
		0 => ("Talk.md".into(), "Talk files".into()),
		1 => ("Talk (godspeed).md".into(), "Talk files (godspeed)".into()),
		_ => (format!("Talk (godspeed) {n}.md"), format!("Talk files (godspeed) {n}")),
	}
}

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
	if partial.symlink_metadata().is_ok() {
		std::fs::remove_dir_all(&partial)?;
	}
	std::fs::create_dir(&partial)?;
	copy_synced(&record, &partial.join(format!("{TALK_CHAT_ID}.json")))?;
	let folder = chats.join(TALK_CHAT_ID);
	if let Ok(meta) = folder.symlink_metadata() {
		if !meta.is_dir() {
			return Err(io::Error::other(format!("{} is not a folder", folder.display())));
		}
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

/// Copies the files and folders under `from`; a link is never followed.
fn copy_dir(from: &Path, to: &Path) -> io::Result<()> {
	std::fs::create_dir(to)?;
	for entry in std::fs::read_dir(from)? {
		let entry = entry?;
		let target = to.join(entry.file_name());
		let kind = entry.file_type()?;
		if kind.is_dir() {
			copy_dir(&entry.path(), &target)?;
		} else if kind.is_file() {
			copy_synced(&entry.path(), &target)?;
		}
	}
	Ok(())
}

/// A copy that is on the disk before anything renames it into place.
fn copy_synced(from: &Path, to: &Path) -> io::Result<()> {
	std::fs::copy(from, to)?;
	File::open(to)?.sync_all()
}

/// Writes the export into `folder` under the first of its names that is free or already holds
/// this export; an existing file is never changed. Answers whether the chat is readable there now
/// (false: no Talk record, or nothing in it was ever shown).
pub(super) fn export_talk(app: &App, folder: &Path) -> io::Result<bool> {
	let Some(record) = app.stores.chats.get_chat(TALK_CHAT_ID) else { return Ok(false) };
	let settings = app.stores.settings.read_settings().ok().flatten();
	let teacher = settings.as_ref().and_then(|s| s["general"]["teacherName"].as_str()).filter(|n| !n.trim().is_empty()).unwrap_or(DEFAULT_TEACHER_NAME);
	for n in 0.. {
		let (name, files) = export_names(n);
		let Some(export) = talk_export(&record, teacher, &files) else { return Ok(false) };
		let file = folder.join(name);
		match std::fs::read(&file) {
			Ok(bytes) if bytes[..] == *text::utf8_bytes(&export.text) => return Ok(true),
			Ok(_) => continue,
			Err(err) if err.kind() == io::ErrorKind::NotFound && file.symlink_metadata().is_err() => {
				write_export(app, &file, &folder.join(files), &export)?;
				return Ok(true);
			}
			Err(err) => return Err(err),
		}
	}
	unreachable!("names never run out")
}

/// The pictures and PDFs first, then the text, so the text is there only once its files are.
/// Files already in `files` are left as they are.
fn write_export(app: &App, file: &Path, files: &Path, export: &TalkExport) -> io::Result<()> {
	if files.symlink_metadata().is_ok_and(|meta| !meta.is_dir()) {
		return Err(io::Error::other(format!("{} is not a folder", files.display())));
	}
	for picture in &export.pictures {
		let target = files.join(&picture.name);
		if !target.exists() {
			place(&target, |out| out.write_all(&picture.bytes))?;
		}
	}
	let pdfs = app.paths.chats.join(TALK_CHAT_ID);
	if pdfs.symlink_metadata().is_ok_and(|meta| meta.is_dir()) {
		for entry in std::fs::read_dir(&pdfs)? {
			let entry = entry?;
			let target = files.join(entry.file_name());
			if entry.file_type()?.is_file() && !target.exists() {
				place(&target, |out| io::copy(&mut File::open(entry.path())?, out).map(drop))?;
			}
		}
	}
	// An earlier build of this export wrote the text under this name first.
	let stale = partial_of(file);
	if stale.exists() {
		std::fs::remove_file(stale)?;
	}
	fsx::write_text_atomic(file, &export.text)
}

/// Writes `target` under a `.partial` name and renames it once it is on the disk, so a crash
/// never leaves half of it under the real name (and the next start makes it again).
fn place(target: &Path, write: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
	if let Some(dir) = target.parent() {
		std::fs::create_dir_all(dir)?;
	}
	let partial = partial_of(target);
	let mut out = File::create(&partial)?;
	write(&mut out)?;
	out.sync_all()?;
	std::fs::rename(&partial, target)
}

fn partial_of(file: &Path) -> PathBuf {
	file.with_file_name(format!("{}.partial", file.file_name().map(|n| n.to_string_lossy()).unwrap_or_default()))
}

#[cfg(test)]
mod tests {
	use std::collections::BTreeMap;

	use gs_json::{parse, stringify};

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};

	/// Every file under `dir` and its bytes.
	fn snapshot(dir: &Path) -> BTreeMap<PathBuf, Vec<u8>> {
		let mut files = BTreeMap::new();
		let mut stack = vec![dir.to_path_buf()];
		while let Some(at) = stack.pop() {
			for entry in std::fs::read_dir(&at).unwrap().flatten() {
				let kind = entry.file_type().unwrap();
				if kind.is_symlink() {
					files.insert(entry.path().strip_prefix(dir).unwrap().to_path_buf(), std::fs::read_link(entry.path()).unwrap().into_os_string().into_encoded_bytes());
				} else if kind.is_dir() {
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
		let text = std::fs::read_to_string(folder.join("Talk.md")).unwrap();
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
	fn a_talk_md_of_the_learners_own_is_left_alone_and_the_export_goes_beside_it() {
		let root = scratch_dir("old-talk-mine");
		let app = test_app(&root);
		old_talk(&app);
		let folder = root.join("home/godspeed");
		fsx::write_text_atomic(&folder.join("Talk.md"), "my own notes").unwrap();
		assert!(export_talk(&app, &folder).unwrap());
		assert_eq!(std::fs::read(folder.join("Talk.md")).unwrap(), b"my own notes");
		assert!(!folder.join("Talk files").exists());
		let text = std::fs::read_to_string(folder.join("Talk (godspeed).md")).unwrap();
		assert!(text.starts_with("# Talk\n") && text.contains("**You**"));
		assert_eq!(std::fs::read(folder.join("Talk files (godspeed)/0123456789ab-Syllabus.pdf")).unwrap(), b"%PDF-1.4 made up");
		let exported = snapshot(&folder);
		assert!(export_talk(&app, &folder).unwrap(), "the export under the second name counts");
		assert_eq!(snapshot(&folder), exported);
	}

	#[test]
	fn when_both_names_hold_other_text_the_next_free_number_is_taken() {
		let root = scratch_dir("old-talk-taken");
		let app = test_app(&root);
		old_talk(&app);
		let folder = root.join("home/godspeed");
		fsx::write_text_atomic(&folder.join("Talk.md"), "my own notes").unwrap();
		fsx::write_text_atomic(&folder.join("Talk (godspeed).md"), "an export under an older teacher name").unwrap();
		assert!(export_talk(&app, &folder).unwrap());
		assert_eq!(std::fs::read(folder.join("Talk.md")).unwrap(), b"my own notes");
		assert_eq!(std::fs::read(folder.join("Talk (godspeed).md")).unwrap(), b"an export under an older teacher name");
		let text = std::fs::read_to_string(folder.join("Talk (godspeed) 2.md")).unwrap();
		assert!(text.starts_with("# Talk\n") && text.contains("**You**"));
		assert_eq!(std::fs::read(folder.join("Talk files (godspeed) 2/0123456789ab-Syllabus.pdf")).unwrap(), b"%PDF-1.4 made up");
		let exported = snapshot(&folder);
		assert!(export_talk(&app, &folder).unwrap());
		assert_eq!(snapshot(&folder), exported);
	}

	#[test]
	fn a_talk_md_that_is_this_export_counts_as_done() {
		let root = scratch_dir("old-talk-same");
		let app = test_app(&root);
		old_talk(&app);
		let folder = root.join("home/godspeed");
		assert!(export_talk(&app, &folder).unwrap());
		let exported = snapshot(&folder);
		assert!(export_talk(&app, &folder).unwrap());
		assert_eq!(snapshot(&folder), exported);
		assert!(!folder.join("Talk (godspeed).md").exists());
	}

	#[cfg(unix)]
	#[test]
	fn a_folder_that_cannot_be_written_fails_and_changes_nothing() {
		use std::os::unix::fs::PermissionsExt;
		let root = scratch_dir("old-talk-locked");
		let app = test_app(&root);
		old_talk(&app);
		let before = snapshot(&app.paths.chats);
		let folder = root.join("home/godspeed");
		std::fs::create_dir_all(&folder).unwrap();
		let lock = |dir: &Path, mode| std::fs::set_permissions(dir, std::fs::Permissions::from_mode(mode)).unwrap();
		lock(&folder, 0o555);
		assert!(export_talk(&app, &folder).is_err());
		lock(&folder, 0o755);
		assert!(snapshot(&folder).is_empty());
		lock(&app.paths.data, 0o555);
		assert!(back_up(&app.paths.data, &app.paths.chats, "0.6.7").is_err());
		lock(&app.paths.data, 0o755);
		assert!(!app.paths.data.join("talk-backup-0.6.7").exists());
		assert_eq!(snapshot(&app.paths.chats), before);
	}

	#[cfg(unix)]
	#[test]
	fn links_are_never_followed() {
		let root = scratch_dir("old-talk-links");
		let app = test_app(&root);
		old_talk(&app);
		let elsewhere = root.join("elsewhere");
		fsx::write_text_atomic(&elsewhere.join("secret.txt"), "not the learner's chat").unwrap();
		let folder = root.join("home/godspeed");
		std::fs::create_dir_all(&folder).unwrap();
		std::os::unix::fs::symlink(&elsewhere, folder.join("Talk files")).unwrap();
		assert!(export_talk(&app, &folder).is_err(), "Talk files is a link");
		assert_eq!(snapshot(&elsewhere).len(), 1, "nothing written through it");
		assert!(!folder.join("Talk.md").exists());

		std::fs::rename(app.paths.chats.join("chat_talk"), root.join("pdfs")).unwrap();
		std::os::unix::fs::symlink(&elsewhere, app.paths.chats.join("chat_talk")).unwrap();
		let before = snapshot(&app.paths.chats);
		assert!(back_up(&app.paths.data, &app.paths.chats, "0.6.7").is_err(), "the chat's folder is a link");
		assert!(!app.paths.data.join("talk-backup-0.6.7").exists());
		assert_eq!(snapshot(&app.paths.chats), before);
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
		assert!(std::fs::read_to_string(folder.join("Talk.md")).unwrap().starts_with("# Talk\n\nYour Talk chat"));
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
		assert!(!folder.join("Talk.md").exists());
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

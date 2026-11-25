use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use super::attach::{ATTACH_KINDS, ATTACH_MAX, ATTACH_TOO_BIG, ATTACH_UNTYPABLE, attachable, attachment_bytes, attachment_name, send_attachment, typed_path};
use super::registry::EXIT_CHAT_GONE;
use super::screen::Trust;
use super::*;
use crate::window::{MAIN, TERMINAL};

/// What a terminal sent to the page, the server and the log.
#[derive(Default)]
struct Heard {
	/// The window label (or "all"), the channel and the payload of each push.
	pushes: Mutex<Vec<(String, String, Value)>>,
	live: Mutex<Vec<Vec<String>>>,
	/// The teacher's id in the last live message.
	teacher: Mutex<Option<String>>,
	typed: Mutex<Vec<String>>,
	log: Mutex<Vec<String>>,
	/// The next live message takes a while to send, and `sending` says when it began.
	slow: AtomicBool,
	sending: AtomicBool,
}

impl Outlet for Arc<Heard> {
	fn push(&self, to: To, channel: &str, payload: Value) {
		let to = match to {
			To::All => "all".to_owned(),
			To::Window(label) => label.to_owned(),
		};
		lock(&self.pushes).push((to, channel.to_owned(), payload));
	}

	fn live(&self, ids: Vec<String>, teacher: Option<String>) {
		if self.slow.swap(false, Ordering::SeqCst) {
			self.sending.store(true, Ordering::SeqCst);
			std::thread::sleep(Duration::from_millis(300));
		}
		lock(&self.live).push(ids);
		*lock(&self.teacher) = teacher;
	}

	fn typed(&self, id: &str) {
		lock(&self.typed).push(id.to_owned());
	}

	fn log(&self, line: &str) {
		lock(&self.log).push(line.to_owned());
	}
}

const SECRET: &str = "s3cret-word";

/// A godspeed folder whose teacher start script for Claude is `script`, a shell (or cmd) script.
fn folder(name: &str, script: &str) -> PathBuf {
	let dir = std::env::temp_dir().join(format!("gs-shell-terminal-{name}-{}", std::process::id()));
	let _ = std::fs::remove_dir_all(&dir);
	std::fs::create_dir_all(dir.join(".godspeed")).unwrap();
	write_script(&dir, Role::Teacher, script);
	dir
}

fn write_script(dir: &Path, role: Role, script: &str) {
	let helper = if role == Role::Helper { "-helper" } else { "" };
	let extension = match std::env::consts::OS {
		"macos" => "command",
		"windows" => "cmd",
		_ => "sh",
	};
	let file = dir.join(".godspeed").join(format!("start-claude{helper}.{extension}"));
	gs_base::fsx::write_text_atomic(&file, script).unwrap();
	#[cfg(unix)]
	{
		use std::os::unix::fs::PermissionsExt;
		std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
	}
}

/// A plain environment: the learner's dotfiles stay out of the test.
fn env(home: &Path) -> Vec<(OsString, OsString)> {
	let mut env: Vec<(OsString, OsString)> = vec![("HOME".into(), home.into()), ("SHELL".into(), "/bin/sh".into()), ("SECRET_TOKEN".into(), SECRET.into())];
	for key in ["PATH", "SystemRoot", "ComSpec", "PATHEXT", "TEMP", "TMP", "USERPROFILE"] {
		if let Some(value) = std::env::var_os(key) {
			env.push((key.into(), value));
		}
	}
	env
}

fn start(terminals: &Terminals, dir: &Path) -> String {
	terminals.start(Role::Teacher, Agent::Claude, dir.to_str().unwrap(), env(dir), Path::new("/data"), None).unwrap()
}

fn text(terminals: &Terminals, id: &str) -> String {
	terminals.find(id).unwrap().state().screen.text()
}

/// Waits up to 10 s for `done`.
fn until(what: &str, done: impl Fn() -> bool) {
	let deadline = Instant::now() + Duration::from_secs(10);
	while !done() {
		assert!(Instant::now() < deadline, "timed out waiting for {what}");
		std::thread::sleep(Duration::from_millis(20));
	}
}

fn ended_of(terminals: &Terminals, id: &str) -> Option<Ended> {
	terminals.find(id).unwrap().state().ended
}

#[cfg(unix)]
const ECHO: &str = "#!/bin/sh\nprintf 'ready %s\\n' \"$GODSPEED_TERMINAL\"\nread line\nprintf 'got %s\\n' \"$line\"\nsleep 1\n";
#[cfg(windows)]
const ECHO: &str = "@echo off\r\necho ready %GODSPEED_TERMINAL%\r\nset /p line=\r\necho got %line%\r\nping -n 2 127.0.0.1 >nul\r\n";

#[cfg(unix)]
#[test]
fn an_agent_that_says_the_chat_is_gone_ends_with_its_own_code() {
	let dir = folder("gone", "#!/bin/sh\nprintf 'resume %s\\n' \"$GODSPEED_RESUME\"\necho 'No conversation found with session ID: x'\nexit 1\n");
	let terminals = Terminals::new(Arc::new(Heard::default()));
	let chat = "0f8fad5b-d9cb-469f-a165-70867728950e";
	let id = terminals.start(Role::Teacher, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data"), Some(chat)).unwrap();
	until("the end", || ended_of(&terminals, &id).is_some());
	assert_eq!(ended_of(&terminals, &id), Some(Ended::Exited(EXIT_CHAT_GONE)));
	assert!(text(&terminals, &id).contains(&format!("resume {chat}")), "the script was told the chat");
}

/// A godspeed folder whose Codex teacher shows Codex's input mark, reads one line and echoes it.
#[cfg(unix)]
fn codex_folder(name: &str) -> PathBuf {
	let dir = std::env::temp_dir().join(format!("gs-shell-terminal-{name}-{}", std::process::id()));
	let _ = std::fs::remove_dir_all(&dir);
	std::fs::create_dir_all(dir.join(".godspeed")).unwrap();
	let extension = if std::env::consts::OS == "macos" { "command" } else { "sh" };
	let script = dir.join(".godspeed").join(format!("start-codex.{extension}"));
	gs_base::fsx::write_text_atomic(&script, "#!/bin/sh\nprintf '› '\nread line\nprintf 'got %s\\n' \"$line\"\nsleep 1\n").unwrap();
	std::fs::set_permissions(&script, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
	dir
}

#[cfg(unix)]
#[test]
fn a_starter_is_typed_sent_and_heard_as_the_learners_line() {
	let dir = codex_folder("starter");
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let id = terminals.start(Role::Teacher, Agent::Codex, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None).unwrap();
	until("the input", || text(&terminals, &id).contains('›'));
	assert_eq!(terminals.send(&id, "What's due?", Some(MAIN)), Err(NOT_SHOWN.to_owned()), "not shown yet");
	terminals.attach(&id, MAIN).unwrap();
	assert_eq!(terminals.send(&id, "What's due?", None), Err(NOT_SHOWN.to_owned()), "the window is not focused");
	assert_eq!(terminals.send(&id, "What's due?\nrm -rf ~", Some(MAIN)), Err(NOT_SENT.to_owned()), "a line break is never typed");
	terminals.write(&id, "half", Some(MAIN)).unwrap();
	assert_eq!(terminals.send(&id, "What's due?", Some(MAIN)), Err(NOT_SENT.to_owned()), "the learner's own text is in the box");
	until("the starter taken out again", || terminals.find(&id).unwrap().state().screen.codex_input().as_deref() == Some("half"));
	assert!(lock(&heard.typed).is_empty());
	terminals.write(&id, "\x15", Some(MAIN)).unwrap();
	terminals.send(&id, "What's due?", Some(MAIN)).unwrap();
	assert_eq!(*lock(&heard.typed), vec![id.clone()], "the learner's message");
	until("the sent line", || text(&terminals, &id).contains("got What's due?"));
	std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_starter_is_only_for_the_teachers_running_terminal() {
	let dir = folder("starter-helper", ECHO);
	write_script(&dir, Role::Helper, WAITS);
	let terminals = Terminals::new(Arc::new(Heard::default()));
	let teacher = start(&terminals, &dir);
	let helper = terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None).unwrap();
	until("ready", || text(&terminals, &helper).contains("ready"));
	terminals.attach(&helper, MAIN).unwrap();
	assert_eq!(terminals.send(&helper, "What's due?", Some(MAIN)), Err(NOT_SENT.to_owned()), "background work's terminal");
	terminals.stop(&teacher).unwrap();
	until("the end", || ended_of(&terminals, &teacher).is_some());
	terminals.attach(&teacher, MAIN).unwrap();
	assert_eq!(terminals.send(&teacher, "What's due?", Some(MAIN)), Err(NOT_THERE.to_owned()), "it ended");
	std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_start_script_draws_and_echoes_through_the_terminal() {
	let dir = folder("echo", ECHO);
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let id = start(&terminals, &dir);
	assert_eq!(id.len(), 32);
	assert!(id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
	assert_eq!(*lock(&heard.live), vec![vec![id.clone()]]);
	until("ready", || text(&terminals, &id).contains(&format!("ready {id}")));

	assert_eq!(terminals.write(&id, SECRET, Some(MAIN)), Err(NOT_SHOWN.to_owned()), "not shown yet");
	terminals.attach(&id, MAIN).unwrap();
	assert_eq!(terminals.write(&id, SECRET, None), Err(NOT_SHOWN.to_owned()), "the window is not focused");
	terminals.write(&id, "a", Some(MAIN)).unwrap();
	terminals.write(&id, SECRET, Some(MAIN)).unwrap();
	assert!(lock(&heard.typed).is_empty(), "keys without Enter send nothing yet");
	terminals.write(&id, "\r", Some(MAIN)).unwrap();
	assert_eq!(*lock(&heard.typed), vec![id.clone()], "Enter with no question on the screen is a message to the agent");
	until("the echo", || text(&terminals, &id).contains(&format!("got a{SECRET}")));
	until("the end", || ended_of(&terminals, &id) == Some(Ended::Exited(0)));
	// The server is told after the state says ended, so the two are not seen at the same moment.
	until("the server hears it ended", || lock(&heard.live).last() == Some(&Vec::new()));

	let pushes = lock(&heard.pushes);
	let (to, _, snapshot) = pushes.iter().find(|(_, channel, _)| channel == "terminal-output").unwrap();
	assert_eq!((to.as_str(), snapshot["id"].as_str()), (MAIN, Some(id.as_str())));
	let drawn = String::from_utf8(gs_base::base64::decode(snapshot["snapshot"].as_str().unwrap())).unwrap();
	assert!(drawn.contains("ready"), "the snapshot redraws the screen");
	let output: Vec<u8> = pushes.iter().filter_map(|(_, _, p)| p["data"].as_str()).flat_map(gs_base::base64::decode).collect();
	assert!(String::from_utf8_lossy(&output).contains(&format!("got a{SECRET}")), "output after the attach");
	let (to, _, last) = pushes.iter().rfind(|(_, channel, _)| channel == "terminal-state").unwrap();
	assert_eq!(to, "all", "what the terminal is doing is for every window");
	assert_eq!(last["ended"], json!({ "stopped": false, "code": 0 }));
	assert_eq!(terminals.write(&id, "x", Some(MAIN)), Err(NOT_THERE.to_owned()));
	std::fs::remove_dir_all(dir).unwrap();
}

/// Prints a line every 50 ms, so output keeps coming while windows attach and detach.
#[cfg(unix)]
const TICKS: &str = "#!/bin/sh\nwhile :; do printf 'tick\\n'; sleep 0.05; done\n";

/// The windows each `terminal-output` push so far went to, with its kind: "snapshot" or "data".
#[cfg(unix)]
fn output_to(heard: &Heard) -> Vec<(String, &'static str)> {
	let pushes = lock(&heard.pushes);
	pushes.iter().filter(|(_, channel, _)| channel == "terminal-output").map(|(to, _, p)| (to.clone(), if p["snapshot"].is_string() { "snapshot" } else { "data" })).collect()
}

#[cfg(unix)]
#[test]
fn output_goes_only_to_the_window_that_attached_last() {
	let dir = folder("two-windows", TICKS);
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let id = start(&terminals, &dir);
	until("the first line", || text(&terminals, &id).contains("tick"));

	terminals.attach(&id, MAIN).unwrap();
	assert_eq!(output_to(&heard), vec![(MAIN.to_owned(), "snapshot")], "the snapshot goes to the window that attached");
	until("output for the main window", || output_to(&heard).iter().any(|(to, kind)| to == MAIN && *kind == "data"));

	terminals.attach(&id, TERMINAL).unwrap();
	let from = output_to(&heard).len();
	assert_eq!(output_to(&heard)[from - 1], (TERMINAL.to_owned(), "snapshot"), "the second window gets the screen as it is");
	// The old window's page unmounting after the new one attached must not cut the new one off.
	terminals.detach(&id, MAIN).unwrap();
	until("output for the terminal window", || output_to(&heard)[from..].iter().any(|(_, kind)| *kind == "data"));
	assert!(output_to(&heard)[from..].iter().all(|(to, _)| to == TERMINAL), "nothing goes to the window that was replaced");

	terminals.detach(&id, TERMINAL).unwrap();
	let sent = output_to(&heard).len();
	std::thread::sleep(FRAME * 20);
	assert_eq!(output_to(&heard).len(), sent, "a detached terminal sends nothing");

	terminals.stop(&id).unwrap();
	until("the stop", || ended_of(&terminals, &id).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_window_that_is_gone_shows_nothing_and_another_window_is_left_alone() {
	let dir = folder("window-gone", WAITS);
	write_script(&dir, Role::Helper, WAITS);
	let terminals = Terminals::new(Arc::new(Heard::default()));
	let shown = start(&terminals, &dir);
	let other = terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None).unwrap();
	until("ready", || text(&terminals, &shown).contains("ready") && text(&terminals, &other).contains("ready"));
	terminals.attach(&shown, TERMINAL).unwrap();
	terminals.attach(&other, MAIN).unwrap();

	terminals.window_closed(TERMINAL);
	assert_eq!(terminals.write(&shown, "a", Some(TERMINAL)), Err(NOT_SHOWN.to_owned()), "nothing shows it now");
	terminals.write(&other, "b", Some(MAIN)).unwrap();
	terminals.attach(&shown, MAIN).unwrap();
	terminals.write(&shown, "c", Some(MAIN)).unwrap();
	terminals.stop(&shown).unwrap();
	terminals.stop(&other).unwrap();
	until("the stops", || ended_of(&terminals, &shown).is_some() && ended_of(&terminals, &other).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn only_the_window_that_shows_a_terminal_types_into_it() {
	let dir = folder("typing-window", WAITS);
	let terminals = Terminals::new(Arc::new(Heard::default()));
	let id = start(&terminals, &dir);
	until("ready", || text(&terminals, &id).contains("ready"));
	terminals.attach(&id, MAIN).unwrap();
	terminals.attach(&id, TERMINAL).unwrap();

	assert_eq!(terminals.write(&id, "a", Some(MAIN)), Err(NOT_SHOWN.to_owned()), "the window that was replaced");
	assert_eq!(terminals.paste(&id, "a", Some(MAIN)), Err(NOT_SHOWN.to_owned()));
	assert_eq!(terminals.send(&id, "a", Some(MAIN)), Err(NOT_SHOWN.to_owned()));
	assert_eq!(terminals.add_file(&id, "a.png", b"\x89PNG\r\n\x1a\n", &dir, MAIN), Err(NOT_SHOWN.to_owned()));
	assert_eq!(terminals.write(&id, "a", None), Err(NOT_SHOWN.to_owned()), "the window showing it has no focus");
	terminals.write(&id, "a", Some(TERMINAL)).unwrap();
	terminals.paste(&id, "b", Some(TERMINAL)).unwrap();

	terminals.detach(&id, MAIN).unwrap();
	terminals.write(&id, "c", Some(TERMINAL)).unwrap();
	terminals.detach(&id, TERMINAL).unwrap();
	assert_eq!(terminals.write(&id, "d", Some(TERMINAL)), Err(NOT_SHOWN.to_owned()), "nothing shows it");
	terminals.stop(&id).unwrap();
	until("the stop", || ended_of(&terminals, &id).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn a_running_terminal_takes_the_size_of_its_screen_and_an_ended_one_keeps_its_own() {
	let dir = folder("size", "#!/bin/sh\nprintf 'ready\\n'\nread line\nstty size\nsleep 1\n");
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let id = start(&terminals, &dir);
	until("ready", || text(&terminals, &id).contains("ready"));
	assert_eq!(terminals.resize(&id, 5, 500), Ok((40, 100)), "kept inside the range");
	assert_eq!(terminals.resize(&id, 50, 34), Ok((50, 34)));
	terminals.attach(&id, MAIN).unwrap();
	terminals.write(&id, "\r", Some(MAIN)).unwrap();
	until("the program's own size", || text(&terminals, &id).contains("34 50"));
	until("the end", || ended_of(&terminals, &id).is_some());
	assert_eq!(terminals.resize(&id, 80, 30), Ok((50, 34)), "an ended screen keeps its size");
	std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn attach_saves_a_picture_in_the_folder_and_types_its_path_without_enter() {
	let dir = folder("attach", ECHO);
	let terminals = Terminals::new(Arc::new(Heard::default()));
	let id = start(&terminals, &dir);
	until("ready", || text(&terminals, &id).contains("ready"));
	let png = b"\x89PNG\r\n\x1a\nmade-up picture";
	assert_eq!(terminals.add_file(&id, "week 3.png", png, &dir, MAIN), Err(NOT_SHOWN.to_owned()), "not shown yet");
	terminals.attach(&id, MAIN).unwrap();
	assert_eq!(terminals.add_file(&id, "notes.txt", b"plain words", &dir, MAIN), Err(ATTACH_KINDS.to_owned()));
	assert_eq!(terminals.add_file(&id, "big.pdf", &[b"%PDF-".as_slice(), &vec![0; ATTACH_MAX]].concat(), &dir, MAIN), Err(ATTACH_TOO_BIG.to_owned()));

	let odd = dir.join("line\nbreak");
	assert_eq!(terminals.add_file(&id, "a.png", png, &odd, MAIN), Err(ATTACH_UNTYPABLE.to_owned()), "a path with a line break is never typed");
	assert!(!odd.exists(), "nor saved");
	let spaced = dir.join("Lab folder");
	let path = terminals.add_file(&id, "../week 3.png", png, &spaced, MAIN).unwrap();
	let saved = spaced.join(".godspeed").join("attachments").join(format!("{}-week_3.png", &gs_base::hash::sha256_hex(png)[..12]));
	assert_eq!(Path::new(&path), saved, "inside the folder, the name's last part, spaces as _");
	assert_eq!(std::fs::read(&saved).unwrap(), png);
	std::thread::sleep(Duration::from_millis(300));
	assert!(!text(&terminals, &id).contains("got "), "no Enter: the line is still being typed");
	terminals.write(&id, "\r", Some(MAIN)).unwrap();
	until("the echo", || text(&terminals, &id).contains("-week_3.png"));
	let spaced_typed = if cfg!(windows) { "Lab folder" } else { "Lab\\ folder" };
	// Windows' terminal may break the long line anywhere.
	assert!(text(&terminals, &id).replace('\n', "").contains(spaced_typed), "the folder's space typed as a drag types it");
	until("the end", || ended_of(&terminals, &id).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn an_attachment_saved_after_its_screen_was_hidden_or_ended_is_not_typed_and_goes() {
	let dir = folder("attach-late", ECHO);
	let terminals = Terminals::new(Arc::new(Heard::default()));
	let id = start(&terminals, &dir);
	until("ready", || text(&terminals, &id).contains("ready"));
	let terminal = terminals.find(&id).unwrap();
	let saved = dir.join("late.png");
	gs_base::fsx::write_atomic(&saved, b"made-up", None).unwrap();
	assert_eq!(send_attachment(&terminal, &saved, true), Err(NOT_SHOWN.to_owned()));
	assert!(saved.exists(), "a copy an earlier attach made stays");
	assert_eq!(send_attachment(&terminal, &saved, false), Err(NOT_SHOWN.to_owned()), "hidden while it was saved");
	assert!(!saved.exists(), "this attach's copy goes");
	terminals.attach(&id, MAIN).unwrap();
	terminals.stop(&id).unwrap();
	gs_base::fsx::write_atomic(&saved, b"made-up", None).unwrap();
	assert_eq!(send_attachment(&terminal, &saved, false), Err(NOT_THERE.to_owned()), "stopped while it was saved");
	assert!(!saved.exists());
	until("the end", || ended_of(&terminals, &id).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn attach_knows_pictures_and_pdfs_by_their_first_bytes() {
	for file in [b"\x89PNG\r\n\x1a\n".as_slice(), b"\xff\xd8\xff\xe0", b"GIF89a", b"RIFF\0\0\0\0WEBPVP8 ", b"%PDF-1.7"] {
		assert!(attachable(file), "{file:?}");
	}
	for file in [b"".as_slice(), b"RIFF\0\0\0\0WAVE", b"<svg>", b"PK\x03\x04"] {
		assert!(!attachable(file), "{file:?}");
	}
	assert_eq!(&attachment_name("C:\\Users\\ada\\Lab $1 (final).pdf", b"x")[12..], "-Lab__1__final_.pdf");
	assert_eq!(&attachment_name("..", b"x")[12..], "-file");
	assert_eq!(&attachment_name("notes\r\nrm -rf ~.png", b"x")[12..], "-notes__rm_-rf__.png", "no line break reaches the input");
	assert_eq!(attachment_name("a.png", b"x"), attachment_name("a.png", b"x"), "the same file keeps its name");
}

#[test]
fn an_attached_path_is_typed_as_a_drag_types_it() {
	let path = "/Users/ada/God Speed/.godspeed/attachments/0123456789ab-a.png";
	if cfg!(windows) {
		assert_eq!(typed_path(path), format!("\"{path}\""));
	} else {
		assert_eq!(typed_path(path), "/Users/ada/God\\ Speed/.godspeed/attachments/0123456789ab-a.png");
		assert_eq!(typed_path("/a/$x (1)'s;b"), "/a/\\$x\\ \\(1\\)\\'s\\;b");
	}
}

#[test]
fn an_attachment_over_the_limit_is_refused_before_it_is_decoded() {
	assert_eq!(attachment_bytes(&"A".repeat(ATTACH_MAX / 3 * 4 + 8)), Err(ATTACH_TOO_BIG.to_owned()));
	assert_eq!(attachment_bytes(&gs_base::base64::encode(b"%PDF-")), Ok(b"%PDF-".to_vec()));
}

#[test]
fn nothing_from_the_screen_or_the_environment_is_logged() {
	let dir = folder("log", ECHO);
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let id = start(&terminals, &dir);
	terminals.attach(&id, MAIN).unwrap();
	until("ready", || text(&terminals, &id).contains("ready"));
	terminals.paste(&id, &format!("{SECRET}\r"), Some(MAIN)).unwrap();
	assert!(lock(&heard.typed).is_empty(), "a paste is not a message yet, even with a line break");
	until("the end", || ended_of(&terminals, &id).is_some());
	let log = lock(&heard.log).join("\n");
	assert!(log.contains("terminal started: teacher claude pid ") && log.contains(" code 0"), "{log}");
	for kept_out in [SECRET, "ready", id.as_str(), dir.to_str().unwrap()] {
		assert!(!log.contains(kept_out), "{kept_out} in {log}");
	}
	std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_second_live_terminal_for_a_role_is_refused() {
	let dir = folder("second", ECHO);
	let terminals = Terminals::new(Arc::new(Heard::default()));
	let id = start(&terminals, &dir);
	assert_eq!(terminals.start(Role::Teacher, Agent::Codex, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None), Err("The teacher is already running.".to_owned()));
	assert_eq!(terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None), Err(NOT_SET_UP.to_owned()), "the helper has no script here");
	terminals.stop(&id).unwrap();
	until("the stop", || ended_of(&terminals, &id) == Some(Ended::Stopped));
	let again = start(&terminals, &dir);
	assert_eq!(lock(&terminals.list).len(), 1, "the ended record made way");
	terminals.stop(&again).unwrap();
	until("the stop", || ended_of(&terminals, &again).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
const WAITS: &str = "#!/bin/sh\nprintf 'ready\\n'\nsleep 300\n";
#[cfg(windows)]
const WAITS: &str = "@echo off\r\necho ready\r\nping -n 300 127.0.0.1 >nul\r\n";

#[test]
fn the_helper_stops_when_the_teacher_ends_or_is_stopped() {
	let dir = folder("helper", ECHO);
	write_script(&dir, Role::Helper, WAITS);
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let start_helper = || terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None).unwrap();

	let teacher = start(&terminals, &dir);
	let helper = start_helper();
	assert_eq!(*lock(&heard.teacher), Some(teacher.clone()), "the server hears which one is the teacher's");
	until("ready", || text(&terminals, &teacher).contains("ready") && text(&terminals, &helper).contains("ready"));
	terminals.attach(&teacher, MAIN).unwrap();
	terminals.write(&teacher, "bye\r", Some(MAIN)).unwrap();
	until("the teacher's own end", || ended_of(&terminals, &teacher) == Some(Ended::Exited(0)));
	until("the helper's stop", || ended_of(&terminals, &helper) == Some(Ended::Stopped));
	assert_eq!(lock(&heard.live).last(), Some(&Vec::new()), "the server hears both ended");
	assert_eq!(*lock(&heard.teacher), None);

	let teacher = start(&terminals, &dir);
	let helper = start_helper();
	until("ready", || text(&terminals, &helper).contains("ready"));
	terminals.stop(&teacher).unwrap();
	until("the helper's stop", || ended_of(&terminals, &helper) == Some(Ended::Stopped));
	assert_eq!(lock(&heard.live).last(), Some(&Vec::new()));
	std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn only_enter_on_its_own_is_a_message_to_the_agent() {
	let dir = folder("enter", WAITS);
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let id = start(&terminals, &dir);
	terminals.attach(&id, MAIN).unwrap();
	until("ready", || text(&terminals, &id).contains("ready"));
	terminals.write(&id, "\x1b\r", Some(MAIN)).unwrap();
	assert!(lock(&heard.typed).is_empty(), "Alt or Shift with Enter adds a line");
	terminals.write(&id, "\x1b[200~two\rlines\x1b[201~", Some(MAIN)).unwrap();
	assert!(lock(&heard.typed).is_empty(), "a bracketed paste the page typed");
	terminals.paste(&id, "two\rlines", Some(MAIN)).unwrap();
	assert!(lock(&heard.typed).is_empty(), "a paste");
	terminals.write(&id, "\r", Some(MAIN)).unwrap();
	assert_eq!(*lock(&heard.typed), vec![id.clone()]);
	terminals.stop(&id).unwrap();
	// Windows keeps the folder in use until the stopped script is gone.
	until("the end", || ended_of(&terminals, &id).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn the_server_hears_the_live_terminals_in_the_order_they_changed() {
	let dir = folder("order", WAITS);
	write_script(&dir, Role::Helper, WAITS);
	let heard = Arc::new(Heard::default());
	let terminals = Arc::new(Terminals::new(heard.clone()));
	let helper = terminals.start(Role::Helper, Agent::Claude, dir.to_str().unwrap(), env(&dir), Path::new("/data"), None).unwrap();
	heard.slow.store(true, Ordering::SeqCst);
	let stopping = std::thread::spawn({
		let (terminals, helper) = (terminals.clone(), helper.clone());
		move || terminals.stop(&helper).unwrap()
	});
	until("the slow send", || heard.sending.load(Ordering::SeqCst));
	let teacher = start(&terminals, &dir);
	stopping.join().unwrap();
	assert_eq!(lock(&heard.live).last(), Some(&vec![teacher.clone()]), "the stop's message came first");
	terminals.stop(&teacher).unwrap();
	until("the stops", || ended_of(&terminals, &teacher).is_some() && ended_of(&terminals, &helper).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
const FLOOD: &str = "#!/bin/sh\nprintf 'ready\\n'\nread line\ni=0\nwhile [ $i -lt 4000 ]; do printf '%0100d\\n' $i; i=$((i+1)); done\nprintf 'done\\n'\nread line\n";
#[cfg(windows)]
const FLOOD: &str = "@echo off\r\necho ready\r\nset /p line=\r\nfor /l %%i in (1,1,4000) do echo 000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000%%i\r\necho done\r\nset /p line=\r\n";

#[test]
fn a_flood_of_output_reaches_the_page_in_a_few_pushes() {
	let dir = folder("flood", FLOOD);
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let id = start(&terminals, &dir);
	until("ready", || text(&terminals, &id).contains("ready"));
	terminals.attach(&id, MAIN).unwrap();
	let began = Instant::now();
	terminals.write(&id, "go\r", Some(MAIN)).unwrap();
	until("the end of the flood", || text(&terminals, &id).contains("done"));
	std::thread::sleep(FRAME * 4);
	let frames = began.elapsed().as_millis() / FRAME.as_millis() + 2;
	let pushes = lock(&heard.pushes);
	let output: Vec<&Value> = pushes.iter().filter(|(_, channel, _)| channel == "terminal-output").map(|(_, _, p)| p).collect();
	assert!(output.len() as u128 <= frames, "{} pushes in {frames} frames", output.len());
	assert!(output.iter().all(|p| p["data"].as_str().is_none_or(|data| data.len() <= FRAME_BYTES.div_ceil(3) * 4)), "no push holds more than a frame");
	let mut page = Screen::default();
	for push in &output {
		if let Some(snapshot) = push["snapshot"].as_str() {
			page = Screen::default();
			page.process(&gs_base::base64::decode(snapshot));
		} else {
			page.process(&gs_base::base64::decode(push["data"].as_str().unwrap()));
		}
	}
	assert_eq!(page.text(), text(&terminals, &id), "the page ends up with the shell's screen");
	drop(pushes);
	terminals.stop(&id).unwrap();
	until("the stop", || ended_of(&terminals, &id).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
const BREAKS_THE_SCREEN: &str = "#!/bin/sh\nprintf 'ready\\n'\nread line\nprintf 'gs-test-breaks-the-screen\\n'\nwhile :; do printf 'more\\n'; sleep 0.05; done\n";
#[cfg(windows)]
const BREAKS_THE_SCREEN: &str = "@echo off\r\necho ready\r\nset /p line=\r\necho gs-test-breaks-the-screen\r\n:more\r\necho more\r\nping -n 1 127.0.0.1 >nul\r\ngoto more\r\n";

#[test]
fn a_screen_that_breaks_stops_its_terminal_and_says_so() {
	let dir = folder("broken", BREAKS_THE_SCREEN);
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let id = start(&terminals, &dir);
	until("ready", || text(&terminals, &id).contains("ready"));
	terminals.attach(&id, MAIN).unwrap();
	terminals.write(&id, "go\r", Some(MAIN)).unwrap();
	until("the end", || ended_of(&terminals, &id) == Some(Ended::Broken));
	assert!(text(&terminals, &id).contains(BROKEN));
	assert_eq!(terminals.list()[0]["ended"], json!({ "stopped": false, "code": null }));
	until("the server hears it ended", || lock(&heard.live).last() == Some(&Vec::new()));
	let pushes = lock(&heard.pushes);
	let snapshot = pushes.iter().rev().find_map(|(_, _, p)| p["snapshot"].as_str()).unwrap();
	assert!(String::from_utf8(gs_base::base64::decode(snapshot)).unwrap().contains("couldn't read"));
	drop(pushes);
	std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
fn running(pid: &str) -> bool {
	// Where nothing reaps orphans (a container with no init), a killed one stays a zombie that still takes a signal.
	#[cfg(target_os = "linux")]
	if std::fs::read_to_string(format!("/proc/{pid}/stat")).is_ok_and(|stat| stat.rsplit(')').next().is_some_and(|rest| rest.trim_start().starts_with('Z'))) {
		return false;
	}
	std::process::Command::new("/bin/kill").args(["-0", pid]).stderr(std::process::Stdio::null()).status().is_ok_and(|status| status.success())
}

#[cfg(unix)]
#[test]
fn stop_ends_the_script_and_everything_it_started() {
	let dir = folder("stop", "#!/bin/sh\nsleep 300 &\necho $! > \"$0.pid\"\nprintf 'ready\\n'\nwait\n");
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let id = start(&terminals, &dir);
	until("ready", || text(&terminals, &id).contains("ready"));
	let pid_file = dir.join(".godspeed/start-claude").with_extension(if cfg!(target_os = "macos") { "command.pid" } else { "sh.pid" });
	let child = std::fs::read_to_string(pid_file).unwrap().trim().to_owned();
	assert!(running(&child));
	terminals.stop(&id).unwrap();
	assert_eq!(lock(&heard.live).last(), Some(&Vec::new()), "the server hears it at once");
	until("the stop", || ended_of(&terminals, &id) == Some(Ended::Stopped));
	until("the child's end", || !running(&child));
	assert_eq!(terminals.list()[0]["ended"], json!({ "stopped": true, "code": null }));
	std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn what_an_ended_script_left_running_is_killed_after_the_grace_and_then_never_signalled() {
	// The child ignores the hang-up, as an agent may. The script ends only once the child ignores it, or the hang-up can beat the trap.
	let dir = folder("leftover", "#!/bin/sh\n(trap '' HUP; touch \"$0.trapped\"; exec sleep 300) &\necho $! > \"$0.pid\"\nuntil [ -e \"$0.trapped\" ]; do sleep 0.05; done\nprintf 'ready\\n'\n");
	let terminals = Terminals::new(Arc::new(Heard::default()));
	let id = start(&terminals, &dir);
	until("the end", || ended_of(&terminals, &id) == Some(Ended::Exited(0)));
	let pid_file = dir.join(".godspeed/start-claude").with_extension(if cfg!(target_os = "macos") { "command.pid" } else { "sh.pid" });
	let child = std::fs::read_to_string(pid_file).unwrap().trim().to_owned();
	// The hang-up came as the script ended; a slow machine may already be near the kill, so no wait here.
	assert!(running(&child), "the hang-up alone left it");
	assert!(terminals.find(&id).unwrap().state().group.is_some(), "quit still signals it within the grace");
	until("the kill", || !running(&child));
	assert_eq!(terminals.find(&id).unwrap().state().group, None, "its pid may be reused, so quit signals it no more");
	std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn an_idle_terminal_schedules_nothing() {
	let dir = folder("idle", "#!/bin/sh\nprintf ' > 1. Yes\\n   2. No\\n'\nread line\n");
	let terminals = Terminals::new(Arc::new(Heard::default()));
	let id = start(&terminals, &dir);
	terminals.attach(&id, MAIN).unwrap();
	until("the menu", || text(&terminals, &id).contains("2. No"));
	let terminal = terminals.find(&id).unwrap();
	assert!(next_tick(&terminal.state(), Instant::now()).is_some(), "the question has yet to stay");
	until("the question shows", || terminals.list()[0]["prompt"] == "menu");
	assert_eq!(next_tick(&terminal.state(), Instant::now()), None, "nothing to send and nothing to wait for");
	terminals.stop(&id).unwrap();
	until("the stop", || ended_of(&terminals, &id).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn quit_kills_a_terminal_that_was_already_stopping() {
	let dir = folder("quit", "#!/bin/sh\ntrap '' HUP\nprintf 'ready\\n'\nwhile :; do sleep 1; done\n");
	let terminals = Terminals::new(Arc::new(Heard::default()));
	let id = start(&terminals, &dir);
	until("ready", || text(&terminals, &id).contains("ready"));
	terminals.stop(&id).unwrap();
	terminals.stop_all();
	std::thread::sleep(Duration::from_millis(300));
	assert!(ended_of(&terminals, &id).is_some(), "killed before quit returned, not by a thread the app takes along");
	std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn the_trust_button_moves_to_yes_and_sends_enter_only_while_the_shell_sees_the_question() {
	// Draws the trust question on "No", moves to "Yes" on Down, and says what Enter chose.
	let draw = |no: &str, yes: &str| format!("printf '\\033[2J\\033[H Is this a project you created or one you trust?\\r\\n\\r\\n{no} No, exit\\r\\n{yes} Yes, I trust this folder\\r\\n\\r\\n Enter to confirm \\302\\267 Esc to cancel\\r\\n'");
	let question = format!(
		"#!/bin/sh\nstty raw -echo\n{}\nkey=$(dd bs=3 count=1 2>/dev/null)\n[ \"$key\" = \"$(printf '\\033[B')\" ] && {}\nkey=$(dd bs=1 count=1 2>/dev/null)\n[ \"$key\" = \"$(printf '\\r')\" ] && printf '\\033[2J\\033[Htrusted\\r\\n'\nsleep 30\n",
		draw(" \\342\\235\\257", "  "),
		draw("  ", " \\342\\235\\257"),
	);
	let dir = folder("trust", &question);
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let id = start(&terminals, &dir);
	until("the question", || terminals.find(&id).unwrap().state().screen.trust() == Some(Trust::OnNo));
	assert!(terminals.answer(&id, Prompt::Enter).is_err(), "no Press Enter line");
	assert!(terminals.answer(&id, Prompt::Menu).is_err(), "a plain menu has no button");
	terminals.answer(&id, Prompt::Trust).unwrap();
	until("the answer", || text(&terminals, &id).contains("trusted"));
	assert!(terminals.answer(&id, Prompt::Trust).is_err(), "the question is gone");
	assert!(lock(&heard.typed).is_empty(), "godspeed's own answer is not the learner talking");
	terminals.stop(&id).unwrap();
	until("the stop", || ended_of(&terminals, &id).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

#[cfg(unix)]
#[test]
fn enter_on_a_menu_answers_it_and_is_no_message() {
	let menu = "#!/bin/sh\nprintf ' Select a model\\r\\n\\r\\n \\342\\235\\257 1. Default (recommended)\\r\\n   2. Opus\\r\\n'\nsleep 30\n";
	let dir = folder("menu", menu);
	let heard = Arc::new(Heard::default());
	let terminals = Terminals::new(heard.clone());
	let id = start(&terminals, &dir);
	terminals.attach(&id, MAIN).unwrap();
	until("the menu", || terminals.find(&id).unwrap().state().screen.seen().prompt == Some(Prompt::Menu));
	terminals.write(&id, "\r", Some(MAIN)).unwrap();
	terminals.paste(&id, "2\n", Some(MAIN)).unwrap();
	assert!(lock(&heard.typed).is_empty());
	terminals.stop(&id).unwrap();
	until("the stop", || ended_of(&terminals, &id).is_some());
	std::fs::remove_dir_all(dir).unwrap();
}

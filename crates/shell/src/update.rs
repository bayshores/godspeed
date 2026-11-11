//! App updates through Tauri's updater: a check at startup and every 24 hours (unless turned off
//! in Settings), a manual check from the menu or Settings, the download kept in memory, and the
//! install `quit.rs` runs once the server has stopped. Every status change is pushed as
//! `update` and logged.

use std::path::Path;
use std::sync::{Mutex, MutexGuard, PoisonError};

use gs_base::clock;
use serde_json::{Value, json};
use tauri::{AppHandle, Manager, State, Webview};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

use crate::commands::{AppOrigin, trusted};
use crate::log;
use crate::paths::Paths;
use crate::push::push;

const DAY_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Status {
	Idle,
	Checking,
	Downloading,
	Downloaded,
	UpToDate,
	Error,
	Disabled,
}

impl Status {
	fn as_str(self) -> &'static str {
		match self {
			Status::Idle => "idle",
			Status::Checking => "checking",
			Status::Downloading => "downloading",
			Status::Downloaded => "downloaded",
			Status::UpToDate => "up-to-date",
			Status::Error => "error",
			Status::Disabled => "disabled",
		}
	}
}

/// What the page shows. `revision` lets it drop a reply older than a push it already has.
#[derive(Clone, Debug, PartialEq)]
struct Shown {
	status: Status,
	version: Option<String>,
	percent: Option<u8>,
	revision: u64,
}

impl Shown {
	fn new(status: Status) -> Shown {
		Shown { status, version: None, percent: None, revision: 0 }
	}

	/// False when nothing changed, or when a downloaded update would be hidden: it stays on show
	/// until it installs, and only a newer download replaces it.
	fn set(&mut self, status: Status, version: Option<&str>, percent: Option<u8>) -> bool {
		if self.status == Status::Downloaded && status != Status::Downloaded {
			return false;
		}
		if self.status == status && self.version.as_deref() == version && self.percent == percent {
			return false;
		}
		*self = Shown { status, version: version.map(str::to_owned), percent, revision: self.revision + 1 };
		true
	}

	fn json(&self) -> Value {
		json!({ "status": self.status.as_str(), "version": self.version, "percent": self.percent, "revision": self.revision })
	}
}

/// The shown state and whether a check runs, which one lock keeps together.
struct Core {
	shown: Shown,
	busy: bool,
}

impl Core {
	/// One check at a time, and none without an updater.
	fn begin(&mut self) -> bool {
		if self.busy || self.shown.status == Status::Disabled {
			return false;
		}
		self.busy = true;
		true
	}
}

struct Held {
	update: Update,
	bytes: Vec<u8>,
}

pub struct Updates {
	core: Mutex<Core>,
	held: Mutex<Option<Held>>,
}

impl Updates {
	fn core(&self) -> MutexGuard<'_, Core> {
		self.core.lock().unwrap_or_else(PoisonError::into_inner)
	}

	fn held(&self) -> MutexGuard<'_, Option<Held>> {
		self.held.lock().unwrap_or_else(PoisonError::into_inner)
	}
}

/// Manages the state and, when this build can update, starts the startup and daily checks.
pub fn start(app: &AppHandle) {
	let status = match updater(app) {
		Ok(_) => Status::Idle,
		Err(why) => {
			log::line(&format!("updater: disabled ({why})"));
			Status::Disabled
		}
	};
	app.manage(Updates { core: Mutex::new(Core { shown: Shown::new(status), busy: false }), held: Mutex::new(None) });
	if status == Status::Disabled {
		return;
	}
	let app = app.clone();
	tauri::async_runtime::spawn(async move {
		let mut due = clock::now_ms();
		loop {
			check(&app, false).await;
			due += DAY_MS;
			clock::sleep_until(due).await;
		}
	});
}

fn updater(app: &AppHandle) -> Result<Updater, String> {
	if cfg!(debug_assertions) {
		return Err("debug build".to_owned());
	}
	let pubkey = app.config().plugins.0.get("updater").and_then(|updater| updater.get("pubkey")).and_then(Value::as_str);
	if pubkey.is_none_or(str::is_empty) {
		return Err("no update signing key in this build".to_owned());
	}
	app.updater().map_err(|err| err.to_string())
}

/// A check the learner asked for (menu, Settings): it runs even with automatic updates off.
pub fn manual_check(app: &AppHandle) {
	if app.try_state::<Updates>().is_none() {
		return;
	}
	let app = app.clone();
	tauri::async_runtime::spawn(async move { check(&app, true).await });
}

async fn check(app: &AppHandle, manual: bool) {
	let updates = app.state::<Updates>();
	if !updates.core().begin() {
		return;
	}
	// Read fresh each time, so a change in Settings counts from the next check.
	if manual || automatic_allowed(&app.state::<Paths>().data.join("settings.json")) {
		check_and_download(app).await;
	} else {
		log::line("auto-update: automatic check skipped (turned off in Settings)");
	}
	updates.core().busy = false;
}

/// Only an explicit `general.autoUpdate: false` turns automatic checks off; a missing or
/// unreadable file leaves them on.
fn automatic_allowed(settings: &Path) -> bool {
	let saved = std::fs::read_to_string(settings).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok());
	saved.and_then(|saved| saved.pointer("/general/autoUpdate").cloned()) != Some(Value::Bool(false))
}

async fn check_and_download(app: &AppHandle) {
	report(app, Status::Checking, None, None);
	let found = match updater(app) {
		Ok(updater) => updater.check().await.map_err(|err| err.to_string()),
		Err(err) => Err(err),
	};
	let update = match found {
		Ok(Some(update)) => update,
		Ok(None) => return report(app, Status::UpToDate, None, None),
		Err(err) => return failed(app, &err),
	};
	let updates = app.state::<Updates>();
	if updates.held().as_ref().is_some_and(|held| held.update.version == update.version) {
		return;
	}
	let version = update.version.clone();
	report(app, Status::Downloading, Some(&version), Some(0));
	let mut received = 0u64;
	let on_chunk = |chunk: usize, total: Option<u64>| {
		received += chunk as u64;
		if let Some(percent) = percent(received, total) {
			report(app, Status::Downloading, Some(&version), Some(percent));
		}
	};
	match update.download(on_chunk, || {}).await {
		Ok(bytes) => {
			*updates.held() = Some(Held { update, bytes });
			report(app, Status::Downloaded, Some(&version), None);
		}
		Err(err) => failed(app, &err.to_string()),
	}
}

/// Whole percent received, when the size is known.
fn percent(received: u64, total: Option<u64>) -> Option<u8> {
	let total = total.filter(|total| *total > 0)?;
	Some(u8::try_from(received.saturating_mul(100) / total).unwrap_or(100).min(100))
}

/// The page gets a generic error; the reason goes to the log only.
fn failed(app: &AppHandle, err: &str) {
	log::line(&format!("updater error: {err}"));
	report(app, Status::Error, None, None);
}

fn report(app: &AppHandle, status: Status, version: Option<&str>, percent: Option<u8>) {
	let updates = app.state::<Updates>();
	let mut core = updates.core();
	let before = (core.shown.status, core.shown.version.clone());
	if !core.shown.set(status, version, percent) {
		return;
	}
	let payload = core.shown.json();
	drop(core);
	// Progress alone is pushed, not logged.
	if before != (status, version.map(str::to_owned)) {
		log::line(&format!("updater: {}{}", status.as_str(), version.map(|v| format!(" {v}")).unwrap_or_default()));
	}
	push(app, "update", &payload);
}

/// Installs a downloaded update once the server has stopped. `restart_requested` (Restart now)
/// has the Windows installer relaunch the app; on the Mac, Tauri relaunches the new bundle after
/// the exit. A failed install is logged and the app still quits.
pub fn install_held(app: &AppHandle, restart_requested: bool) {
	let Some(updates) = app.try_state::<Updates>() else { return };
	let Some(Held { update, bytes }) = updates.held().take() else { return };
	log::line(&format!("updater: installing {}", update.version));
	if let Err(err) = update.restart_after_install(restart_requested).install(&bytes) {
		log::line(&format!("updater error: {err}"));
	}
}

#[tauri::command]
pub fn update_state(webview: Webview, origin: State<AppOrigin>, updates: State<Updates>) -> Result<Value, String> {
	trusted(&webview, &origin)?;
	Ok(updates.core().shown.json())
}

/// Starts a manual check; its progress arrives as `update` pushes.
#[tauri::command]
pub fn update_check(webview: Webview, origin: State<AppOrigin>) -> Result<(), String> {
	trusted(&webview, &origin)?;
	manual_check(webview.app_handle());
	Ok(())
}

/// Restart now: the exit it requests stops the server, then `install_held` installs (the
/// restart exit code marks it as a restart in `RunEvent::ExitRequested`).
#[tauri::command]
pub fn update_install(webview: Webview, origin: State<AppOrigin>, updates: State<Updates>) -> Result<(), String> {
	trusted(&webview, &origin)?;
	if updates.held().is_some() {
		webview.app_handle().request_restart();
	}
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	fn settings(dir: &Path, text: &str) -> std::path::PathBuf {
		let file = dir.join("settings.json");
		gs_base::fsx::write_text_atomic(&file, text).unwrap();
		file
	}

	fn temp(name: &str) -> std::path::PathBuf {
		let dir = std::env::temp_dir().join(format!("gs-shell-update-{name}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&dir);
		std::fs::create_dir_all(&dir).unwrap();
		dir
	}

	#[test]
	fn an_explicit_off_skips_automatic_checks() {
		let dir = temp("off");
		assert!(!automatic_allowed(&settings(&dir, r#"{"general":{"autoUpdate":false}}"#)));
	}

	#[test]
	fn anything_but_an_explicit_off_keeps_automatic_checks_on() {
		let dir = temp("on");
		for text in [r#"{"general":{"autoUpdate":true}}"#, r#"{"general":{}}"#, r#"{"version":1}"#, "null", r#"{"general":{"autoUpdate":"false"}}"#, "{nope"] {
			assert!(automatic_allowed(&settings(&dir, text)), "{text}");
		}
		assert!(automatic_allowed(&dir.join("missing.json")));
		// A folder where the file should be cannot be read.
		assert!(automatic_allowed(&dir));
	}

	#[test]
	fn the_setting_is_read_again_on_each_check() {
		let dir = temp("fresh");
		let file = settings(&dir, r#"{"general":{"autoUpdate":false}}"#);
		assert!(!automatic_allowed(&file));
		settings(&dir, r#"{"general":{"autoUpdate":true}}"#);
		assert!(automatic_allowed(&file));
		settings(&dir, r#"{"general":{"autoUpdate":false}}"#);
		assert!(!automatic_allowed(&file));
	}

	#[test]
	fn a_build_without_an_updater_never_checks() {
		let mut core = Core { shown: Shown::new(Status::Disabled), busy: false };
		assert!(!core.begin());
		assert!(!core.begin());
		assert_eq!(core.shown.json(), json!({ "status": "disabled", "version": null, "percent": null, "revision": 0 }));
	}

	#[test]
	fn one_check_runs_at_a_time_and_no_shown_status_blocks_the_next() {
		for status in [Status::Idle, Status::Checking, Status::Downloading, Status::UpToDate, Status::Error, Status::Downloaded] {
			let mut core = Core { shown: Shown::new(status), busy: false };
			assert!(core.begin(), "{status:?}");
			assert!(!core.begin(), "{status:?}");
			core.busy = false;
			assert!(core.begin(), "{status:?}");
		}
	}

	#[test]
	fn the_start_state_is_idle() {
		assert_eq!(Shown::new(Status::Idle).json(), json!({ "status": "idle", "version": null, "percent": null, "revision": 0 }));
	}

	#[test]
	fn a_download_pushes_once_per_whole_percent() {
		let mut shown = Shown::new(Status::Idle);
		assert!(shown.set(Status::Checking, None, None));
		assert!(shown.set(Status::Downloading, Some("0.3.8"), Some(0)));
		assert_eq!((shown.percent, shown.version.as_deref()), (Some(0), Some("0.3.8")));
		assert!(shown.set(Status::Downloading, Some("0.3.8"), percent(412, Some(1000))));
		assert!(!shown.set(Status::Downloading, Some("0.3.8"), percent(419, Some(1000))));
		assert_eq!(shown.percent, Some(41));
		assert_eq!(shown.revision, 3);
	}

	#[test]
	fn percent_needs_a_known_size_and_stops_at_100() {
		assert_eq!(percent(10, None), None);
		assert_eq!(percent(10, Some(0)), None);
		assert_eq!(percent(999, Some(1000)), Some(99));
		assert_eq!(percent(1000, Some(1000)), Some(100));
		assert_eq!(percent(5000, Some(1000)), Some(100));
	}

	#[test]
	fn a_downloaded_update_stays_on_show_until_a_newer_one_replaces_it() {
		let mut shown = Shown::new(Status::Idle);
		shown.set(Status::Downloading, Some("0.3.8"), Some(0));
		assert!(shown.set(Status::Downloaded, Some("0.3.8"), None));
		let ready = shown.clone();
		for status in [Status::Checking, Status::Downloading, Status::UpToDate, Status::Error, Status::Idle] {
			assert!(!shown.set(status, Some("0.3.9"), Some(5)), "{status:?}");
		}
		assert_eq!(shown, ready);
		assert!(shown.set(Status::Downloaded, Some("0.3.9"), None));
		assert_eq!(shown.version.as_deref(), Some("0.3.9"));
		assert!(shown.revision > ready.revision);
	}

	#[test]
	fn a_failed_check_shows_a_generic_error_and_the_next_check_still_reports() {
		let mut shown = Shown::new(Status::Idle);
		shown.set(Status::Checking, None, None);
		assert!(shown.set(Status::Error, None, None));
		assert_eq!(shown.json(), json!({ "status": "error", "version": null, "percent": null, "revision": 2 }));
		assert!(shown.set(Status::Checking, None, None));
		assert!(shown.set(Status::UpToDate, None, None));
		assert_eq!(shown.status.as_str(), "up-to-date");
	}
}

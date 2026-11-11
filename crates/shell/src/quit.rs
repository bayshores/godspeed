//! The one way out. Every exit (the Quit item, the Dock, logout, the last window, the stopped
//! dialog, a restart) reaches `RunEvent::Exit`, which runs this and waits for it: stop the
//! server, then install a held update while nothing runs from the bundle.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Manager};

use crate::paths::Paths;
use crate::server::Server;
use crate::{old_app, update};

static DONE: AtomicBool = AtomicBool::new(false);
static RESTARTING: AtomicBool = AtomicBool::new(false);

/// The coming exit relaunches the app (`request_restart`).
pub fn restarting() {
	RESTARTING.store(true, Ordering::SeqCst);
}

pub fn run(app: &AppHandle) {
	if !first(&DONE) {
		return;
	}
	if let Some(server) = app.try_state::<Server>() {
		server.stop();
	}
	update::install_held(app, RESTARTING.load(Ordering::SeqCst));
	// Managed only once the old-app check let this launch go on.
	if let Some(paths) = app.try_state::<Paths>() {
		old_app::remove_pid(&paths.user_data);
		let _ = std::fs::remove_dir_all(&paths.demo_data);
	}
}

/// True the first time only.
fn first(flag: &AtomicBool) -> bool {
	!flag.swap(true, Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn a_second_call_does_nothing() {
		let flag = AtomicBool::new(false);
		assert!(first(&flag));
		assert!(!first(&flag));
		assert!(!first(&flag));
	}
}

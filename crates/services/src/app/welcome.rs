//! The welcome screen shows on the first page load of each launch. The desktop app starts a fresh
//! server every launch, so "first load since this server started" is "first load since the app
//! opened". A server the app restarted after a crash opens with a short notice instead, so the
//! reload doesn't look like a fresh launch.

use std::sync::atomic::Ordering;

use crate::App;

/// What the first page load of this server process opens with, then None.
pub fn first_load_screen(app: &App) -> Option<&'static str> {
	if app.misc.first_load_done.swap(true, Ordering::SeqCst) {
		return None;
	}
	Some(if std::env::var("LH_SERVER_RESTARTED").is_ok_and(|v| v == "1") { "restarted" } else { "welcome" })
}

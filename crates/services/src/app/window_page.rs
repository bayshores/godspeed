//! The page the window shows, as it last said: open_page compares with it, and leaving a lesson
//! queues the lesson's vault pass.

use std::sync::Arc;

use crate::App;

/// The page the window shows and its space (None: no space).
#[derive(Clone, Debug, PartialEq)]
pub struct WindowPage {
	pub path: String,
	pub space_id: Option<String>,
}

/// The window shows `page` now; None once the window is gone.
pub fn set_window_page(app: &Arc<App>, page: Option<WindowPage>) {
	let now = page.as_ref().map(|p| p.path.clone());
	let was = std::mem::replace(&mut *app.misc.window_page.lock(), page).map(|p| p.path);
	crate::vault::lesson_left(app, was.as_deref(), now.as_deref());
}

/// The page the window shows; None while it says nothing (closed).
pub fn window_page(app: &App) -> Option<WindowPage> {
	app.misc.window_page.lock().clone()
}

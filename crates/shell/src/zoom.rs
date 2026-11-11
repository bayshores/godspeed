//! ⌘± and ⌘0 as an owned ladder: every change is applied here and pushed as `zoom`, so the page
//! always knows the factor (its traffic-light gutter divides by it).

use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager, State, Webview};

use crate::commands::{AppOrigin, trusted};
use crate::push::push;

const LADDER: [f64; 8] = [0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];

/// The main window's factor.
pub struct Zoom(Mutex<f64>);

impl Default for Zoom {
	fn default() -> Zoom {
		Zoom(Mutex::new(1.0))
	}
}

fn current(app: &AppHandle) -> f64 {
	*app.state::<Zoom>().0.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// The next rung up (`dir` > 0) or down from `from`; the ends stay put.
fn next(from: f64, dir: i32) -> f64 {
	if dir > 0 {
		LADDER.into_iter().find(|f| *f > from + 0.001).unwrap_or(LADDER[LADDER.len() - 1])
	} else {
		LADDER.into_iter().rev().find(|f| *f < from - 0.001).unwrap_or(LADDER[0])
	}
}

pub fn apply(app: &AppHandle, factor: f64) {
	let Some(main) = app.get_webview_window("main") else { return };
	if main.set_zoom(factor).is_ok() {
		*app.state::<Zoom>().0.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = factor;
		push_current(app);
	}
}

pub fn step(app: &AppHandle, dir: i32) {
	apply(app, next(current(app), dir));
}

/// After every page load too, so a reloaded page never holds a stale factor.
pub fn push_current(app: &AppHandle) {
	push(app, "zoom", &Value::from(current(app)));
}

#[tauri::command]
pub fn get_zoom(webview: Webview, origin: State<AppOrigin>) -> Result<f64, String> {
	trusted(&webview, &origin)?;
	Ok(current(webview.app_handle()))
}

/// The page restores its saved factor at load; only ladder values are taken.
#[tauri::command]
pub fn set_zoom(webview: Webview, origin: State<AppOrigin>, factor: f64) -> Result<(), String> {
	trusted(&webview, &origin)?;
	if LADDER.contains(&factor) {
		apply(webview.app_handle(), factor);
	}
	Ok(())
}

/// The keys the menu does not claim (⌘= with another layout, ⌘+).
#[tauri::command]
pub fn zoom_step(webview: Webview, origin: State<AppOrigin>, dir: i32) -> Result<(), String> {
	trusted(&webview, &origin)?;
	step(webview.app_handle(), dir);
	Ok(())
}

#[tauri::command]
pub fn zoom_reset(webview: Webview, origin: State<AppOrigin>) -> Result<(), String> {
	trusted(&webview, &origin)?;
	apply(webview.app_handle(), 1.0);
	Ok(())
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn steps_along_the_ladder_and_stops_at_the_ends() {
		assert_eq!(next(1.0, 1), 1.1);
		assert_eq!(next(1.0, -1), 0.9);
		assert_eq!(next(2.0, 1), 2.0);
		assert_eq!(next(0.75, -1), 0.75);
		assert_eq!(next(1.3, 1), 1.5);
		assert_eq!(next(1.3, -1), 1.25);
	}
}

//! The chat window: the teacher panel's chat popped out of the main window, so it stays in sight
//! beside it. The shell owns whether it exists and tells the main page (`chat-window` `{ open }`)
//! when it is made, when it is gone and after every main page load, and `{ open: false, back:
//! true }` when a page asked to put the chat back, so the main page shows it.
//! It is made only when the main page asks, never at launch, and its place and size are not
//! remembered. On the Mac its page draws the title bar, as the main window's does.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde_json::json;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, PhysicalSize, State, Url, Webview, WebviewUrl, WebviewWindow};

use crate::commands::{AppOrigin, trusted, trusted_any};
use crate::push::push_to;
use crate::window::{CHAT, MAIN};
use crate::{log, window, zoom};

/// The window's size in logical points, before it is cut to main's height and the screen.
const SIZE: (f64, f64) = (720.0, 900.0);
const MIN_SIZE: (f64, f64) = (400.0, 300.0);
/// The longest title, so a long name never fills the title bar.
const TITLE_MAX: usize = 60;
/// Where the traffic lights sit: their centers on y 26, the middle of the page's head row (tao
/// puts the first circle's left edge at x and its center at y - 2).
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS: tauri::LogicalPosition<f64> = tauri::LogicalPosition { x: 16.0, y: 28.0 };

/// A rectangle in logical points.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Rect {
	x: f64,
	y: f64,
	width: f64,
	height: f64,
}

/// Where the window's frame goes: its left edge on main's right edge and its top on main's top,
/// as tall as main at most. With no room at the right of main on the screen, it moves left
/// until it fits and covers main's right part. It never leaves the screen.
fn placement(main: Rect, screen: Rect) -> Rect {
	let width = SIZE.0.min(screen.width);
	let height = SIZE.1.min(main.height).min(screen.height);
	let x = (main.x + main.width).min(screen.x + screen.width - width).max(screen.x);
	let y = main.y.min(screen.y + screen.height - height).max(screen.y);
	Rect { x, y, width, height }
}

/// The teacher's name as the title: no control characters, cut to `TITLE_MAX`, and the app's own
/// name when nothing is left.
fn window_title(name: &str) -> String {
	let name: String = name.chars().filter(|c| !c.is_control()).take(TITLE_MAX).collect();
	let name = name.trim();
	if name.is_empty() { "godspeed".to_owned() } else { name.to_owned() }
}

/// Main's frame, and the screen it is on without the menu bar, Dock or taskbar. Main's frame
/// stands for the screen when the system names none.
fn main_and_screen(main: &WebviewWindow) -> tauri::Result<(Rect, Rect)> {
	let scale = main.scale_factor()?;
	let logical = |x: i32, y: i32, width: u32, height: u32| Rect { x: f64::from(x) / scale, y: f64::from(y) / scale, width: f64::from(width) / scale, height: f64::from(height) / scale };
	let (position, size) = (main.outer_position()?, main.outer_size()?);
	let frame = logical(position.x, position.y, size.width, size.height);
	let screen = main.current_monitor()?.map(|monitor| {
		let area = monitor.work_area();
		logical(area.position.x, area.position.y, area.size.width, area.size.height)
	});
	Ok((frame, screen.unwrap_or(frame)))
}

/// The builder sizes what is inside the frame, so the title bar's height comes off afterwards.
fn fit_frame_height(window: &WebviewWindow, frame_height: f64) -> tauri::Result<()> {
	let (outer, inner) = (window.outer_size()?, window.inner_size()?);
	let title_bar = outer.height.saturating_sub(inner.height);
	if title_bar > 0 {
		let height = ((frame_height * window.scale_factor()?).round() as u32).saturating_sub(title_bar);
		window.set_size(PhysicalSize::new(inner.width, height))?;
	}
	Ok(())
}

fn create(app: &AppHandle, name: &str) -> Result<(), String> {
	let main = app.get_webview_window(MAIN).ok_or("There is no main window.")?;
	let (frame, screen) = main_and_screen(&main).map_err(|err| err.to_string())?;
	let place = placement(frame, screen);
	let origin = app.state::<AppOrigin>().0.clone();
	let url: Url = format!("{origin}/chat-window").parse().map_err(|_| "Bad app address.".to_owned())?;
	let show_armed = Arc::new(AtomicBool::new(true));
	let builder = window::base_builder(app, CHAT, WebviewUrl::External(url))
		.title(window_title(name))
		.inner_size(place.width, place.height)
		.min_inner_size(MIN_SIZE.0, MIN_SIZE.1)
		.position(place.x, place.y)
		.on_page_load(move |window, payload| {
			if !matches!(payload.event(), PageLoadEvent::Finished) || payload.url().origin().ascii_serialization() != origin {
				return;
			}
			zoom::push_current(window.app_handle());
			if show_armed.swap(false, Ordering::SeqCst)
				&& let Err(err) = window::show(&window).and_then(|()| window::focus(&window))
			{
				log::line(&format!("cannot show the chat window: {err}"));
			}
		});
	#[cfg(target_os = "macos")]
	let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true).traffic_light_position(TRAFFIC_LIGHTS);
	let chat = builder.build().map_err(|err| err.to_string())?;
	// The window exists now, so a step that fails is logged and the window goes on.
	let finished = fit_frame_height(&chat, place.height).and_then(|()| chat.set_zoom(zoom::current(app)));
	#[cfg(not(target_os = "macos"))]
	let finished = finished.and_then(|()| chat.hide_menu());
	if let Err(err) = finished {
		log::line(&format!("cannot set up the chat window: {err}"));
	}
	// A page that never finishes loading still gets its window.
	window::show_later(chat);
	push_open(app, true);
	Ok(())
}

/// The window in front: made if there is none, else brought forward.
fn open(app: &AppHandle, name: &str) -> Result<(), String> {
	if app.get_webview_window(CHAT).is_some() {
		return bring_forward(app);
	}
	create(app, name)
}

fn bring_forward(app: &AppHandle) -> Result<(), String> {
	let window = app.get_webview_window(CHAT).ok_or("There is no chat window.")?;
	window.unminimize().and_then(|()| window::show(&window)).and_then(|()| window::focus(&window)).map_err(|err| err.to_string())
}

/// Closes the window if there is one. Its page need not go first: the shell tells the main page.
pub fn close(app: &AppHandle) {
	if let Some(window) = app.get_webview_window(CHAT)
		&& let Err(err) = window.destroy()
	{
		log::line(&format!("cannot close the chat window: {err}"));
	}
}

/// The window is gone, however it went: the main page learns that it may show the chat.
pub fn closed(app: &AppHandle) {
	push_open(app, false);
}

fn push_open(app: &AppHandle, open: bool) {
	push_to(app, MAIN, "chat-window", &json!({ "open": open }));
}

/// Tells the main page whether the window is open, after it loaded.
pub fn push_current(app: &AppHandle) {
	push_open(app, app.get_webview_window(CHAT).is_some());
}

/// Pops the chat out: the window is made beside the main window, or brought forward when it is
/// already there. `title` is the teacher's name. Main window only.
#[tauri::command(async)]
pub fn chat_window_open(webview: Webview, origin: State<AppOrigin>, title: String) -> Result<(), String> {
	trusted(&webview, &origin)?;
	open(webview.app_handle(), &title)
}

/// Puts the chat back: the window closes, and the main page is asked to show the chat, which the
/// window's own close button does not ask. Closing a window that is not there closes nothing.
#[tauri::command(async)]
pub fn chat_window_close(webview: Webview, origin: State<AppOrigin>) -> Result<(), String> {
	trusted_any(&webview, &origin)?;
	let app = webview.app_handle();
	close(app);
	push_to(app, MAIN, "chat-window", &json!({ "open": false, "back": true }));
	Ok(())
}

/// Brings the window to the front, out of the Dock if it was minimized.
#[tauri::command(async)]
pub fn chat_window_focus(webview: Webview, origin: State<AppOrigin>) -> Result<(), String> {
	trusted_any(&webview, &origin)?;
	bring_forward(webview.app_handle())
}

#[cfg(test)]
mod tests {
	use super::*;

	const SCREEN: Rect = Rect { x: 0.0, y: 25.0, width: 2000.0, height: 1000.0 };

	fn main_at(x: f64, y: f64, width: f64, height: f64) -> Rect {
		Rect { x, y, width, height }
	}

	#[test]
	fn the_window_stands_at_the_right_of_main_with_its_top() {
		let place = placement(main_at(100.0, 80.0, 1000.0, 700.0), SCREEN);
		assert_eq!(place, Rect { x: 1100.0, y: 80.0, width: 720.0, height: 700.0 });
	}

	#[test]
	fn the_window_is_never_taller_than_main_or_than_its_default() {
		assert_eq!(placement(main_at(0.0, 25.0, 1000.0, 600.0), SCREEN).height, 600.0);
		assert_eq!(placement(main_at(0.0, 25.0, 1000.0, 1000.0), SCREEN).height, 900.0);
	}

	#[test]
	fn with_no_room_at_the_right_the_window_covers_main_s_right_part() {
		let place = placement(main_at(500.0, 80.0, 1440.0, 900.0), SCREEN);
		assert_eq!(place.x, 1280.0, "its right edge is the screen's");
		assert!(place.x < 500.0 + 1440.0, "so it overlaps main");
	}

	#[test]
	fn the_window_stays_on_the_screen_main_is_on() {
		let second = Rect { x: -1920.0, y: 0.0, width: 1920.0, height: 1080.0 };
		let place = placement(main_at(-1900.0, 200.0, 1440.0, 900.0), second);
		assert_eq!((place.x, place.y), (-720.0, 180.0), "right edge on the screen, bottom edge on the screen");
		// Main hanging off the screen at the top and left.
		let place = placement(main_at(-300.0, -50.0, 1440.0, 900.0), SCREEN);
		assert_eq!((place.x, place.y), (1140.0, 25.0));
		// A screen smaller than the window.
		let small = Rect { x: 0.0, y: 0.0, width: 600.0, height: 500.0 };
		assert_eq!(placement(main_at(0.0, 0.0, 600.0, 500.0), small), Rect { x: 0.0, y: 0.0, width: 600.0, height: 500.0 });
	}

	#[test]
	fn the_title_is_the_name_cut_short() {
		assert_eq!(window_title("Teacher"), "Teacher");
		assert_eq!(window_title("  Ada\n\tLovelace \u{7} "), "AdaLovelace");
		assert_eq!(window_title(&"é".repeat(100)).chars().count(), TITLE_MAX);
		assert_eq!(window_title(" \n "), "godspeed");
		assert_eq!(window_title(""), "godspeed");
	}
}

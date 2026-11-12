//! The demo runner on Windows and Linux. Each run gets a hidden top-level window labeled `demo`,
//! made for the run and closed after it, with no way into the app: a browser profile of its own
//! (no app cookie or storage), a page origin that is not the app's (so a request to the app is
//! cross-site), every loopback address blocked, and no navigation away, new window or download.
//! Tauri injects its bridge here too, but no capability names this window, so every command is
//! refused. A run waits on a thread of its own; the window lives on the main thread.
//!
//! The page comes from the `demo` scheme on Windows. On Linux, Tauri registers a scheme once
//! per profile folder while each incognito view gets a fresh WebKit context, so a second run
//! would find no scheme; the page is loaded as HTML with the Mac's origin instead.

use std::path::Path;
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

use gs_shell_rpc::DemoResult;
use tauri::webview::{NewWindowResponse, PageLoadEvent, PlatformWebview};
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::demo::{self, ANSWER_LIMIT, DEMO_SIZE, DemoDone, DemoJob, LOAD_LIMIT, LOAD_TIMED_OUT, NO_ANSWER, NO_SNAPSHOT, READ, RECORDER, SETTLE, SvgDone, SvgJob};
use crate::paths::{DEMO_FOLDER_PREFIX, Paths};

pub const LABEL: &str = "demo";

/// Where the demo's page lives: Tauri's address for the `demo` scheme on Windows.
#[cfg(windows)]
pub const PAGE_URL: &str = "http://demo.localhost/";
#[cfg(target_os = "linux")]
pub const PAGE_URL: &str = demo::ORIGIN;

/// How often a run asks the page whether it has answered.
const POLL: Duration = Duration::from_millis(50);

/// The page of the run in progress, which the `demo` scheme serves to the demo window only.
#[cfg(windows)]
static PAGE: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// The `demo` scheme (registered once on the builder).
#[cfg(windows)]
pub fn serve<R: tauri::Runtime>(ctx: tauri::UriSchemeContext<'_, R>, request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
	use tauri::http::{Response, StatusCode, header};
	if ctx.webview_label() != LABEL || request.uri().path() != "/" {
		return Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap_or_default();
	}
	let page = PAGE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
	Response::builder().header(header::CONTENT_TYPE, "text/html; charset=utf-8").body(page.into_bytes()).unwrap_or_default()
}

/// Deletes the demo folders earlier launches left behind (a crash skips quit.rs). Single
/// instance means none is in use.
pub fn sweep(own: &Path) {
	let Some(entries) = own.parent().and_then(|temp| std::fs::read_dir(temp).ok()) else { return };
	for entry in entries.flatten() {
		if entry.file_name().to_string_lossy().starts_with(DEMO_FOLDER_PREFIX) {
			let _ = std::fs::remove_dir_all(entry.path());
		}
	}
}

pub fn run(app: &AppHandle, job: DemoJob, done: DemoDone) {
	let app = app.clone();
	std::thread::spawn(move || done(check(&app, &job)));
}

pub fn svg(app: &AppHandle, job: SvgJob, done: SvgDone) {
	let app = app.clone();
	std::thread::spawn(move || done(snapshot(&app, &job)));
}

fn check(app: &AppHandle, job: &DemoJob) -> Result<DemoResult, String> {
	let view = View::open(app, &job.html, DEMO_SIZE)?;
	let mut errors = Vec::new();
	// The probe runs only on a page that loaded.
	let probe = match view.loaded() {
		Ok(()) => {
			std::thread::sleep(SETTLE);
			job.probe.as_deref()
		}
		Err(err) => {
			errors.push(err);
			None
		}
	};
	let answer = view.read(probe);
	if answer.is_none() {
		errors.push(NO_ANSWER.to_owned());
	}
	Ok(demo::result(answer.as_deref(), errors))
}

fn snapshot(app: &AppHandle, job: &SvgJob) -> Result<Vec<u8>, String> {
	let view = View::open(app, &demo::svg_page(&job.svg), (job.width, job.height))?;
	view.loaded()?;
	let (tx, rx) = mpsc::channel();
	let (width, height) = (job.width, job.height);
	let done: SvgDone = Box::new(move |png| {
		let _ = tx.send(png);
	});
	view.window.with_webview(move |webview| native_snapshot(&webview, width, height, done)).map_err(|err| err.to_string())?;
	rx.recv_timeout(ANSWER_LIMIT).unwrap_or_else(|_| Err(NO_SNAPSHOT.to_owned()))
}

#[cfg(windows)]
fn native_snapshot(webview: &PlatformWebview, width: u32, height: u32, done: SvgDone) {
	crate::win::demo::snapshot(webview, width, height, done);
}

#[cfg(target_os = "linux")]
fn native_snapshot(webview: &PlatformWebview, width: u32, height: u32, done: SvgDone) {
	crate::linux::demo::snapshot(webview, width, height, done);
}

/// The run's window. Dropping it closes the window.
struct View {
	app: AppHandle,
	window: WebviewWindow,
	loads: Receiver<()>,
}

impl View {
	/// Opens the window blank, blocks loopback in it, then loads `html`.
	fn open(app: &AppHandle, html: &str, size: (u32, u32)) -> Result<View, String> {
		let (loaded, loads) = mpsc::channel();
		let blank: Url = "about:blank".parse().map_err(|_| "bad blank URL".to_owned())?;
		let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(blank))
			.inner_size(f64::from(size.0), f64::from(size.1))
			.visible(false)
			.focused(false)
			.skip_taskbar(true)
			.data_directory(app.state::<Paths>().demo_data.clone())
			.incognito(true)
			.initialization_script(RECORDER)
			// The page and blank frames, as on the Mac; a link, a redirect or `location` goes nowhere.
			.on_navigation(|url| url.as_str() == PAGE_URL || url.as_str() == "about:blank")
			.on_new_window(|_, _| NewWindowResponse::Deny)
			.on_download(|_, _| false)
			.on_page_load(move |_, payload| {
				if matches!(payload.event(), PageLoadEvent::Finished) && payload.url().as_str() == PAGE_URL {
					let _ = loaded.send(());
				}
			})
			.build()
			.map_err(|err| format!("cannot open the demo window: {err}"))?;
		let view = View { app: app.clone(), window, loads };
		#[cfg(windows)]
		view.load(html)?;
		#[cfg(target_os = "linux")]
		view.load(html, size)?;
		Ok(view)
	}

	#[cfg(windows)]
	fn load(&self, html: &str) -> Result<(), String> {
		html.clone_into(&mut PAGE.lock().unwrap_or_else(std::sync::PoisonError::into_inner));
		let (tx, rx) = mpsc::channel();
		self.window
			.with_webview(move |webview| {
				let _ = tx.send(crate::win::demo::block_loopback(&webview));
			})
			.map_err(|err| err.to_string())?;
		rx.recv_timeout(LOAD_LIMIT).unwrap_or_else(|_| Err("the loopback block did not finish".to_owned()))?;
		let page: Url = PAGE_URL.parse().map_err(|_| "bad demo page URL".to_owned())?;
		self.window.navigate(page).map_err(|err| err.to_string())
	}

	/// WebKitGTK keeps the compiled loopback rules in the demo folder.
	#[cfg(target_os = "linux")]
	fn load(&self, html: &str, size: (u32, u32)) -> Result<(), String> {
		let folder = self.app.state::<Paths>().demo_data.clone();
		std::fs::create_dir_all(&folder).map_err(|err| format!("cannot make the demo folder: {err}"))?;
		let (tx, rx) = mpsc::channel();
		let html = html.to_owned();
		self.window
			.with_webview(move |webview| {
				crate::linux::demo::load(&webview, &folder, size, &html, Box::new(move |blocked| {
					let _ = tx.send(blocked);
				}));
			})
			.map_err(|err| err.to_string())?;
		rx.recv_timeout(LOAD_LIMIT).unwrap_or_else(|_| Err("the loopback block did not finish".to_owned()))
	}

	/// The first load of the page ended, or never will.
	fn loaded(&self) -> Result<(), String> {
		self.loads.recv_timeout(LOAD_LIMIT).map_err(|_| LOAD_TIMED_OUT.to_owned())
	}

	/// Runs the probe and reads what the page recorded: READ's JSON, or none when the page did
	/// not answer in time.
	fn read(&self, probe: Option<&str>) -> Option<String> {
		let source = serde_json::to_string(&probe).ok()?;
		let start = format!("(async () => {{ const probeSource = {source};\n{READ}\n}})().then((answer) => {{ window.__gsDemoAnswer = answer; }});");
		self.window.eval(start).ok()?;
		let deadline = Instant::now() + ANSWER_LIMIT;
		loop {
			let (tx, rx) = mpsc::channel();
			// The value comes back as JSON: null until the page has answered, then READ's string.
			self.window
				.eval_with_callback("window.__gsDemoAnswer ?? null", move |json| {
					let _ = tx.send(json);
				})
				.ok()?;
			let json = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok()?;
			if let Ok(Some(answer)) = serde_json::from_str::<Option<String>>(&json) {
				return Some(answer);
			}
			if Instant::now() + POLL >= deadline {
				return None;
			}
			std::thread::sleep(POLL);
		}
	}
}

impl Drop for View {
	/// Closes the window and waits until Tauri has let go of its label, so the next run can
	/// take it.
	fn drop(&mut self) {
		let _ = self.window.destroy();
		let deadline = Instant::now() + Duration::from_secs(5);
		while self.app.get_webview_window(LABEL).is_some() && Instant::now() < deadline {
			std::thread::sleep(Duration::from_millis(20));
		}
		#[cfg(windows)]
		PAGE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clear();
	}
}

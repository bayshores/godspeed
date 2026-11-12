//! `godspeed --self-test` (cargo feature `self-test`): this system's demo runner checked in the
//! real app, as CI runs it on all three systems. The main window comes first (with its browser
//! arguments on Windows), as in the app; no server starts. Each check prints one line, and any
//! failure makes the exit code non-zero.

use std::io::Read;
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use gs_shell_rpc::DemoResult;
use serde_json::{Value, json};
use tauri::{App, AppHandle, Manager};

use crate::commands::AppOrigin;
use crate::demo::{self, DemoJob, SvgJob};
use crate::paths::Paths;
use crate::{window, zoom};

/// What the main window's page would be; it stays on the boot page.
const APP_ORIGIN: &str = "http://127.0.0.1:9";

/// A name that stands for any public one whose DNS answer is 127.0.0.1: Windows maps it to
/// 127.0.0.1 in the self-test build (win/demo.rs); elsewhere it resolves to nothing.
pub const LOOPBACK_NAME: &str = "loopback.self-test.invalid";

/// Where a demo's page lives.
#[cfg(target_os = "macos")]
const DEMO_PAGE: &str = demo::ORIGIN;
#[cfg(not(target_os = "macos"))]
const DEMO_PAGE: &str = crate::demo_webview::PAGE_URL;

pub fn requested() -> bool {
	std::env::args().skip(1).any(|arg| arg == "--self-test")
}

pub fn start(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
	let handle = app.handle().clone();
	app.manage(Paths::new(&handle)?);
	app.manage(AppOrigin(APP_ORIGIN.to_owned()));
	app.manage(window::Page::default());
	app.manage(zoom::Zoom::default());
	window::create(&handle)?;
	std::thread::spawn(move || {
		let failed = checks(&handle);
		eprintln!("self-test: {}", if failed == 0 { "all checks passed".to_owned() } else { format!("{failed} failed") });
		handle.exit(i32::from(failed > 0));
	});
	Ok(())
}

/// Runs every check and answers how many failed.
fn checks(app: &AppHandle) -> usize {
	let mut failed = 0;
	let mut report = |name: &str, outcome: Result<String, String>| match outcome {
		Ok(note) => eprintln!("pass: {name}{}", if note.is_empty() { String::new() } else { format!(" ({note})") }),
		Err(why) => {
			failed += 1;
			eprintln!("FAIL: {name}: {why}");
		}
	};
	let (port, seen) = loopback_server();
	let saved = format!("godspeed-self-test-{}.txt", std::process::id());
	let planted = check(app, &planted_page(port, &saved), Some(r#"({ answer: window.answer, href: location.href, size: [innerWidth, innerHeight], download: document.getElementById("save").href })"#));
	// A blocked request is never sent; give one that got through time to arrive.
	std::thread::sleep(Duration::from_millis(500));
	match planted {
		Ok(result) => {
			report("a planted console error, an uncaught error and the probe value come back", planted_errors(&result));
			report("a demo reaches nothing on this machine", nothing_reached(&result, port, &seen));
			report("a download and a navigation from a demo change nothing", nothing_changed(app, &result, &saved));
		}
		Err(err) => report("the planted demo runs", Err(err)),
	}
	report("an invoke from the demo window is refused", invoke_refused(app));
	report("an SVG comes back at its exact size", svg_size(app));
	report("no demo window is left after the runs", no_demo_window(app));
	failed
}

/// What reached the loopback server.
#[derive(Default)]
struct Seen {
	/// The first line of every other connection that sent something; a demo must make none.
	requests: Mutex<Vec<String>>,
	/// TLS handshakes naming LOOPBACK_NAME: an image the browser upgraded to https because the
	/// page is https. Only a name's DNS answer says it is this machine, so this is as far as
	/// such a name gets on every system.
	upgraded: AtomicUsize,
	/// Connections closed before sending a byte, which a browser may open ahead of a load.
	empty: AtomicUsize,
}

impl Seen {
	fn record(&self, sent: &[u8]) {
		if sent.is_empty() {
			self.empty.fetch_add(1, Ordering::SeqCst);
		} else if sent[0] == 0x16 && sent.windows(LOOPBACK_NAME.len()).any(|bytes| bytes == LOOPBACK_NAME.as_bytes()) {
			self.upgraded.fetch_add(1, Ordering::SeqCst);
		} else {
			let line = if sent[0] == 0x16 { "a TLS handshake".to_owned() } else { String::from_utf8_lossy(sent).lines().next().unwrap_or_default().to_owned() };
			self.requests.lock().unwrap_or_else(std::sync::PoisonError::into_inner).push(line);
		}
	}
}

/// A loopback server on IPv4 and IPv6.
fn loopback_server() -> (u16, Arc<Seen>) {
	let seen = Arc::new(Seen::default());
	let Ok(v4) = TcpListener::bind("127.0.0.1:0") else { return (0, seen) };
	let port = v4.local_addr().map_or(0, |addr| addr.port());
	for listener in [Some(v4), TcpListener::bind(("::1", port)).ok()].into_iter().flatten() {
		let seen = seen.clone();
		std::thread::spawn(move || {
			for mut stream in listener.incoming().flatten() {
				let mut buffer = [0; 2048];
				let sent = stream.read(&mut buffer).unwrap_or(0);
				seen.record(&buffer[..sent]);
				let _ = std::io::Write::write_all(&mut stream, b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nno");
			}
		});
	}
	(port, seen)
}

/// Every way a URL can name this machine: with a user name, a subdomain of localhost, a
/// trailing dot, IPv6 and IPv4 inside IPv6, each over http and https.
fn loopback_images(port: u16) -> String {
	let hosts = ["127.0.0.1", "a@127.0.0.1", "a:b@localhost", "foo.localhost", "a.b.localhost", "localhost.", "[::1]", "a@[::1]", "[::]", "[::ffff:127.0.0.1]", "0.0.0.0", "a@0.0.0.0"];
	let mut tags = String::new();
	for host in hosts {
		for scheme in ["http", "https"] {
			tags.push_str(&format!(r#"<img src="{scheme}://{host}:{port}/x">"#));
		}
	}
	tags
}

/// The planted page: every loopback form, WebSockets, a worker, a name standing for one whose
/// DNS answer is this machine, a download, an uncaught error and navigations away.
fn planted_page(port: u16, saved: &str) -> String {
	format!(
		r#"<!doctype html><html><body><p>demo</p>{images}
<iframe src="http://127.0.0.1:{port}/frame"></iframe>
<img src="http://{LOOPBACK_NAME}:{port}/name-image"><iframe src="http://{LOOPBACK_NAME}:{port}/name-frame"></iframe>
<a id="save" download="{saved}">save</a>
<script src="https://does-not-exist.invalid/lib.js"></script>
<script>
console.error("planted", {{ a: 1 }});
window.answer = {{ n: 42, cookie: document.cookie }};
fetch("http://127.0.0.1:{port}/api/classes", {{ credentials: "include" }}).catch(() => {{}});
fetch("http://localhost:{port}/api/classes").catch(() => {{}});
fetch("http://{LOOPBACK_NAME}:{port}/name-fetch").catch(() => {{}});
const img = new Image(); img.src = "http://127.0.0.1:{port}/pixel.png"; document.body.appendChild(img);
for (const url of ["ws://127.0.0.1:{port}/ws", "ws://localhost:{port}/ws", "ws://[::1]:{port}/ws", "ws://{LOOPBACK_NAME}:{port}/name-ws"]) {{
  try {{ new WebSocket(url); }} catch {{}}
}}
new Worker(URL.createObjectURL(new Blob(['fetch("http://127.0.0.1:{port}/worker").catch(() => {{}});'], {{ type: "text/javascript" }})));
const save = document.getElementById("save");
save.href = URL.createObjectURL(new Blob(["saved"], {{ type: "text/plain" }}));
save.click();
setTimeout(() => {{ throw new Error("planted uncaught"); }}, 10);
setTimeout(() => {{ location.href = "http://127.0.0.1:{port}/away"; }}, 50);
setTimeout(() => {{ location.href = "https://example.com/"; }}, 100);
</script></body></html>"#,
		images = loopback_images(port),
	)
}

fn planted_errors(result: &DemoResult) -> Result<String, String> {
	if result.ok {
		return Err("the demo came back ok".to_owned());
	}
	if result.console_errors != [r#"planted {"a":1}"#] {
		return Err(format!("console errors {:?}", result.console_errors));
	}
	if !result.page_errors.iter().any(|err| err.contains("planted uncaught")) {
		return Err(format!("page errors {:?}", result.page_errors));
	}
	if !result.failed_requests.iter().any(|req| req.starts_with("https://does-not-exist.invalid/lib.js (script failed to load)")) {
		return Err(format!("failed requests {:?}", result.failed_requests));
	}
	let (width, height) = demo::DEMO_SIZE;
	match &result.probe_result {
		Some(probe) if probe["answer"] == json!({ "n": 42, "cookie": "" }) && probe["size"] == json!([width, height]) => Ok(String::new()),
		other => Err(format!("probe {other:?}")),
	}
}

fn nothing_reached(result: &DemoResult, port: u16, seen: &Seen) -> Result<String, String> {
	let requests = seen.requests.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
	if !requests.is_empty() {
		return Err(format!("the loopback server got {}: {requests:?}", requests.len()));
	}
	let failed = result.failed_requests.join("\n");
	for blocked in [format!("http://127.0.0.1:{port}/api/classes (TypeError"), format!("http://localhost:{port}/api/classes (TypeError")] {
		if !failed.contains(&blocked) {
			return Err(format!("no failed request {blocked}: {failed}"));
		}
	}
	let notes = [(seen.upgraded.load(Ordering::SeqCst), "TLS handshake(s) from an image upgraded to https"), (seen.empty.load(Ordering::SeqCst), "connection(s) closed with no request")];
	Ok(notes.iter().filter(|(n, _)| *n > 0).map(|(n, what)| format!("{n} {what}")).collect::<Vec<_>>().join(", "))
}

fn nothing_changed(app: &AppHandle, result: &DemoResult, saved: &str) -> Result<String, String> {
	let href = result.probe_result.as_ref().map_or(&Value::Null, |probe| &probe["href"]);
	if href != DEMO_PAGE {
		return Err(format!("the demo moved to {href}"));
	}
	// The places a browser saves to by default; wry falls back to the working folder.
	let folders = [app.path().download_dir().ok(), app.path().home_dir().ok(), Some(std::env::temp_dir()), std::env::current_dir().ok()];
	if let Some(file) = folders.into_iter().flatten().map(|folder| folder.join(saved)).find(|file| file.exists()) {
		return Err(format!("the download was saved to {}", file.display()));
	}
	// Without this, a click the browser never turned into a download would pass too.
	#[cfg(not(target_os = "macos"))]
	{
		let download = result.probe_result.as_ref().and_then(|probe| probe["download"].as_str()).unwrap_or_default();
		let refused = crate::demo_webview::REFUSED.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
		if !refused.iter().any(|url| url == download) {
			return Err(format!("no guard of the demo window stopped the download {download:?}; it refused {refused:?}"));
		}
	}
	Ok(String::new())
}

/// The Mac's demo view has no bridge at all; elsewhere Tauri's bridge is there and every
/// command must be refused.
fn invoke_refused(app: &AppHandle) -> Result<String, String> {
	// The marker proves the probe ran in the demo's own page, not an error page.
	let probe = r#"!document.getElementById("invoke") ? "not the demo page" : window.__TAURI_INTERNALS__ ? window.__TAURI_INTERNALS__.invoke("get_zoom").then((v) => "allowed: " + JSON.stringify(v), (e) => "refused: " + String(e)) : "no bridge""#;
	let result = check(app, r#"<p id="invoke">invoke</p>"#, Some(probe))?;
	let answer = result.probe_result.as_ref().and_then(Value::as_str).unwrap_or_default().to_owned();
	let refused = if cfg!(target_os = "macos") { answer == "no bridge" } else { answer.starts_with("refused: ") };
	// Tauri's refusal runs over several lines; its first one says enough.
	if refused { Ok(answer.lines().next().unwrap_or_default().to_owned()) } else { Err(format!("the demo window got {answer:?} ({:?})", result.page_errors)) }
}

fn svg_size(app: &AppHandle) -> Result<String, String> {
	let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="123" height="45"><rect width="123" height="45" fill="#ff0000"/></svg>"##;
	let job = SvgJob { svg: svg.to_owned(), width: 123, height: 45 };
	let png = on_main(app, move |app, done| demo::svg(app, job, done))?;
	let image = image::load_from_memory(&png).map_err(|err| err.to_string())?.to_rgba8();
	if image.dimensions() != (123, 45) {
		return Err(format!("the PNG is {:?}", image.dimensions()));
	}
	let [r, g, b, a] = image.get_pixel(61, 22).0;
	if r > 200 && g < 60 && b < 60 && a == 255 { Ok(String::new()) } else { Err(format!("the middle is {:?}, not red", [r, g, b, a])) }
}

fn check(app: &AppHandle, html: &str, probe: Option<&str>) -> Result<DemoResult, String> {
	let job = DemoJob { html: html.to_owned(), probe: probe.map(str::to_owned) };
	on_main(app, move |app, done| demo::run(app, job, done))
}

/// Starts a run on the main thread, where the queue in rpc.rs starts it too, and waits for it.
fn on_main<T: Send + 'static>(app: &AppHandle, start: impl FnOnce(&AppHandle, Box<dyn FnOnce(Result<T, String>) + Send>) + Send + 'static) -> Result<T, String> {
	let (tx, rx) = mpsc::channel();
	let handle = app.clone();
	app.run_on_main_thread(move || {
		start(
			&handle,
			Box::new(move |result| {
				let _ = tx.send(result);
			}),
		);
	})
	.map_err(|err| err.to_string())?;
	rx.recv_timeout(Duration::from_secs(90)).map_err(|_| "no answer within 90 s".to_owned())?
}

#[cfg(not(target_os = "macos"))]
fn no_demo_window(app: &AppHandle) -> Result<String, String> {
	let deadline = std::time::Instant::now() + Duration::from_secs(5);
	while app.get_webview_window(crate::demo_webview::LABEL).is_some() || app.webview_windows().len() != 1 {
		if std::time::Instant::now() > deadline {
			return Err(format!("windows open: {:?}", app.webview_windows().keys().collect::<Vec<_>>()));
		}
		std::thread::sleep(Duration::from_millis(50));
	}
	Ok(String::new())
}

/// The Mac's demo window is AppKit's own: one on screen with nothing showing.
#[cfg(target_os = "macos")]
fn no_demo_window(app: &AppHandle) -> Result<String, String> {
	let (tx, rx) = mpsc::channel();
	app.run_on_main_thread(move || {
		let mtm = objc2::MainThreadMarker::new().expect("the main thread");
		let left = objc2_app_kit::NSApplication::sharedApplication(mtm).windows().iter().filter(|w| w.isVisible() && w.alphaValue() == 0.0).count();
		let _ = tx.send(left);
	})
	.map_err(|err| err.to_string())?;
	match rx.recv_timeout(Duration::from_secs(5)) {
		Ok(0) => Ok(String::new()),
		Ok(left) => Err(format!("{left} demo window(s) left")),
		Err(_) => Err("the main thread did not answer".to_owned()),
	}
}

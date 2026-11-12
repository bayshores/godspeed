//! The Mac demo runner in a real WKWebView: what a demo gets wrong comes back, the probe's value
//! comes back, and a demo reaches nothing on this machine. WebKit needs the process's main
//! thread, so this runs without the test harness.

#[cfg(not(target_os = "macos"))]
fn main() {}

#[cfg(target_os = "macos")]
fn main() {
	checks::main();
}

#[cfg(target_os = "macos")]
#[allow(dead_code, unused_imports)]
#[path = "../src/demo.rs"]
mod demo;

#[cfg(target_os = "macos")]
#[allow(dead_code, unused_imports)]
#[path = "../src/paths.rs"]
mod paths;

#[cfg(target_os = "macos")]
#[allow(dead_code)]
#[path = "../src/mac/mod.rs"]
mod mac;

#[cfg(target_os = "macos")]
mod checks {
	use std::io::Read;
	use std::net::TcpListener;
	use std::sync::atomic::{AtomicUsize, Ordering};
	use std::sync::mpsc::{self, Receiver};
	use std::sync::Arc;
	use std::time::{Duration, Instant};

	use gs_shell_rpc::DemoResult;
	use objc2::MainThreadMarker;
	use objc2::rc::{Retained, autoreleasepool};
	use objc2_app_kit::{NSApplication, NSApplicationActivationPolicy, NSMenu, NSWindow, NSWindowCollectionBehavior};
	use objc2_foundation::{NSDate, NSRunLoop};
	use serde_json::json;

	use crate::demo::{DemoJob, SvgJob};
	use crate::mac::demo::{Work, start};

	/// What the demo window looked like while a run was going.
	#[derive(Default)]
	struct Seen {
		demo_window: bool,
		in_windows_menu: bool,
		excluded_from_windows_menu: bool,
		ignores_mouse: bool,
		behavior: Option<NSWindowCollectionBehavior>,
	}

	pub fn main() {
		let mtm = MainThreadMarker::new().expect("the test runs on the main thread");
		let app = NSApplication::sharedApplication(mtm);
		// No Dock icon and no focus taken from whatever the person is doing.
		app.setActivationPolicy(NSApplicationActivationPolicy::Accessory);
		let windows_menu = NSMenu::new(mtm);
		app.setWindowsMenu(Some(&windows_menu));
		let folder = std::env::temp_dir().join(format!("godspeed-mac-demo-test-{}", std::process::id()));
		let (port, requests) = cookie_server();

		let mut seen = Seen::default();
		planted_errors_come_back_and_nothing_local_is_reached(&folder, port, &mut seen);
		assert_eq!(requests.load(Ordering::SeqCst), 0, "the demo reached the loopback server");
		assert!(seen.demo_window, "no demo window was seen during the run");
		assert!(seen.excluded_from_windows_menu && !seen.in_windows_menu, "the demo window is in the Window menu");
		assert!(seen.ignores_mouse, "the demo window takes clicks");
		let behavior = seen.behavior.unwrap();
		for wanted in [
			NSWindowCollectionBehavior::Transient,
			NSWindowCollectionBehavior::IgnoresCycle,
			NSWindowCollectionBehavior::CanJoinAllSpaces,
			NSWindowCollectionBehavior::Stationary,
			NSWindowCollectionBehavior::FullScreenAuxiliary,
		] {
			assert!(behavior.contains(wanted), "collection behavior {behavior:?} lacks {wanted:?}");
		}
		no_demo_window_is_left(mtm);

		a_clean_demo_is_ok(&folder);
		a_failing_probe_is_a_page_error(&folder);
		an_svg_comes_back_at_its_exact_size(&folder);
		no_demo_window_is_left(mtm);

		let _ = std::fs::remove_dir_all(&folder);
		eprintln!("mac_demo: all checks passed");
	}

	/// A loopback server, on IPv4 and IPv6, that answers only a request carrying the app's cookie;
	/// it counts every connection, and a demo must make none.
	fn cookie_server() -> (u16, Arc<AtomicUsize>) {
		let v4 = TcpListener::bind("127.0.0.1:0").unwrap();
		let port = v4.local_addr().unwrap().port();
		let v6 = TcpListener::bind(("::1", port)).unwrap();
		let requests = Arc::new(AtomicUsize::new(0));
		for listener in [v4, v6] {
			let counted = requests.clone();
			std::thread::spawn(move || {
				for stream in listener.incoming().flatten() {
					counted.fetch_add(1, Ordering::SeqCst);
					let mut stream = stream;
					let mut head = [0; 2048];
					let n = stream.read(&mut head).unwrap_or(0);
					let body = if String::from_utf8_lossy(&head[..n]).contains("gs_desktop=secret") { "secret" } else { "no" };
					let _ = std::io::Write::write_all(&mut stream, format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n{body}", body.len()).as_bytes());
				}
			});
		}
		(port, requests)
	}

	/// Every way a URL can name this machine: with a user name, a subdomain of localhost, a
	/// trailing dot, IPv6 and IPv4 inside IPv6, each over http and https.
	fn loopback_images(port: u16) -> String {
		let hosts = [
			"127.0.0.1",
			"a@127.0.0.1",
			"a:b@localhost",
			"foo.localhost",
			"a.b.localhost",
			"localhost.",
			"[::1]",
			"a@[::1]",
			"[::]",
			"[::ffff:127.0.0.1]",
			"0.0.0.0",
			"a@0.0.0.0",
		];
		let mut tags = String::new();
		for host in hosts {
			for scheme in ["http", "https"] {
				tags.push_str(&format!(r#"<img src="{scheme}://{host}:{port}/x">"#));
			}
		}
		tags
	}

	fn planted_errors_come_back_and_nothing_local_is_reached(folder: &std::path::Path, port: u16, seen: &mut Seen) {
		let html = format!(
			r#"<!doctype html><html><body><p>demo</p>{images}
<script src="https://does-not-exist.invalid/lib.js"></script>
<script>
console.error("planted", {{ a: 1 }});
window.answer = {{ n: 42, origin: location.origin, cookie: document.cookie }};
fetch("http://127.0.0.1:{port}/api/spaces", {{ credentials: "include" }}).catch(() => {{}});
fetch("http://localhost:{port}/api/spaces").catch(() => {{}});
const img = new Image(); img.src = "http://127.0.0.1:{port}/pixel.png"; document.body.appendChild(img);
setTimeout(() => {{ throw new Error("planted uncaught"); }}, 10);
setTimeout(() => {{ location.href = "http://127.0.0.1:{port}/away"; }}, 50);
setTimeout(() => {{ location.href = "https://example.com/"; }}, 100);
</script></body></html>"#,
			images = loopback_images(port),
		);
		let probe = "({ answer: window.answer, href: location.href })";
		let result = check(folder, &html, Some(probe), |mtm| look_at_demo_window(mtm, seen));
		assert!(!result.ok);
		assert_eq!(result.console_errors, vec![r#"planted {"a":1}"#.to_owned()]);
		assert!(result.page_errors.iter().any(|e| e.contains("planted uncaught")), "{:?}", result.page_errors);
		let failed = result.failed_requests.join("\n");
		assert!(failed.contains("https://does-not-exist.invalid/lib.js (script failed to load)"), "{failed}");
		assert!(failed.contains(&format!("http://127.0.0.1:{port}/api/spaces (TypeError")), "{failed}");
		assert!(failed.contains(&format!("http://localhost:{port}/api/spaces (TypeError")), "{failed}");
		assert!(failed.contains(&format!("http://127.0.0.1:{port}/pixel.png (img failed to load)")), "{failed}");
		assert_eq!(
			result.probe_result,
			Some(json!({ "answer": { "n": 42, "origin": "https://demo.invalid", "cookie": "" }, "href": "https://demo.invalid/" })),
			"the demo navigated away or saw a cookie"
		);
	}

	fn a_clean_demo_is_ok(folder: &std::path::Path) {
		let result = check(folder, "<p>hi</p>", Some("document.querySelector('p').textContent"), |_| {});
		assert_eq!(result, DemoResult { probe_result: Some(json!("hi")), ok: true, ..DemoResult::default() });
		let unprobed = check(folder, "<p>hi</p><script>window.x = undefined</script>", None, |_| {});
		assert_eq!(unprobed, DemoResult { ok: true, ..DemoResult::default() });
		let undefined = check(folder, "<p>hi</p>", Some("window.nothing"), |_| {});
		assert_eq!(undefined, DemoResult { ok: true, ..DemoResult::default() }, "an undefined probe value stays absent");
	}

	fn a_failing_probe_is_a_page_error(folder: &std::path::Path) {
		let result = check(folder, "<p>hi</p>", Some("nope.x"), |_| {});
		assert!(!result.ok);
		assert_eq!(result.probe_result, None);
		assert_eq!(result.page_errors.len(), 1, "{:?}", result.page_errors);
		assert!(result.page_errors[0].starts_with("probe failed: ") && result.page_errors[0].contains("nope"), "{:?}", result.page_errors);
	}

	fn an_svg_comes_back_at_its_exact_size(folder: &std::path::Path) {
		let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="123" height="45"><rect width="123" height="45" fill="#ff0000"/></svg>"##;
		let (tx, rx) = mpsc::channel();
		start(folder, Work::Svg(SvgJob { svg: svg.to_owned(), width: 123, height: 45 }, Box::new(move |png| tx.send(png).unwrap())));
		let png = wait(&rx, |_| {}).expect("the SVG snapshot");
		let image = image::load_from_memory(&png).unwrap().to_rgba8();
		assert_eq!(image.dimensions(), (123, 45));
		let [r, g, b, a] = image.get_pixel(61, 22).0;
		assert!(r > 200 && g < 60 && b < 60 && a == 255, "the middle is {:?}, not red", [r, g, b, a]);
	}

	fn check(folder: &std::path::Path, html: &str, probe: Option<&str>, during: impl FnMut(MainThreadMarker)) -> DemoResult {
		let (tx, rx) = mpsc::channel();
		let job = DemoJob { html: html.to_owned(), probe: probe.map(str::to_owned) };
		start(folder, Work::Demo(job, Box::new(move |result| tx.send(result).unwrap())));
		wait(&rx, during).expect("the demo check")
	}

	/// Runs the main run loop until the runner answers, calling `during` between turns.
	fn wait<T>(rx: &Receiver<T>, mut during: impl FnMut(MainThreadMarker)) -> T {
		let mtm = MainThreadMarker::new().unwrap();
		let deadline = Instant::now() + Duration::from_secs(60);
		loop {
			if let Ok(answer) = rx.try_recv() {
				return answer;
			}
			assert!(Instant::now() < deadline, "no answer within 60 s");
			autoreleasepool(|_| NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.02)));
			during(mtm);
		}
	}

	/// The demo window: the one at the status level with nothing showing.
	fn demo_windows(mtm: MainThreadMarker) -> Vec<Retained<NSWindow>> {
		NSApplication::sharedApplication(mtm).windows().iter().filter(|w| w.level() == 25 && w.alphaValue() == 0.0 && w.isVisible()).collect()
	}

	fn look_at_demo_window(mtm: MainThreadMarker, seen: &mut Seen) {
		let Some(window) = demo_windows(mtm).into_iter().next() else { return };
		seen.demo_window = true;
		seen.excluded_from_windows_menu = window.isExcludedFromWindowsMenu();
		seen.ignores_mouse = window.ignoresMouseEvents();
		seen.behavior = Some(window.collectionBehavior());
		let menu = NSApplication::sharedApplication(mtm).windowsMenu().expect("the test's Window menu");
		let window_ptr = Retained::as_ptr(&window).cast::<objc2::runtime::AnyObject>();
		seen.in_windows_menu |= menu.itemArray().iter().any(|item| item.target().is_some_and(|target| Retained::as_ptr(&target) == window_ptr));
	}

	fn no_demo_window_is_left(mtm: MainThreadMarker) {
		let left = demo_windows(mtm);
		assert!(left.is_empty(), "{} demo window(s) left after the run", left.len());
	}
}

//! godspeed-server as the shell's child: the port, the per-launch secret, start and readiness,
//! the window's login, restarts after a crash, the stopped dialog and the stop at quit.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use gs_shell_rpc::ToServer;
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind, MessageDialogResult};

use crate::paths::{self, Paths};
use crate::terminal::Terminals;
use crate::{bug_report, log, restarts, rpc};

/// Outside agents keep their saved setup when the port stays the same. Taken, any free port
/// works: the real one is always in `<data>/mcp-endpoint.json`.
#[cfg(not(debug_assertions))]
const PREFERRED_PORT: u16 = 47613;
const READY_LIMIT: Duration = Duration::from_secs(30);
const LOGIN_LIMIT: Duration = Duration::from_secs(2);
const STOP_GRACE: Duration = Duration::from_secs(3);
/// `desktop:dev`: how long the window waits for Vite.
#[cfg(debug_assertions)]
const VITE_LIMIT: Duration = Duration::from_secs(30);

/// How the window reaches the app.
pub enum Mode {
	/// The server checks the window's cookie, which the login sets.
	Desktop { secret: String },
	/// `desktop:dev`: the window opens Vite on this port, which passes /api to an open server.
	#[cfg(debug_assertions)]
	Browser { vite: u16 },
}

pub struct Server {
	port: u16,
	mode: Mode,
	running: Mutex<Option<Running>>,
	last_generation: AtomicU64,
	/// The first start finished, so a reopened window can log in.
	up: AtomicBool,
	stopping: AtomicBool,
	restart_times: Mutex<Vec<i64>>,
	logins: Mutex<HashMap<u64, mpsc::Sender<()>>>,
	last_login: AtomicU64,
}

/// The current child. A restarted server is a new generation, and an answer meant for an
/// older one is dropped.
struct Running {
	child: Arc<Mutex<Child>>,
	stdin: Option<ChildStdin>,
	generation: u64,
}

impl Server {
	/// Chosen before the window is built: the page's origin is baked into the shim.
	pub fn choose() -> Result<Server, String> {
		let (port, mode) = choose_port()?;
		Ok(Server {
			port,
			mode,
			running: Mutex::default(),
			last_generation: AtomicU64::new(0),
			up: AtomicBool::new(false),
			stopping: AtomicBool::new(false),
			restart_times: Mutex::default(),
			logins: Mutex::default(),
			last_login: AtomicU64::new(0),
		})
	}

	fn url(&self) -> String {
		format!("http://127.0.0.1:{}", self.port)
	}

	/// The origin of the app page.
	pub fn window_origin(&self) -> String {
		match self.mode {
			Mode::Desktop { .. } => self.url(),
			#[cfg(debug_assertions)]
			Mode::Browser { vite } => format!("http://127.0.0.1:{vite}"),
		}
	}

	pub fn is_up(&self) -> bool {
		self.up.load(Ordering::SeqCst)
	}

	/// The first start, off the main thread: once the server is ready the window goes to the app.
	pub fn start(app: &AppHandle) {
		let app = app.clone();
		std::thread::spawn(move || {
			let server = app.state::<Server>();
			let paths = app.state::<Paths>();
			log::line(&format!("starting server: {}", paths::server_binary().map(|p| p.display().to_string()).unwrap_or_default()));
			log::line(&format!("data dir: {}", paths.data.display()));
			if let Err(err) = server.spawn_ready(&app, false) {
				log::line(&err);
				server.stopped(&app);
				return;
			}
			log::line(&format!("server up: {}", server.url()));
			server.up.store(true, Ordering::SeqCst);
			if let Err(err) = server.open_window(&app) {
				log::line(&err);
				server.stopped(&app);
			}
		});
	}

	/// Logs the main window in (desktop mode) and sends it to the app.
	pub fn open_window(&self, app: &AppHandle) -> Result<(), String> {
		let Some(main) = app.get_webview_window("main") else { return Ok(()) };
		let target = match &self.mode {
			Mode::Desktop { .. } => self.log_in().map(|token| format!("{}/api/desktop/login?token={token}", self.url())),
			#[cfg(debug_assertions)]
			Mode::Browser { vite } => wait_for_vite(*vite).map(|()| format!("{}/", self.window_origin())),
		};
		let url: Url = target?.parse().map_err(|err| format!("bad app address: {err}"))?;
		main.navigate(url).map_err(|err| format!("cannot open the app: {err}"))?;
		// Never the login URL: it holds the token.
		log::line(&format!("window open: {}/", self.window_origin()));
		Ok(())
	}

	/// A one-time token the server takes over stdin; the window opens the login URL with it.
	fn log_in(&self) -> Result<String, String> {
		let token = random_hex::<32>();
		let id = self.last_login.fetch_add(1, Ordering::SeqCst) + 1;
		let (tx, rx) = mpsc::channel();
		lock(&self.logins).insert(id, tx);
		self.send(None, &ToServer::Login { id, token: token.clone() });
		let answered = rx.recv_timeout(LOGIN_LIMIT);
		lock(&self.logins).remove(&id);
		answered.map(|()| token).map_err(|_| "the server did not take the window's login".to_owned())
	}

	pub fn login_ok(&self, id: u64) {
		if let Some(tx) = lock(&self.logins).get(&id) {
			let _ = tx.send(());
		}
	}

	/// Starts a server and waits until it says it listens, then tells the agents where it is.
	fn spawn_ready(&self, app: &AppHandle, restarted: bool) -> Result<(), String> {
		let ready = self.spawn(app, restarted)?;
		match ready.recv_timeout(READY_LIMIT) {
			Ok(()) => {}
			Err(RecvTimeoutError::Disconnected) => return Err("server exited before it was ready".to_owned()),
			Err(RecvTimeoutError::Timeout) => return Err(format!("server was not ready after {} s", READY_LIMIT.as_secs())),
		}
		self.write_endpoint(&app.state::<Paths>());
		Ok(())
	}

	/// Starts the child and its readers. The receiver gets a message once the server listens and
	/// closes if it exits first.
	fn spawn(&self, app: &AppHandle, restarted: bool) -> Result<mpsc::Receiver<()>, String> {
		let paths = app.state::<Paths>();
		let binary = paths::server_binary().map_err(|err| format!("cannot find the server: {err}"))?;
		let mut command = Command::new(&binary);
		command
			.current_dir(&paths.resources)
			.stdin(Stdio::piped())
			.stdout(Stdio::piped())
			.stderr(Stdio::piped())
			.env("PORT", self.port.to_string())
			.env("LH_DATA_DIR", &paths.data)
			.env("LH_SHELL", "1")
			.env("LH_PDFIUM_PATH", &paths.pdfium)
			.env("LH_TERMINALS", serde_json::Value::from(app.try_state::<Terminals>().map(|t| t.live()).unwrap_or_default()).to_string())
			.env_remove("LH_DEV_URL");
		match &self.mode {
			Mode::Desktop { secret } => command.env("LH_DESKTOP_SERVER", "1").env("LH_DESKTOP_API_SECRET", secret),
			#[cfg(debug_assertions)]
			Mode::Browser { .. } => command.env_remove("LH_DESKTOP_SERVER").env_remove("LH_DESKTOP_API_SECRET"),
		};
		if restarted {
			command.env("LH_SERVER_RESTARTED", "1");
		} else {
			command.env_remove("LH_SERVER_RESTARTED");
		}
		// The server is a console program: started from a GUI app without this, it gets a
		// console window of its own, and closing that window kills it.
		#[cfg(windows)]
		std::os::windows::process::CommandExt::creation_flags(&mut command, 0x0800_0000);
		let mut child = command.spawn().map_err(|err| format!("cannot start {}: {err}", binary.display()))?;
		let (stdin, stdout, stderr) = (child.stdin.take(), child.stdout.take(), child.stderr.take());
		let generation = self.last_generation.fetch_add(1, Ordering::SeqCst) + 1;
		let child = Arc::new(Mutex::new(child));
		{
			let mut running = lock(&self.running);
			// A stop that came first owns the end: this child must not outlive the app.
			if self.stopping.load(Ordering::SeqCst) {
				drop(stdin);
				let mut child = lock(&child);
				let _ = child.kill();
				let _ = child.wait();
				return Err("the app is quitting".to_owned());
			}
			*running = Some(Running { child: child.clone(), stdin, generation });
		}
		if let Some(stderr) = stderr {
			std::thread::spawn(move || forward_stderr(stderr));
		}
		let (ready_tx, ready_rx) = mpsc::channel();
		let app = app.clone();
		std::thread::spawn(move || {
			let was_ready = stdout.is_some_and(|stdout| rpc::read(&app, generation, stdout, ready_tx));
			let status = wait_exit(&child);
			log::line(&exit_line(status));
			let server = app.state::<Server>();
			if was_ready && server.is_current(generation) && !server.stopping.load(Ordering::SeqCst) {
				server.restart(&app);
			}
		});
		Ok(ready_rx)
	}

	/// After a crash: start again on the same port and reload the window (its cookie still
	/// matches), unless the server keeps crashing.
	fn restart(&self, app: &AppHandle) {
		let allowed = {
			let mut times = lock(&self.restart_times);
			let allowed = restarts::record(&times, gs_base::clock::now_ms());
			if let Some(kept) = &allowed {
				times.clone_from(kept);
			}
			allowed
		};
		let Some(times) = allowed else {
			self.stopped(app);
			return;
		};
		log::line(&format!("restarting server ({} in the last minute)", times.len()));
		if let Err(err) = self.spawn_ready(app, true) {
			log::line(&err);
			self.stopped(app);
			return;
		}
		log::line(&format!("server up again: {}", self.url()));
		if let Some(main) = app.get_webview_window("main") {
			let _ = main.reload();
		}
	}

	pub fn is_current(&self, generation: u64) -> bool {
		lock(&self.running).as_ref().is_some_and(|running| running.generation == generation)
	}

	/// Writes `msg` to the server's stdin: to the current one, or only to `generation`.
	pub fn send(&self, generation: Option<u64>, msg: &ToServer) {
		let mut running = lock(&self.running);
		let Some(running) = running.as_mut().filter(|running| generation.is_none_or(|g| g == running.generation)) else { return };
		let Some(stdin) = &mut running.stdin else { return };
		if let Err(err) = gs_shell_rpc::write_line(stdin, msg) {
			log::line(&format!("cannot write to the server: {err}"));
		}
	}

	/// The agents' connector reads where this launch's server is.
	fn write_endpoint(&self, paths: &Paths) {
		let text = format!("{}\n", serde_json::json!({ "url": format!("{}/api/mcp", self.url()) }));
		let written = std::fs::create_dir_all(&paths.data).and_then(|()| gs_base::fsx::write_text_atomic(&paths.data.join("mcp-endpoint.json"), &text));
		if let Err(err) = written {
			log::line(&format!("could not write mcp-endpoint.json: {err}"));
		}
	}

	/// The server is gone for good: offer a relaunch, since the window can't work without it.
	fn stopped(&self, app: &AppHandle) {
		if self.stopping.load(Ordering::SeqCst) {
			return;
		}
		self.stop();
		ask_after_stop(app.clone());
	}

	/// Closes the server's stdin (it stops on EOF), gives it a moment, then kills it.
	pub fn stop(&self) {
		self.stopping.store(true, Ordering::SeqCst);
		let Some(running) = lock(&self.running).take() else { return };
		drop(running.stdin);
		let deadline = Instant::now() + STOP_GRACE;
		while Instant::now() < deadline {
			if lock(&running.child).try_wait().is_ok_and(|status| status.is_some()) {
				return;
			}
			std::thread::sleep(Duration::from_millis(50));
		}
		let mut child = lock(&running.child);
		let _ = child.kill();
		let _ = child.wait();
	}
}

/// Report a bug opens the issue page and asks again.
fn ask_after_stop(app: AppHandle) {
	let buttons = MessageDialogButtons::YesNoCancelCustom("Relaunch".to_owned(), "Report a bug".to_owned(), "Quit".to_owned());
	app.dialog().message("The app's server stopped running.").title("godspeed stopped working").kind(MessageDialogKind::Error).buttons(buttons).show_with_result(move |answer| match answer {
		MessageDialogResult::Yes => app.request_restart(),
		MessageDialogResult::Custom(label) if label == "Relaunch" => app.request_restart(),
		MessageDialogResult::No => report_and_ask(app),
		MessageDialogResult::Custom(label) if label == "Report a bug" => report_and_ask(app),
		_ => app.exit(0),
	});
}

fn report_and_ask(app: AppHandle) {
	bug_report::open(&app);
	ask_after_stop(app);
}

/// Release builds prefer the fixed port; a debug build never touches it.
fn choose_port() -> Result<(u16, Mode), String> {
	#[cfg(not(debug_assertions))]
	{
		let port = if is_free(PREFERRED_PORT) { PREFERRED_PORT } else { free_port()? };
		Ok((port, Mode::Desktop { secret: random_hex::<32>() }))
	}
	#[cfg(debug_assertions)]
	{
		// LH_PORT (the lab): a desktop-mode server with the login, like a release build.
		if let Some(port) = std::env::var("LH_PORT").ok().and_then(|p| p.parse().ok()) {
			return Ok((port, Mode::Desktop { secret: random_hex::<32>() }));
		}
		// desktop:dev: the window opens Vite, which passes /api to PORT + 1000 (vite.config.ts).
		let vite: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(3000);
		let port = vite.checked_add(1000).ok_or_else(|| format!("PORT {vite} is too high"))?;
		if !is_free(port) {
			return Err(format!("port {port} is taken; set PORT to another number"));
		}
		Ok((port, Mode::Browser { vite }))
	}
}

fn is_free(port: u16) -> bool {
	TcpListener::bind(("127.0.0.1", port)).is_ok()
}

#[cfg(not(debug_assertions))]
fn free_port() -> Result<u16, String> {
	let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|err| format!("no free port: {err}"))?;
	listener.local_addr().map(|addr| addr.port()).map_err(|err| format!("no free port: {err}"))
}

#[cfg(debug_assertions)]
fn wait_for_vite(port: u16) -> Result<(), String> {
	let deadline = Instant::now() + VITE_LIMIT;
	while Instant::now() < deadline {
		if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
			return Ok(());
		}
		std::thread::sleep(Duration::from_millis(200));
	}
	Err(format!("Vite is not answering on port {port}"))
}

/// `N` random bytes as hex.
pub fn random_hex<const N: usize>() -> String {
	let mut bytes = [0u8; N];
	getrandom::fill(&mut bytes).expect("the OS random source");
	bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn forward_stderr(stderr: impl Read) {
	let mut reader = BufReader::new(stderr);
	let mut line = Vec::new();
	while reader.read_until(b'\n', &mut line).is_ok_and(|n| n > 0) {
		let text = String::from_utf8_lossy(&line);
		let text = text.trim_end();
		if !text.is_empty() {
			log::line(&format!("server: {text}"));
		}
		line.clear();
	}
}

/// The child closed its stdout, so it is ending: wait for its exit status.
fn wait_exit(child: &Mutex<Child>) -> ExitStatus {
	loop {
		match lock(child).try_wait() {
			Ok(Some(status)) => return status,
			Ok(None) => {}
			Err(_) => return lock(child).wait().expect("the server's exit status"),
		}
		std::thread::sleep(Duration::from_millis(20));
	}
}

fn exit_line(status: ExitStatus) -> String {
	let code = status.code().map_or_else(|| "null".to_owned(), |code| code.to_string());
	#[cfg(unix)]
	let signal = std::os::unix::process::ExitStatusExt::signal(&status).map_or_else(|| "null".to_owned(), signal_name);
	#[cfg(not(unix))]
	let signal = "null".to_owned();
	format!("server exited (code={code} signal={signal})")
}

/// Node's names for the signals a crash or a stop gives.
#[cfg(unix)]
fn signal_name(signal: i32) -> String {
	const SIGBUS: i32 = if cfg!(target_os = "linux") { 7 } else { 10 };
	match signal {
		1 => "SIGHUP".to_owned(),
		2 => "SIGINT".to_owned(),
		6 => "SIGABRT".to_owned(),
		9 => "SIGKILL".to_owned(),
		11 => "SIGSEGV".to_owned(),
		15 => "SIGTERM".to_owned(),
		SIGBUS => "SIGBUS".to_owned(),
		other => other.to_string(),
	}
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
	mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn tokens_are_64_hex_and_never_repeat() {
		let (a, b) = (random_hex::<32>(), random_hex::<32>());
		assert_eq!(a.len(), 64);
		assert!(a.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
		assert_ne!(a, b);
	}

	#[test]
	#[cfg(unix)]
	fn exits_read_like_node() {
		use std::os::unix::process::ExitStatusExt;
		assert_eq!(exit_line(ExitStatus::from_raw(143 << 8)), "server exited (code=143 signal=null)");
		assert_eq!(exit_line(ExitStatus::from_raw(9)), "server exited (code=null signal=SIGKILL)");
		assert_eq!(signal_name(15), "SIGTERM");
		assert_eq!(signal_name(if cfg!(target_os = "linux") { 7 } else { 10 }), "SIGBUS");
		assert_eq!(signal_name(30), "30");
	}
}

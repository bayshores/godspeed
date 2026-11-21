//! godspeed-server: the app's backend, started by the desktop shell with its working directory
//! beside `ui/`, `models/` and `pdfjs-dist/`. It listens on 127.0.0.1:$PORT. With `LH_SHELL=1`
//! its stdin and stdout carry the line protocol to the shell (gs-shell-rpc); log lines go to
//! stderr either way.

use std::process::ExitCode;
use std::sync::Arc;

use axum::ServiceExt;
use axum::extract::Request;
use axum::serve::ListenerExt;
use gs_base::config::Paths;
use gs_base::tasks::detach;
use gs_base::{clock, shutdown};
use gs_server::{data_lock, http};
use gs_services::App;
use gs_services::app::deadline_reminder::start_deadline_reminders;
use gs_services::app::menu_bar_countdown::start_menu_bar_countdown;
use gs_services::app::teacher_nudge::start_teacher_nudges;
use gs_shell_rpc::{ShellLink, ToShell};
use tower::Layer;

/// After SIGTERM open requests get this long to finish (an agent's long-poll would hold the
/// close up for most of a minute).
const FORCE_EXIT_MS: u64 = 2000;

#[tokio::main]
async fn main() -> ExitCode {
	if let Err(err) = clock::init_from_env() {
		eprintln!("{err}");
		return ExitCode::FAILURE;
	}
	let paths = Paths::from_env();
	let Ok(_data_lock) = data_lock::lock(&paths).await else {
		eprintln!("another godspeed server is using {}", paths.data.display());
		return ExitCode::FAILURE;
	};
	gs_services::app::old_talk::back_up_talk(&paths);
	// The one stdout writer.
	#[allow(clippy::disallowed_methods)]
	let shell = (std::env::var("LH_SHELL").as_deref() == Ok("1")).then(|| ShellLink::new(std::io::stdout()));
	let port = http::port();
	let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
		// Nagle off, as Node's server had it: a stream's small frames go out the moment they are
		// written instead of waiting for the ACK of the one before. A socket that refuses still works.
		Ok(l) => l.tap_io(|tcp| {
			let _ = tcp.set_nodelay(true);
		}),
		Err(err) => {
			eprintln!("cannot listen on 127.0.0.1:{port}: {err}");
			return ExitCode::FAILURE;
		}
	};
	if let Some(shell) = &shell {
		shell.send(&ToShell::Ready);
	}
	let access = http::access::Access::from_env();
	let app = App::new(paths, shell.clone());
	// A stand-in for godspeed's plugin list, so a debug run (npm run layout) never reads GitHub's.
	#[cfg(debug_assertions)]
	if let Some(file) = std::env::var_os("LH_PLUGIN_LIST") {
		gs_services::plugins::read_list_from(&app, file.into());
	}
	if let Some(shell) = &shell {
		listen_for_terminals(&app, shell);
		// Weak: the app holds the link, so the link must not hold the app.
		let app = Arc::downgrade(&app);
		shell.on_agent_folder(move || app.upgrade().and_then(|app| gs_services::app::agent_folder::set_up_folder(&app)));
	}
	// Before the scans below, so the shell's login round trip runs while they do.
	watch_for_stop(shell);
	gs_services::spaces::upgrade_old_preps(&app);
	gs_services::mocks::mocks::ask_waiting_mocks(&app);
	start_deadline_reminders(&app);
	start_menu_bar_countdown(&app);
	start_teacher_nudges(&app);
	let router = http::server(app, &access);
	let service = axum::middleware::from_fn_with_state(access, http::front).layer(router);
	eprintln!("godspeed-server {} on http://127.0.0.1:{port}", gs_base::config::VERSION);
	let served = axum::serve(listener, ServiceExt::<Request>::into_make_service(service)).with_graceful_shutdown(shutdown::wait()).await;
	if let Err(err) = served {
		eprintln!("{err}");
		return ExitCode::FAILURE;
	}
	// Serving ends only on a stop, which Node answered with 143 too.
	ExitCode::from(143)
}

/// The shell's live terminal ids and the teacher's among them: those at the start (a restarted
/// server knows them at once), then each change; and each Enter the learner typed to an agent there.
fn listen_for_terminals(app: &App, shell: &ShellLink) {
	let at_start = std::env::var("LH_TERMINALS").ok().and_then(|text| gs_json::parse(&text).ok()).unwrap_or_default();
	let ids = at_start["live"].items().iter().filter_map(|id| id.as_str().map(str::to_owned)).collect();
	app.bridge.set_live_terminals(ids, at_start["teacher"].as_str().map(str::to_owned));
	let bridge = app.bridge.clone();
	shell.on_terminals(move |live, teacher| bridge.set_live_terminals(live, teacher));
	let bridge = app.bridge.clone();
	shell.on_typed(move |terminal| bridge.typed(&terminal, clock::now_ms()));
}

/// SIGTERM or SIGINT (Ctrl-C on Windows) stops the server, and so does the end of stdin: the
/// shell's stdin pipe when it started us (its quit, crash or force-quit ends us too, on every
/// OS), else stdin when it is a pipe. After the stop, open requests get FORCE_EXIT_MS, then the
/// process exits with 143 like Node after SIGTERM.
fn watch_for_stop(shell: Option<ShellLink>) {
	detach("shutdown", stop_on_signal());
	if let Some(shell) = shell {
		// What the shell's messages set off may start a task, which a thread outside the runtime cannot.
		let runtime = tokio::runtime::Handle::current();
		std::thread::spawn(move || {
			let _in_runtime = runtime.enter();
			// A panic while handling a message stops the server too: one that no longer hears the
			// shell cannot start a terminal, and the shell starts a stopped server again.
			let _stop = StopWhenDone;
			shell.listen(std::io::stdin().lock());
		});
	} else if stdin_is_pipe() {
		std::thread::spawn(|| {
			let _ = std::io::copy(&mut std::io::stdin(), &mut std::io::sink());
			shutdown::trigger();
		});
	}
	detach("shutdown", async {
		shutdown::wait().await;
		std::thread::spawn(|| {
			std::thread::sleep(std::time::Duration::from_millis(FORCE_EXIT_MS));
			std::process::exit(143);
		});
	});
}

struct StopWhenDone;

impl Drop for StopWhenDone {
	fn drop(&mut self) {
		shutdown::trigger();
	}
}

#[cfg(unix)]
async fn stop_on_signal() {
	use tokio::signal::unix::{SignalKind, signal};
	let (Ok(mut term), Ok(mut int)) = (signal(SignalKind::terminate()), signal(SignalKind::interrupt())) else { return };
	tokio::select! {
		_ = term.recv() => {}
		_ = int.recv() => {}
	}
	shutdown::trigger();
}

#[cfg(windows)]
async fn stop_on_signal() {
	if tokio::signal::ctrl_c().await.is_ok() {
		shutdown::trigger();
	}
}

/// Whether stdin is a pipe (a parent that ends us by closing it), not a terminal or a file.
#[cfg(unix)]
fn stdin_is_pipe() -> bool {
	use std::os::unix::fs::FileTypeExt;
	std::fs::metadata("/dev/stdin").is_ok_and(|m| m.file_type().is_fifo())
}

/// Windows has no `/dev/stdin`, and the shell is the only parent that closes stdin to stop us.
#[cfg(windows)]
fn stdin_is_pipe() -> bool {
	false
}

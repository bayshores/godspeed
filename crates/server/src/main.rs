//! godspeed-server: the app's backend, started by the desktop shell with its working directory
//! beside `ui/`, `models/` and `pdfjs-dist/`. It listens on 127.0.0.1:$PORT. With `LH_SHELL=1`
//! its stdin and stdout carry the line protocol to the shell (gs-shell-rpc); log lines go to
//! stderr either way.

use std::process::ExitCode;

use axum::ServiceExt;
use axum::extract::Request;
use axum::serve::ListenerExt;
use gs_base::config::Paths;
use gs_base::{clock, shutdown};
use gs_server::{data_lock, http};
use gs_services::App;
use gs_services::app::deadline_reminder::start_deadline_reminders;
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
	if let Some(shell) = &shell {
		listen_for_terminals(&app, shell);
	}
	gs_services::spaces::upgrade_old_preps(&app);
	gs_services::mocks::mock_end::ask_waiting_grades(&app);
	start_deadline_reminders(&app);
	let router = http::server(app, &access);
	let service = axum::middleware::from_fn_with_state(access, http::front).layer(router);
	watch_for_stop(shell);
	eprintln!("godspeed-server {} on http://127.0.0.1:{port}", gs_base::config::VERSION);
	let served = axum::serve(listener, ServiceExt::<Request>::into_make_service(service)).with_graceful_shutdown(shutdown::wait()).await;
	if let Err(err) = served {
		eprintln!("{err}");
		return ExitCode::FAILURE;
	}
	// Serving ends only on a stop, which Node answered with 143 too.
	ExitCode::from(143)
}

/// The shell's live terminal ids: those at the start (a restarted server knows them at once),
/// then each change.
fn listen_for_terminals(app: &App, shell: &ShellLink) {
	let at_start = std::env::var("LH_TERMINALS").ok().and_then(|text| gs_json::parse(&text).ok());
	let ids = at_start.iter().flat_map(|list| list.as_arr().into_iter().flatten()).filter_map(|id| id.as_str().map(str::to_owned)).collect();
	app.bridge.set_live_terminals(ids);
	let bridge = app.bridge.clone();
	shell.on_terminals(move |live| bridge.set_live_terminals(live));
}

/// SIGTERM or SIGINT (Ctrl-C on Windows) stops the server, and so does the end of stdin: the
/// shell's stdin pipe when it started us (its quit, crash or force-quit ends us too, on every
/// OS), else stdin when it is a pipe. After the stop, open requests get FORCE_EXIT_MS, then the
/// process exits with 143 like Node after SIGTERM.
fn watch_for_stop(shell: Option<ShellLink>) {
	tokio::spawn(stop_on_signal());
	if let Some(shell) = shell {
		std::thread::spawn(move || {
			shell.listen(std::io::stdin().lock());
			shutdown::trigger();
		});
	} else if stdin_is_pipe() {
		std::thread::spawn(|| {
			let _ = std::io::copy(&mut std::io::stdin(), &mut std::io::sink());
			shutdown::trigger();
		});
	}
	tokio::spawn(async {
		shutdown::wait().await;
		std::thread::spawn(|| {
			std::thread::sleep(std::time::Duration::from_millis(FORCE_EXIT_MS));
			std::process::exit(143);
		});
	});
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

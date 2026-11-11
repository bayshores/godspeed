//! godspeed-server: the app's backend, started by the desktop shell with its working directory
//! beside `ui/`, `models/` and `pdfjs-dist/`. It listens on 127.0.0.1:$PORT and writes nothing
//! until a request asks it to.

use std::fs::File;
use std::os::unix::fs::FileTypeExt;
use std::process::ExitCode;

use axum::ServiceExt;
use axum::extract::Request;
use gs_base::config::Paths;
use gs_base::{clock, shutdown};
use gs_server::http;
use gs_services::App;
use tokio::signal::unix::{SignalKind, signal};
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
	let Ok(_data_lock) = lock_data_dir(&paths) else {
		eprintln!("another godspeed server is using {}", paths.data.display());
		return ExitCode::FAILURE;
	};
	let port = http::port();
	let listener = match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
		Ok(l) => l,
		Err(err) => {
			eprintln!("cannot listen on 127.0.0.1:{port}: {err}");
			return ExitCode::FAILURE;
		}
	};
	let access = http::access::Access::from_env();
	let router = http::server(App::new(paths));
	let service = axum::middleware::from_fn_with_state(access, http::front).layer(router);
	watch_for_stop();
	println!("godspeed-server {} on http://127.0.0.1:{port}", gs_base::config::VERSION);
	let served = axum::serve(listener, ServiceExt::<Request>::into_make_service(service)).with_graceful_shutdown(shutdown::wait()).await;
	if let Err(err) = served {
		eprintln!("{err}");
		return ExitCode::FAILURE;
	}
	ExitCode::SUCCESS
}

/// One server per data folder: an advisory lock on the folder itself, so no file is made. A
/// folder that does not exist yet is not locked.
fn lock_data_dir(paths: &Paths) -> Result<Option<File>, ()> {
	let Ok(dir) = File::open(&paths.data) else { return Ok(None) };
	dir.try_lock().map(|()| Some(dir)).map_err(|_| ())
}

/// SIGTERM or SIGINT stops the server, and so does the end of stdin when stdin is a pipe (the
/// app holds the other end, so its crash or force-quit ends us too). After the stop, open
/// requests get FORCE_EXIT_MS, then the process exits with 143 like Node after SIGTERM.
fn watch_for_stop() {
	tokio::spawn(async {
		let (Ok(mut term), Ok(mut int)) = (signal(SignalKind::terminate()), signal(SignalKind::interrupt())) else { return };
		tokio::select! {
			_ = term.recv() => {}
			_ = int.recv() => {}
		}
		shutdown::trigger();
	});
	if std::fs::metadata("/dev/stdin").is_ok_and(|m| m.file_type().is_fifo()) {
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

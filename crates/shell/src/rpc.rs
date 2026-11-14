//! The shell's end of the line protocol: the server's stdout lines, and the demo queue that
//! answers its requests one at a time on the main thread.

use std::io::{BufReader, Read};
use std::sync::mpsc;

use gs_shell_rpc::{DemoOutcome, DemoResult, SvgOutcome, ToServer, ToShell, read_lines};
use tauri::{AppHandle, Manager};

use crate::demo::{self, DemoJob, SvgJob};
use crate::log;
use crate::notify;
use crate::server::Server;

/// A request from server `generation`; one from a server that has since died is dropped.
struct Job {
	generation: u64,
	id: u64,
	work: Work,
}

enum Work {
	Demo(DemoJob),
	Svg(SvgJob),
}

/// The queue's input (managed state).
pub struct Demos(mpsc::Sender<Job>);

impl Demos {
	pub fn start(app: &AppHandle) -> Demos {
		let (tx, rx) = mpsc::channel::<Job>();
		let app = app.clone();
		std::thread::spawn(move || {
			for job in rx {
				let server = app.state::<Server>();
				if !server.is_current(job.generation) {
					continue;
				}
				let answer = match job.work {
					Work::Demo(work) => demo_answer(job.id, on_main(&app, |app, done| demo::run(app, work, done))),
					Work::Svg(work) => svg_answer(job.id, on_main(&app, |app, done| demo::svg(app, work, done))),
				};
				server.send(Some(job.generation), &answer);
			}
		});
		Demos(tx)
	}
}

fn demo_answer(id: u64, result: Result<DemoResult, String>) -> ToServer {
	ToServer::DemoDone { id, outcome: result.map_or_else(DemoOutcome::Error, DemoOutcome::Result) }
}

fn svg_answer(id: u64, png: Result<Vec<u8>, String>) -> ToServer {
	ToServer::SvgDone { id, outcome: png.map_or_else(SvgOutcome::Error, |png| SvgOutcome::Png(gs_base::base64::encode(&png))) }
}

/// Runs `start` on the main thread (WebKit lives there) and waits for the result it reports.
fn on_main<T: Send + 'static>(app: &AppHandle, start: impl FnOnce(&AppHandle, Box<dyn FnOnce(Result<T, String>) + Send>) + Send + 'static) -> Result<T, String> {
	let (tx, rx) = mpsc::channel();
	let done: Box<dyn FnOnce(Result<T, String>) + Send> = Box::new(move |result| {
		let _ = tx.send(result);
	});
	let handle = app.clone();
	app.run_on_main_thread(move || start(&handle, done)).map_err(|err| err.to_string())?;
	rx.recv().unwrap_or_else(|_| Err("the demo runner gave no answer".to_owned()))
}

/// Handles the server's stdout until it closes. `ready` hears the server's ready line; the
/// answer is whether it came.
pub fn read(app: &AppHandle, generation: u64, stdout: impl Read, ready: mpsc::Sender<()>) -> bool {
	let mut was_ready = false;
	for msg in read_lines::<ToShell>(BufReader::new(stdout)) {
		let (id, work) = match msg {
			Ok(ToShell::Ready) => {
				was_ready = true;
				let _ = ready.send(());
				continue;
			}
			Ok(ToShell::LoginOk { id }) => {
				app.state::<Server>().login_ok(id);
				continue;
			}
			Ok(ToShell::Notify { id, title, body }) => {
				let shown = notify::show(app, &title, &body);
				app.state::<Server>().send(Some(generation), &ToServer::NotifyDone { id, shown });
				continue;
			}
			Ok(ToShell::Demo { id, html, probe }) => (id, Work::Demo(DemoJob { html, probe })),
			Ok(ToShell::Svg { id, svg, width, height }) => (id, Work::Svg(SvgJob { svg, width, height })),
			Err(err) => {
				log::line(&format!("server: {err}"));
				continue;
			}
		};
		let _ = app.state::<Demos>().0.send(Job { generation, id, work });
	}
	was_ready
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn answers_carry_the_request_id_and_the_outcome() {
		let worked = demo_answer(7, Ok(DemoResult { ok: true, ..DemoResult::default() }));
		assert_eq!(serde_json::to_string(&worked).unwrap(), r#"{"t":"demo_done","id":7,"result":{"consoleErrors":[],"pageErrors":[],"failedRequests":[],"ok":true}}"#);
		assert_eq!(serde_json::to_string(&svg_answer(8, Ok(vec![1, 2, 3]))).unwrap(), r#"{"t":"svg_done","id":8,"png":"AQID"}"#);
		assert_eq!(serde_json::to_string(&svg_answer(9, Err("demo checking is not available".into()))).unwrap(), r#"{"t":"svg_done","id":9,"error":"demo checking is not available"}"#);
	}
}

//! The pdfium thread (replaces workers/pdf-text-worker.mjs and pdf.js in pdf-ops.ts).
//!
//! pdfium is a C library with one global state, so every PDF job in the process runs on one
//! thread, shared by every `Pdf` handle and started at the first job. The library is loaded from
//! the resources folder (the server's working directory) at the first job, never before:
//! `libpdfium.dylib` on macOS, `libpdfium.so` on Linux, `pdfium.dll` on Windows. A missing
//! library fails the job with a text, and the next job tries again.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, OnceLock};

use pdfium_render::prelude::Pdfium;
use tokio::sync::oneshot;

const STOPPED: &str = "The PDF reader stopped";

type Job = Box<dyn FnOnce(Result<&Pdfium, String>) + Send>;

/// The handle to the pdfium thread (cheap to clone).
#[derive(Clone)]
pub struct Pdf {
	resources: Arc<Path>,
}

impl Pdf {
	/// Loads nothing until the first job; `resources` holds pdfium's library.
	pub fn new(resources: &Path) -> Pdf {
		Pdf { resources: resources.into() }
	}

	/// Runs `work` on the pdfium thread and waits for its answer.
	pub(crate) async fn run<T: Send + 'static>(&self, work: impl FnOnce(&Pdfium) -> Result<T, String> + Send + 'static) -> Result<T, String> {
		let (reply, answer) = oneshot::channel();
		let job: Job = Box::new(move |library| {
			let _ = reply.send(library.and_then(work));
		});
		jobs()?.send((self.resources.to_path_buf(), job)).map_err(|_| STOPPED.to_owned())?;
		answer.await.unwrap_or_else(|_| Err(STOPPED.to_owned()))
	}
}

/// The queue into the one pdfium thread, started on first use.
fn jobs() -> Result<&'static Sender<(PathBuf, Job)>, String> {
	static JOBS: OnceLock<Result<Sender<(PathBuf, Job)>, String>> = OnceLock::new();
	JOBS.get_or_init(|| {
		let (sender, jobs) = mpsc::channel();
		std::thread::Builder::new()
			.name("pdfium".into())
			.spawn(move || serve(jobs))
			.map(|_| sender)
			.map_err(|e| format!("The PDF reader could not start: {e}"))
	})
	.as_ref()
	.map_err(Clone::clone)
}

/// Runs jobs in order for the life of the process. A job that panics loses only its own answer.
fn serve(jobs: Receiver<(PathBuf, Job)>) {
	let mut library: Option<Pdfium> = None;
	for (resources, job) in jobs {
		let ready = library.take().map_or_else(|| load(&resources), Ok);
		let _ = catch_unwind(AssertUnwindSafe(|| job(ready.as_ref().map_err(Clone::clone))));
		library = ready.ok();
	}
}

/// pdfium binds once per process, so the first library found serves every `Pdf` after it.
fn load(resources: &Path) -> Result<Pdfium, String> {
	let file = Pdfium::pdfium_platform_library_name_at_path(resources);
	let bindings = Pdfium::bind_to_library(&file).map_err(|e| format!("The PDF reader could not load {}: {e}", file.display()))?;
	Ok(Pdfium::new(bindings))
}

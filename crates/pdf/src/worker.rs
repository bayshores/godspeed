//! The pdfium thread (replaces workers/pdf-text-worker.mjs and pdf.js in pdf-ops.ts).
//!
//! pdfium is a C library with one global state, so every PDF job in the process runs on one
//! thread, shared by every `Pdf` handle and started at the first job. The library is loaded at the
//! first job, never before, from the file `LH_PDFIUM_PATH` names or else from the resources folder
//! (the server's working directory): `libpdfium.dylib` on macOS, `libpdfium.so` on Linux,
//! `pdfium.dll` on Windows. A missing library fails the job with a text, and the next job tries
//! again.

use std::ffi::OsString;
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
	library: Arc<Path>,
}

impl Pdf {
	/// Loads nothing until the first job; `resources` holds pdfium's library.
	pub fn new(resources: &Path) -> Pdf {
		Pdf { library: Pdfium::pdfium_platform_library_name_at_path(resources).into() }
	}

	/// Like `new`, but the library file `LH_PDFIUM_PATH` names wins when it is set. The desktop app
	/// keeps the library outside the resources folder (the Mac signs it in `Frameworks`).
	pub fn from_env(resources: &Path) -> Pdf {
		Pdf::choose(std::env::var_os("LH_PDFIUM_PATH"), resources)
	}

	fn choose(named: Option<OsString>, resources: &Path) -> Pdf {
		named.map_or_else(|| Pdf::new(resources), |file| Pdf { library: PathBuf::from(file).into() })
	}

	/// Runs `work` on the pdfium thread and waits for its answer.
	pub(crate) async fn run<T: Send + 'static>(&self, work: impl FnOnce(&Pdfium) -> Result<T, String> + Send + 'static) -> Result<T, String> {
		let (reply, answer) = oneshot::channel();
		let job: Job = Box::new(move |library| {
			let _ = reply.send(library.and_then(work));
		});
		jobs()?.send((self.library.to_path_buf(), job)).map_err(|_| STOPPED.to_owned())?;
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
	for (file, job) in jobs {
		let ready = library.take().map_or_else(|| load(&file), Ok);
		let _ = catch_unwind(AssertUnwindSafe(|| job(ready.as_ref().map_err(Clone::clone))));
		library = ready.ok();
	}
}

/// pdfium binds once per process, so the first library found serves every `Pdf` after it.
fn load(file: &Path) -> Result<Pdfium, String> {
	let bindings = Pdfium::bind_to_library(file).map_err(|e| format!("The PDF reader could not load {}: {e}", file.display()))?;
	Ok(Pdfium::new(bindings))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn the_named_library_wins_over_the_resources_folder() {
		let resources = Path::new("/app/resources");
		let named = Pdf::choose(Some("/app/Frameworks/pdfium-here".into()), resources);
		assert_eq!(&*named.library, Path::new("/app/Frameworks/pdfium-here"));
		let by_folder = Pdf::choose(None, resources);
		assert_eq!(by_folder.library.parent(), Some(resources));
		assert_eq!(by_folder.library, Pdf::new(resources).library);
	}
}

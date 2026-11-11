//! The speech model, downloaded once (ensureWhisperModel in transcribe.ts).

use std::future::Future;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use gs_base::config::Paths;
use gs_base::{clock, fsx, ids};
use parking_lot::Mutex;
use reqwest::redirect::Policy;
use tokio::io::AsyncWriteExt;
use tokio::sync::watch;

pub(crate) const WHISPER_MODEL_NAME: &str = "ggml-base.en.bin";
pub(crate) const WHISPER_MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
/// Node's fetch limits: 10 s to connect, then 300 s for the answer and for each piece of the body.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const SILENCE_LIMIT_MS: i64 = 300_000;

type Outcome = Result<PathBuf, String>;
type Pending = watch::Receiver<Option<Outcome>>;

/// The download under way, if any. Recordings transcribed at the same time share one download; a
/// failed one is forgotten so the next file retries.
#[derive(Default)]
pub struct ModelDownload {
	pending: Arc<Mutex<Option<Pending>>>,
}

impl ModelDownload {
	/// The speech model's path, downloading it first when it is not on disk.
	pub async fn ensure_whisper_model(&self, paths: &Paths) -> Result<PathBuf, String> {
		self.ensure_from(paths, WHISPER_MODEL_URL).await
	}

	pub(crate) async fn ensure_from(&self, paths: &Paths, url: &str) -> Result<PathBuf, String> {
		let file = paths.data.join("models").join(WHISPER_MODEL_NAME);
		let mut outcome = {
			let mut pending = self.pending.lock();
			// Looked for under the lock: a download renames its file before it clears the slot, so a
			// caller never starts a second one just after the first finished.
			if file.exists() {
				return Ok(file);
			}
			match &*pending {
				Some(rx) => rx.clone(),
				None => {
					let (tx, rx) = watch::channel(None);
					*pending = Some(rx.clone());
					tokio::spawn(download_and_report(self.pending.clone(), url.to_owned(), file, tx));
					rx
				}
			}
		};
		let failed = || Err("Speech model download failed".to_owned());
		match outcome.wait_for(Option::is_some).await {
			Ok(done) => done.clone().unwrap_or_else(failed),
			Err(_) => failed(),
		}
	}
}

/// Clears the shared slot when the download ends, even by a panic.
struct Forget(Arc<Mutex<Option<Pending>>>);

impl Drop for Forget {
	fn drop(&mut self) {
		self.0.lock().take();
	}
}

async fn download_and_report(slot: Arc<Mutex<Option<Pending>>>, url: String, file: PathBuf, done: watch::Sender<Option<Outcome>>) {
	let forget = Forget(slot);
	let outcome = download(&url, &file).await;
	drop(forget);
	done.send_replace(Some(outcome));
}

/// tmp + rename, so a broken download never leaves a half model behind.
async fn download(url: &str, file: &Path) -> Outcome {
	let dir = file.parent().unwrap_or(Path::new(""));
	std::fs::create_dir_all(dir).map_err(|err| fsx::node_error_message(&err, "mkdir", dir))?;
	// stdout is the desktop shell's protocol; a closed stderr is not an error.
	let _ = writeln!(std::io::stderr(), "[transcribe] downloading {WHISPER_MODEL_NAME} (~150 MB, one time)");
	let client = reqwest::Client::builder().redirect(Policy::limited(20)).connect_timeout(CONNECT_TIMEOUT).no_proxy().build().map_err(|_| "fetch failed".to_owned())?;
	let Some(Ok(response)) = within(client.get(url).send()).await else {
		return Err("fetch failed".to_owned());
	};
	let status = response.status().as_u16();
	// 204 and 205 are "ok" with no body to save.
	if !response.status().is_success() || status == 204 || status == 205 {
		return Err(format!("Speech model download failed (HTTP {status})"));
	}
	let tmp = PathBuf::from(format!("{}.tmp-{}", file.display(), &ids::uuid()[..8]));
	let saved = save(response, &tmp).await.and_then(|()| std::fs::rename(&tmp, file).map_err(|err| format!("{} -> '{}'", fsx::node_error_message(&err, "rename", &tmp), file.display())));
	match saved {
		Ok(()) => Ok(file.to_owned()),
		Err(message) => {
			let _ = std::fs::remove_file(&tmp);
			Err(message)
		}
	}
}

async fn save(mut response: reqwest::Response, tmp: &Path) -> Result<(), String> {
	let mut out = tokio::fs::File::create(tmp).await.map_err(|err| fsx::node_error_message(&err, "open", tmp))?;
	let write_error = |err: std::io::Error| {
		let message = fsx::node_error_message(&err, "write", tmp);
		message.strip_suffix(&format!(" '{}'", tmp.display())).unwrap_or(&message).to_owned()
	};
	loop {
		match within(response.chunk()).await {
			Some(Ok(Some(chunk))) => out.write_all(&chunk).await.map_err(write_error)?,
			Some(Ok(None)) => return out.flush().await.map_err(write_error),
			_ => return Err("terminated".to_owned()),
		}
	}
}

/// `work`, or None once the server has been silent for SILENCE_LIMIT_MS.
async fn within<T>(work: impl Future<Output = T>) -> Option<T> {
	tokio::select! {
		out = work => Some(out),
		() = clock::sleep(SILENCE_LIMIT_MS) => None,
	}
}

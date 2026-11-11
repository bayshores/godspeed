use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use gs_json::{Json, json};

use crate::model::{ModelDownload, SILENCE_LIMIT_MS, WHISPER_MODEL_URL};
use crate::test_support::{Sandbox, golden};

/// Downloads take turns: one test moves the app clock, which would end another's waits.
static DOWNLOADS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Clone, Copy)]
enum Reply {
	Bytes(&'static str),
	Status(u16),
	/// Promises 100 bytes, sends 3 and hangs up.
	Cut,
	/// Hangs up without answering.
	Hangup,
	/// Reads the request and never answers.
	Silent,
	/// Promises 100 bytes, sends 3 and goes quiet.
	Stall,
}

/// A local server answering each connection with the next reply (the last repeats). Returns its
/// URL and how many connections it has seen.
fn serve(replies: Vec<Reply>) -> (String, Arc<AtomicUsize>) {
	let listener = TcpListener::bind("127.0.0.1:0").unwrap();
	let url = format!("http://{}/model.bin", listener.local_addr().unwrap());
	let hits = Arc::new(AtomicUsize::new(0));
	let seen = hits.clone();
	std::thread::spawn(move || {
		let mut held = Vec::new();
		for stream in listener.incoming() {
			let Ok(mut stream) = stream else { break };
			let reply = replies[seen.fetch_add(1, Ordering::SeqCst).min(replies.len() - 1)];
			let mut request = [0; 4096];
			let _ = stream.read(&mut request);
			let answer = match reply {
				Reply::Bytes(body) => format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()),
				Reply::Status(code) => format!("HTTP/1.1 {code} Stand-in\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"),
				Reply::Cut | Reply::Stall => "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\nabc".to_owned(),
				Reply::Hangup | Reply::Silent => String::new(),
			};
			let _ = stream.write_all(answer.as_bytes());
			if matches!(reply, Reply::Silent | Reply::Stall) {
				held.push(stream);
			}
		}
	});
	(url, hits)
}

#[derive(Clone, Copy)]
enum Before {
	Nothing,
	ModelOnDisk,
	ModelsIsAFile,
}

/// The golden's case: `replies`, `calls` callers at once, repeated `rounds` times.
async fn download_case(replies: Vec<Reply>, calls: usize, before: Before, rounds: usize) -> Json {
	let sandbox = Sandbox::new();
	let models = sandbox.paths.data.join("models");
	std::fs::remove_dir_all(&models).unwrap();
	match before {
		Before::Nothing => {}
		Before::ModelOnDisk => {
			std::fs::create_dir_all(&models).unwrap();
			gs_base::fsx::write_text_atomic(&models.join("ggml-base.en.bin"), "on disk").unwrap();
		}
		Before::ModelsIsAFile => gs_base::fsx::write_text_atomic(&models, "x").unwrap(),
	}
	let (url, hits) = serve(replies);
	let download = Arc::new(ModelDownload::default());
	let mut results = Vec::new();
	for _ in 0..rounds {
		// Spawned in order, so every caller reaches the shared download before it can finish.
		let round: Vec<_> = (0..calls)
			.map(|_| {
				let (download, paths, url) = (download.clone(), sandbox.paths.clone(), url.clone());
				tokio::spawn(async move { download.ensure_from(&paths, &url).await })
			})
			.collect();
		for handle in round {
			let result = handle.await.unwrap();
			results.push(match result {
				Ok(path) => json!({ "path": sandbox.tidy(&path.to_string_lossy()) }),
				Err(message) => json!({ "error": sandbox.tidy(&message) }),
			});
		}
	}
	let names = models.is_dir().then(|| {
		let mut names: Vec<String> = std::fs::read_dir(&models).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
		names.sort();
		names
	});
	json!({
		"results": results,
		"fetches": hits.load(Ordering::SeqCst),
		"models": names,
		"content": std::fs::read_to_string(models.join("ggml-base.en.bin")).ok(),
	})
}

#[tokio::test]
async fn downloads_match_node() {
	let _turn = DOWNLOADS.lock().await;
	use Before::{ModelOnDisk, ModelsIsAFile, Nothing};
	use Reply::{Bytes, Cut, Hangup, Status};
	let expected = golden("ensureWhisperModel downloads");
	let cases: [(&str, Vec<Reply>, usize, Before, usize); 12] = [
		("ok", vec![Bytes("model bytes")], 1, Nothing, 1),
		("http503", vec![Status(503)], 1, Nothing, 1),
		("http404", vec![Status(404)], 1, Nothing, 1),
		("http204", vec![Status(204)], 1, Nothing, 1),
		("fetchFails", vec![Hangup], 1, Nothing, 1),
		("bodyBreaks", vec![Cut], 1, Nothing, 1),
		("alreadyThere", vec![Bytes("never")], 1, ModelOnDisk, 1),
		("modelsIsAFile", vec![Bytes("never")], 1, ModelsIsAFile, 1),
		("shared", vec![Bytes("model bytes")], 3, Nothing, 1),
		("sharedFailure", vec![Status(503)], 3, Nothing, 1),
		("retryAfterFailure", vec![Status(503), Bytes("model bytes")], 1, Nothing, 2),
		("sharedThenRetry", vec![Status(503), Bytes("model bytes")], 2, Nothing, 2),
	];
	for (name, replies, calls, before, rounds) in cases {
		assert_eq!(download_case(replies, calls, before, rounds).await, expected[name], "{name}");
	}
}

#[tokio::test]
async fn a_downloaded_model_is_not_downloaded_again() {
	let _turn = DOWNLOADS.lock().await;
	let got = download_case(vec![Reply::Bytes("model bytes")], 1, Before::Nothing, 2).await;
	assert_eq!(got["fetches"], Json::from(1));
	assert_eq!(got["results"][1], got["results"][0]);
}

#[tokio::test]
async fn a_model_on_disk_is_returned_without_a_request_and_the_real_url_is_huggingfaces() {
	assert_eq!(WHISPER_MODEL_URL, "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin");
	let sandbox = Sandbox::new();
	let found = ModelDownload::default().ensure_whisper_model(&sandbox.paths).await.unwrap();
	assert_eq!(found, sandbox.paths.data.join("models/ggml-base.en.bin"));
}

#[tokio::test(flavor = "multi_thread")]
#[allow(clippy::disallowed_methods)] // real waits: the server is a real thread
async fn a_server_that_goes_quiet_fails_like_nodes_fetch() {
	let _turn = DOWNLOADS.lock().await;
	for (reply, error) in [(Reply::Silent, "fetch failed"), (Reply::Stall, "terminated")] {
		let sandbox = Sandbox::new();
		let models = sandbox.paths.data.join("models");
		std::fs::remove_dir_all(&models).unwrap();
		let (url, hits) = serve(vec![reply]);
		let task = tokio::spawn({
			let paths = sandbox.paths.clone();
			async move { ModelDownload::default().ensure_from(&paths, &url).await }
		});
		let in_body = || std::fs::read_dir(&models).is_ok_and(|mut names| names.next().is_some());
		while hits.load(Ordering::SeqCst) == 0 || (matches!(reply, Reply::Stall) && !in_body()) {
			std::thread::sleep(std::time::Duration::from_millis(10));
		}
		while !task.is_finished() {
			gs_base::clock::advance(SILENCE_LIMIT_MS);
			std::thread::sleep(std::time::Duration::from_millis(10));
		}
		assert_eq!(task.await.unwrap(), Err(error.to_owned()));
		assert_eq!(std::fs::read_dir(&models).unwrap().count(), 0, "the half download is removed");
	}
}

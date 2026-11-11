use std::path::{Path, PathBuf};

use gs_json::{Json, json};

use crate::model::ModelDownload;
use crate::run::{TranscribeError, transcribe_with};
use crate::test_support::{Sandbox, golden, install};

async fn transcribe(sandbox: &Sandbox, recording: &Path, out_file: &Path) -> Result<String, TranscribeError> {
	transcribe_with(&ModelDownload::default(), &sandbox.paths, Some(&sandbox.path_env()), &[], recording, out_file).await
}

/// What the golden records for one recording: the result, the file written, the programs' calls
/// and what is left in the temp folder.
async fn outcome(sandbox: &Sandbox, name: &str, out_file: &Path) -> Json {
	let result = transcribe(sandbox, &sandbox.recordings.join(name), out_file).await;
	let written = (out_file.is_file()).then(|| std::fs::read_to_string(out_file).unwrap());
	let head = match result {
		Ok(text) => json!({ "text": text }),
		Err(err) => json!({ "error": sandbox.tidy(&err.to_string()), "missing": matches!(err, TranscribeError::WhisperMissing(_)) }),
	};
	let mut all = head.as_obj().unwrap().clone();
	all.insert("written", written);
	all.insert("calls", sandbox.tidy(&sandbox.calls()));
	all.insert("tmpLeft", sandbox.tmp_entries());
	Json::Obj(all)
}

#[tokio::test]
async fn every_recording_matches_node() {
	let expected = golden("transcribeRecording");
	for (name, want) in expected.as_obj().unwrap() {
		let sandbox = Sandbox::new();
		let got = outcome(&sandbox, name, &sandbox.out.join(format!("{name}.txt"))).await;
		assert_eq!(got, *want, "recording {name}");
	}
}

#[tokio::test]
async fn output_file_cases_match_node() {
	let expected = golden("transcribeRecording output file");
	type OutputCase = (&'static str, fn(&Sandbox) -> PathBuf, fn(&Sandbox));
	let cases: [OutputCase; 4] = [
		("nested", |s| s.out.join("a/b/c.txt"), |_| {}),
		("overwritten", |s| s.out.join("talk.mp3.txt"), |s| {
			std::fs::create_dir_all(&s.out).unwrap();
			gs_base::fsx::write_text_atomic(&s.out.join("talk.mp3.txt"), "old text that is longer than the new one will be, much longer, really\n").unwrap();
		}),
		("underAFile", |s| s.out.join("plain/c.txt"), |s| {
			std::fs::create_dir_all(&s.out).unwrap();
			gs_base::fsx::write_text_atomic(&s.out.join("plain"), "x").unwrap();
		}),
		("ontoAFolder", |s| s.out.join("folder"), |s| std::fs::create_dir_all(s.out.join("folder")).unwrap()),
	];
	for (name, target, before) in cases {
		let sandbox = Sandbox::new();
		before(&sandbox);
		let got = outcome(&sandbox, "talk.mp3", &target(&sandbox)).await;
		assert_eq!(got, expected[name], "{name}");
	}
}

#[tokio::test]
async fn missing_programs_fail_before_anything_is_downloaded_or_made() {
	let sandbox = Sandbox::new();
	std::fs::remove_file(sandbox.root.join("data/models/ggml-base.en.bin")).unwrap();
	std::fs::remove_file(sandbox.bin.join("whisper-cli")).unwrap();
	let err = transcribe(&sandbox, &sandbox.recordings.join("talk.mp3"), &sandbox.out.join("t.txt")).await.unwrap_err();
	assert_eq!(err.to_string(), "Recordings need whisper.cpp and ffmpeg. Run `brew install whisper-cpp ffmpeg`, then retry the file.");
	assert!(matches!(&err, TranscribeError::WhisperMissing(m) if m.missing == ["whisper-cpp"]), "{err:?}");
	assert!(sandbox.tmp_entries().is_empty());
	assert!(!sandbox.out.exists());
}

#[tokio::test]
async fn whisper_cpp_is_used_when_whisper_cli_is_absent_and_the_cli_wins_when_both_exist() {
	let sandbox = Sandbox::new();
	install(&sandbox.bin.join("whisper-cpp"), "#!/bin/sh\necho used-cpp >> \"$(dirname \"$0\")/calls.log\"\nexit 1\n");
	let out = sandbox.out.join("t.txt");
	assert!(transcribe(&sandbox, &sandbox.recordings.join("talk.mp3"), &out).await.is_ok());
	assert!(!sandbox.calls().contains("used-cpp"));
	std::fs::rename(sandbox.bin.join("whisper-cli"), sandbox.root.join("whisper-cli.off")).unwrap();
	let err = transcribe(&sandbox, &sandbox.recordings.join("talk.mp3"), &out).await.unwrap_err().to_string();
	assert!(sandbox.calls().contains("used-cpp"));
	let start = "whisper-cpp failed: Command failed: <root>/bin/whisper-cpp -m <root>/data/models/ggml-base.en.bin -f <root>/tmp/godspeed-transcribe-XXXXXX/audio.wav";
	assert!(sandbox.tidy(&err).starts_with(start), "{err}");
}

#[tokio::test]
async fn a_missing_temp_folder_reads_like_nodes_mkdtemp_error() {
	let sandbox = Sandbox::new();
	std::fs::remove_dir(sandbox.root.join("tmp")).unwrap();
	let err = transcribe(&sandbox, &sandbox.recordings.join("talk.mp3"), &sandbox.out.join("t.txt")).await.unwrap_err();
	assert_eq!(sandbox.tidy(&err.to_string()), "ENOENT: no such file or directory, mkdtemp '<root>/tmp/godspeed-transcribe-XXXXXX'");
}

#[tokio::test]
async fn the_work_folder_is_private_and_two_runs_do_not_mix() {
	let sandbox = Sandbox::new();
	install(&sandbox.bin.join("ffmpeg"), "#!/bin/sh\nfor a in \"$@\"; do last=\"$a\"; done\nls -ld \"$(dirname \"$last\")\" > \"$(dirname \"$0\")/mode.txt\"\nprintf 'RIFFSTUB %s' \"$last\" > \"$last\"\n");
	let (a, b) = (sandbox.out.join("a.txt"), sandbox.out.join("b.txt"));
	let (rec_a, rec_b) = (sandbox.recordings.join("a.mp3"), sandbox.recordings.join("b.mp3"));
	let (one, two) = tokio::join!(transcribe(&sandbox, &rec_a, &a), transcribe(&sandbox, &rec_b, &b));
	assert!(one.is_ok() && two.is_ok());
	assert!(std::fs::read_to_string(sandbox.bin.join("mode.txt")).unwrap().starts_with("drwx------"));
	assert!(sandbox.tmp_entries().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
#[allow(clippy::disallowed_methods)] // real waits: this watches a real process
async fn dropping_the_future_stops_the_program_and_removes_the_work_folder() {
	let sandbox = Sandbox::new();
	install(&sandbox.bin.join("ffmpeg"), "#!/bin/sh\necho $$ > \"$(dirname \"$0\")/pid\"\nexec sleep 30\n");
	let task = tokio::spawn({
		let (paths, path_env, recording, out) = (sandbox.paths.clone(), sandbox.path_env(), sandbox.recordings.join("talk.mp3"), sandbox.out.join("t.txt"));
		async move { transcribe_with(&ModelDownload::default(), &paths, Some(&path_env), &[], &recording, &out).await }
	});
	let pid_file = sandbox.bin.join("pid");
	while !pid_file.exists() || std::fs::read_to_string(&pid_file).unwrap().is_empty() {
		std::thread::sleep(std::time::Duration::from_millis(10));
	}
	assert_eq!(sandbox.tmp_entries().len(), 1);
	task.abort();
	assert!(task.await.unwrap_err().is_cancelled());
	let pid = std::fs::read_to_string(&pid_file).unwrap().trim().to_owned();
	let mut gone = false;
	for _ in 0..500 {
		let state = std::process::Command::new("ps").args(["-o", "stat=", "-p", &pid]).output().unwrap();
		let state = String::from_utf8_lossy(&state.stdout).trim().to_owned();
		if state.is_empty() || state.starts_with('Z') {
			gone = true;
			break;
		}
		std::thread::sleep(std::time::Duration::from_millis(10));
	}
	assert!(gone, "the program is still running");
	assert!(sandbox.tmp_entries().is_empty());
	assert!(!sandbox.out.exists());
}


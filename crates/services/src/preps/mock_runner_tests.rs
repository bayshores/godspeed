//! Run examples on this computer: a right answer passes, a wrong one says what it returned,
//! broken code says why, a loop is stopped, and only the learner's own function is ever called.

use gs_base::re::Re;

use super::*;

fn question() -> Json {
	json!({
		"id": "q1",
		"title": "Add",
		"statement": "Add two numbers.",
		"kind": "code",
		"fn": { "name": "add", "params": ["a", "b"] },
		"examples": [{ "args": "[1,2]", "expected": "3" }, { "args": "[-1,1]", "expected": "0" }],
	})
}

fn with_fn(name: &str, params: &[&str], examples: Json) -> Json {
	let mut q = question();
	q.as_obj_mut().unwrap().insert("fn", json!({ "name": name, "params": params }));
	if !examples.is_null() {
		q.as_obj_mut().unwrap().insert("examples", examples);
	}
	q
}

async fn js(question: &Json, code: &str) -> Json {
	run_examples(&std::env::temp_dir(), question, code, MockLanguage::Javascript, None).await.unwrap()
}

#[tokio::test]
async fn a_right_javascript_answer_passes_and_what_it_printed_is_kept() {
	let run = js(&question(), "function add(a, b) { console.log('adding'); return a + b; }").await;
	assert_eq!(run["examples"], json!([{ "returned": "3", "passed": true }, { "returned": "0", "passed": true }]));
	assert_eq!(run["printed"], Json::from("adding\nadding"));
}

#[tokio::test]
async fn a_wrong_answer_says_what_it_returned_and_what_one_threw() {
	let wrong = js(&question(), "const add = (a, b) => a - b;").await;
	assert_eq!(wrong["examples"], json!([{ "returned": "-1", "passed": false }, { "returned": "-2", "passed": false }]));
	let threw = js(&question(), "function add() { throw new RangeError('no'); }").await;
	assert_eq!(threw["examples"][0], json!({ "error": "RangeError: no", "passed": false }));
}

#[tokio::test]
async fn code_that_doesnt_parse_says_why_without_the_temp_folders_path() {
	let run = js(&question(), "function add(a, b) { return a +").await;
	assert_eq!(run["examples"], json!([]));
	let error = run["error"].as_str().unwrap();
	assert!(error.starts_with("solution.js:") && error.contains("SyntaxError"), "{error}");
	// "export" makes Node read the file as a module, which names it by URL.
	let as_module = js(&question(), "export function add(a, b) {\n  return a +;\n}").await;
	let error = as_module["error"].as_str().unwrap();
	assert!(error.contains("SyntaxError"), "{error}");
	assert!(Re::new(r"^solution\.js:\d", "").test(error), "no file:// before the name: {error}");
}

#[tokio::test]
async fn code_that_never_ends_is_stopped() {
	let run = js(&question(), "function add() { while (true) {} }").await;
	assert_eq!(run["error"], Json::from("Your code ran for more than 5 seconds and was stopped."));
}

#[tokio::test]
async fn a_built_in_of_the_functions_name_is_never_called() {
	let evil = with_fn("eval", &["code"], json!([{ "args": "[\"console.log('RAN')\"]", "expected": "null" }, { "args": "[\"1\"]", "expected": "1" }]));
	let run = js(&evil, "// nothing written yet").await;
	let none = json!({ "error": "Your code has no function named eval.", "passed": false });
	assert_eq!(run["examples"], json!([none, none]));
	assert!(run.get("printed").is_none());
	let own = js(&with_fn("fetch", &["a", "b"], Json::Null), "function fetch(a, b) { return a + b; }").await;
	assert_eq!(own["examples"], json!([{ "returned": "3", "passed": true }, { "returned": "0", "passed": true }]), "the learner's own function of that name runs");
}

#[test]
fn godspeeds_own_settings_stay_out_of_the_learners_program() {
	let vars = [("LH_DESKTOP_API_SECRET", "s"), ("lh_data_dir", "d"), ("NODE_OPTIONS", "--x"), ("NODE_COMPILE_CACHE", "/c"), ("PYTHONIOENCODING", "latin-1"), ("PATH", "/bin"), ("HOME", "/h")];
	let env = run_env(vars.into_iter().map(|(k, v)| (k.into(), v.into())));
	let env: Vec<(String, String)> = env.into_iter().map(|(k, v)| (k.to_string_lossy().into_owned(), v.to_string_lossy().into_owned())).collect();
	assert_eq!(env, [("PATH", "/bin"), ("HOME", "/h"), ("PYTHONIOENCODING", "utf-8")].map(|(k, v)| (k.to_owned(), v.to_owned())));
}

#[tokio::test]
async fn the_program_gets_nothing_to_read_and_pythons_prints_in_utf8() {
	let read = js(&question(), "function add() { return require('node:fs').readFileSync(0, 'utf8'); }").await;
	assert_eq!(read["examples"][0], json!({ "returned": "\"\"", "passed": false }), "stdin is closed, so reading it ends at once");
	let env = js(&question(), "function add() { return [process.env.PYTHONIOENCODING, process.env.NODE_COMPILE_CACHE ?? null, Object.keys(process.env).filter((k) => k.startsWith('LH_'))]; }").await;
	assert_eq!(env["examples"][0], json!({ "returned": "[\"utf-8\",null,[]]", "passed": false }));
}

#[cfg(unix)]
#[tokio::test]
async fn every_process_the_learners_program_started_is_ended_however_the_run_ends() {
	let dir = std::env::temp_dir().join(format!("gs-mock-runner-{}", ids::uuid()));
	std::fs::create_dir_all(&dir).unwrap();
	let pid_file = dir.join("pids");
	// Starts a sleeping child that shares the run's output and doesn't keep the program waiting,
	// and notes its pid.
	let starts = |then: &str| {
		format!(
			"function add(a, b) {{ const c = require('node:child_process').spawn('sleep', ['30'], {{ stdio: 'inherit' }}); c.unref(); require('node:fs').appendFileSync({}, c.pid + '\\n'); {then} }}",
			gs_json::quote(&pid_file.to_string_lossy())
		)
	};
	let alive = |pid: &str| std::process::Command::new("/bin/kill").args(["-0", pid]).stderr(Stdio::null()).status().is_ok_and(|s| s.success());
	let gone = || async {
		let text = std::fs::read_to_string(&pid_file).unwrap();
		std::fs::remove_file(&pid_file).unwrap();
		let pids: Vec<&str> = text.trim().split('\n').collect();
		assert!(!pids.is_empty());
		for _ in 0..50 {
			if !pids.iter().any(|p| alive(p)) {
				break;
			}
			clock::sleep(20).await;
		}
		assert!(!pids.iter().any(|p| alive(p)), "no child is left running");
	};

	let t0 = clock::now_ms();
	let finished = js(&question(), &starts("return a + b;")).await;
	assert_eq!(finished["examples"], json!([{ "returned": "3", "passed": true }, { "returned": "0", "passed": true }]));
	assert!(clock::now_ms() - t0 < 4000, "a child holding the output open doesn't keep the run waiting");
	gone().await;

	let looped = js(&question(), &starts("while (true) {}")).await;
	assert!(looped["error"].str_or_empty().contains("more than 5 seconds"));
	gone().await;

	// Written at once: process.stdout queues behind a busy loop on a Mac's pipe.
	let loud = js(&question(), &starts("while (true) try { require('node:fs').writeSync(1, 'x'.repeat(65536)); } catch {}")).await;
	assert_eq!(loud["error"], Json::from("Your code printed too much and was stopped."));
	gone().await;

	let request = Abort::new();
	let stop = request.clone();
	tokio::spawn(async move {
		clock::sleep(500).await;
		stop.abort();
	});
	let left = run_examples(&std::env::temp_dir(), &question(), &starts("while (true) {}"), MockLanguage::Javascript, Some(&request)).await.unwrap();
	assert_eq!(left["error"], Json::from("The run was stopped."));
	gone().await;
	std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_run_ends_its_whole_process_group_or_on_windows_its_process_tree_while_the_program_runs() {
	assert_eq!(stop_command(4242, "darwin", true), Some(Stop::Group(4242)));
	assert_eq!(stop_command(4242, "linux", false), Some(Stop::Group(4242)), "the group outlives the program while a child of it runs");
	assert_eq!(stop_command(4242, "win32", true), Some(Stop::Command(["taskkill", "/T", "/F", "/PID", "4242"].map(str::to_owned).to_vec())));
	assert_eq!(stop_command(4242, "win32", false), None, "an ended program's pid may be another program's");
}

#[test]
fn a_python_that_only_opens_an_installer_is_passed_over() {
	let (yes, no) = (|| true, || false);
	assert!(is_stand_in_python("/usr/bin/python3", "darwin", &no), "a Mac without developer tools");
	assert!(!is_stand_in_python("/usr/bin/python3", "darwin", &yes));
	assert!(!is_stand_in_python("/opt/homebrew/bin/python3", "darwin", &no));
	assert!(is_stand_in_python("C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe", "win32", &yes));
	assert!(!is_stand_in_python("C:\\Python312\\python.exe", "win32", &yes));
	assert!(!is_stand_in_python("/usr/bin/python3", "linux", &no));
}

#[test]
fn a_folder_is_named_by_url_as_node_names_it() {
	assert_eq!(file_url("/private/var/folders/x_y/T/godspeed-run-aB3/"), "file:///private/var/folders/x_y/T/godspeed-run-aB3/");
	assert_eq!(file_url("/tmp/a b#c%d/é/"), "file:///tmp/a%20b%23c%25d/%C3%A9/");
}

#[tokio::test]
async fn python_runs_when_this_computer_has_it_and_never_its_built_ins() {
	let python = |question: Json, code: &'static str| async move { run_examples(&std::env::temp_dir(), &question, code, MockLanguage::Python, None).await.unwrap() };
	let run = python(question(), "def add(a, b):\n    return a + b\n").await;
	if run["error"].str_or_empty().contains("couldn't find Python") {
		return;
	}
	assert_eq!(run["examples"], json!([{ "returned": "3", "passed": true }, { "returned": "0", "passed": true }]));
	let evil = with_fn("exec", &["code"], json!([{ "args": "[\"print('RAN')\"]", "expected": "null" }, { "args": "[\"1\"]", "expected": "null" }]));
	let refused = python(evil, "x = 1\n").await;
	assert_eq!(refused["examples"][0]["error"], Json::from("Your code has no function named exec."));
	assert!(refused.get("printed").is_none());
	let asks = python(question(), "def add(a, b):\n    print('→')\n    return int(input())\n").await;
	assert_eq!(asks["printed"], Json::from("→\n→"));
	assert!(asks["examples"][0]["error"].str_or_empty().starts_with("EOFError"), "input() ends at once");
}

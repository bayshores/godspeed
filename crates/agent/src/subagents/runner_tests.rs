use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::events::Events;
use gs_base::locks::Locks;
use gs_runtime::fake::{FakeAgent, FakeStep};
use gs_runtime::{Ask, Usage, Verdict};
use gs_store::jobs::CreateJobInit;

use super::*;
use crate::subagents::aborts::{fire_job_abort, is_job_live};
use crate::subagents::headless::DemoRunResult;
use crate::subagents::test_support::{FakeHeadless, on, says, tool};

struct Host {
	dir: PathBuf,
	jobs: JobStore,
	chats: ChatStore,
	agent: FakeAgent,
	pdf: Pdf,
	aborts: JobAborts,
	tmp: PathBuf,
	headless: Arc<dyn HeadlessApi>,
	delivered: Mutex<Vec<Json>>,
	activity: Mutex<Vec<String>>,
	/// The lessons asked to allow something, with what.
	asked: Arc<Mutex<Vec<(String, Ask)>>>,
}

impl JobHost for Host {
	fn job_store(&self) -> &JobStore {
		&self.jobs
	}
	fn chat_store(&self) -> &ChatStore {
		&self.chats
	}
	fn job_agent(&self) -> Arc<dyn JobAgent> {
		on(self.agent.clone())
	}
	fn approve(&self, chat_id: &str) -> Approve {
		let (asked, chat_id) = (self.asked.clone(), chat_id.to_owned());
		Arc::new(move |ask| {
			asked.lock().push((chat_id.clone(), ask));
			Box::pin(async { Verdict { allow: true, message: None } })
		})
	}
	fn pdf(&self) -> &Pdf {
		&self.pdf
	}
	fn job_aborts(&self) -> &JobAborts {
		&self.aborts
	}
	fn tmp_dir(&self) -> &Path {
		&self.tmp
	}
	fn headless(&self) -> Arc<dyn HeadlessApi> {
		self.headless.clone()
	}
	fn search_key(&self) -> Option<String> {
		None
	}
	fn deliver(&self, steer: Json) -> BoxFuture<'static, Result<(), String>> {
		self.delivered.lock().push(steer);
		Box::pin(async { Err("no lesson in this test".to_owned()) })
	}
	fn kept_pages(&self, _path: &Path) -> BoxFuture<'static, Option<KeptPages>> {
		Box::pin(async { None })
	}
	fn keep_page(&self, _file: &KeptPages, _page: u32, _markdown: &str) -> Result<(), String> {
		Err("no space in this test".to_owned())
	}
	fn job_activity(&self, job_id: &str, line: &str) {
		assert_eq!(self.jobs.get_job(job_id).unwrap()["activity"], Json::from(line), "told once the line is saved");
		self.activity.lock().push(line.to_owned());
	}
}

impl Drop for Host {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.dir);
	}
}

fn setup(name: &str, turns: Vec<Vec<FakeStep>>, demo: Result<DemoRunResult, String>) -> Arc<Host> {
	let dir = std::env::temp_dir().join(format!("gs-runner-{name}-{}", std::process::id()));
	let _ = std::fs::remove_dir_all(&dir);
	let tmp = dir.join("tmp");
	std::fs::create_dir_all(&tmp).unwrap();
	let paths = Paths::new(dir.join("data"), dir.join("home"), tmp.clone(), dir.join("res"));
	let (events, locks) = (Events::new(), Locks::new());
	Arc::new(Host {
		jobs: JobStore::new(&paths, &events, &locks),
		chats: ChatStore::new(&paths, &events, &locks),
		agent: FakeAgent::new(turns),
		pdf: Pdf::new(&dir.join("res")),
		aborts: JobAborts::default(),
		tmp,
		headless: FakeHeadless::new(demo),
		delivered: Mutex::new(Vec::new()),
		activity: Mutex::new(Vec::new()),
		asked: Arc::default(),
		dir,
	})
}

/// A lesson and a running job of `kind` in it.
fn job(host: &Host, kind: &str, input: Option<Json>) -> String {
	let chat = host.chats.create_chat("Lesson", None, None, None, &[]).unwrap();
	let init = CreateJobInit { kind, chat_id: chat["id"].as_str().unwrap(), tool_call_id: "call_job", activity: None, input };
	host.jobs.create_job(&init).unwrap()["id"].as_str().unwrap().to_owned()
}

async fn run(host: &Arc<Host>, id: &str) -> Json {
	create_job_runner(host.clone()).run_job(id.to_owned(), None).await;
	(*host.jobs.get_job(id).unwrap()).clone()
}

fn no_demo() -> Result<DemoRunResult, String> {
	Err("no browser".to_owned())
}

const USED: Usage = Usage { input: 900, cached: 700, output: 60 };

#[tokio::test]
async fn a_demo_job_saves_its_result_usage_and_pending_delivery() {
	let curl = FakeStep::Approval { tool: "Bash".to_owned(), input: json!({ "command": "curl https://cdn.example/plot.js" }) };
	let turn = vec![FakeStep::Usage(USED), curl, FakeStep::Calls(vec![("write_demo".to_owned(), json!({ "html": "<p/>" })), ("run_demo".to_owned(), json!({}))]), FakeStep::Usage(USED), says("A dot.")];
	let host = setup("demo-done", vec![turn], Ok(DemoRunResult { ok: true, ..Default::default() }));
	let id = job(&host, "demo", Some(json!({ "title": "Dot", "brief": "A dot." })));
	let record = run(&host, &id).await;
	assert_eq!(record["status"], Json::from("done"));
	assert_eq!(record["activity"], Json::from("finished"));
	assert_eq!(record["result"], json!({ "title": "Dot", "html": "<p/>", "tested": true, "notes": "A dot." }));
	assert_eq!(record["delivery"], json!({ "kind": "result", "status": "pending" }));
	assert_eq!(record["usage"]["model"], Json::from("agent:outside-agent"));
	assert_eq!(record["usage"]["steps"], Json::from(2));
	assert!(record.get("error").is_none());
	assert_eq!(host.activity.lock().first().map(String::as_str), Some("write_demo"), "the host hears each activity line");
	let delivered = host.delivered.lock();
	assert_eq!(delivered.len(), 1);
	assert_eq!(delivered[0]["id"], Json::from(format!("steer_{id}")));
	assert!(!is_job_live(&host.aborts, &id));
	let chat_id = record["chatId"].as_str().unwrap();
	assert_eq!(*host.asked.lock(), [(chat_id.to_owned(), Ask::Tool { name: "Bash".to_owned(), input: json!({ "command": "curl https://cdn.example/plot.js" }) })], "the lesson that asked is asked to allow it");
}

#[tokio::test]
async fn a_failed_demo_records_its_notes_as_the_error() {
	let host = setup("demo", vec![vec![says("Nothing could be built.")]], no_demo());
	let id = job(&host, "demo", Some(json!({ "title": "Stepper", "brief": "Step." })));
	let record = run(&host, &id).await;
	assert_eq!(record["status"], Json::from("error"));
	assert_eq!(record["activity"], Json::from("failed"));
	assert_eq!(record["error"], Json::from("FAILED: the builder never wrote a demo. (Nothing could be built.)"));
	assert_eq!(record["result"]["title"], Json::from("Stepper"));
}

#[tokio::test]
async fn a_pdf_job_error_drops_the_failure_prefix() {
	let host = setup("pdf", Vec::new(), no_demo());
	let missing = host.dir.join("missing.pdf").to_string_lossy().into_owned();
	let id = job(&host, "pdf", Some(json!({ "path": format!("  {missing} "), "question": 5 })));
	let record = run(&host, &id).await;
	assert_eq!(record["error"], Json::from(format!("ENOENT: no such file or directory, stat '{missing}'")));
	assert_eq!(record["result"]["question"], Json::from(""));
	assert_eq!(record["result"]["path"], Json::from(missing));
}

#[tokio::test]
async fn a_pdf_job_in_a_protected_place_fails_with_the_denial() {
	let host = setup("pdf-protected", Vec::new(), no_demo());
	let id = job(&host, "pdf", Some(json!({ "path": "~/.aws/credentials.pdf", "question": "" })));
	let record = run(&host, &id).await;
	assert_eq!(record["error"], Json::from("Access denied: ~/.aws/credentials.pdf is a protected location."));
}

#[tokio::test]
async fn research_failures_and_sources() {
	let host = setup("research", Vec::new(), no_demo());
	let id = job(&host, "research", Some(json!({ "context": "no question" })));
	let record = run(&host, &id).await;
	assert_eq!(record["error"], Json::from("research question unavailable"));
	assert_eq!(record["result"], json!({ "brief": "Research failed: the research question is unavailable.", "sources": [] }));

	// A url that is not text breaks the activity line, and with it the whole run.
	let host = setup("research-number", vec![vec![tool("web_fetch", json!({ "url": 5 }))]], no_demo());
	let id = job(&host, "research", Some(json!({ "question": "Q?" })));
	let record = run(&host, &id).await;
	assert_eq!(record["result"], json!({ "brief": "Research failed: e.slice is not a function", "sources": [] }));
	assert_eq!(record["error"], Json::from("e.slice is not a function"));

	let host = setup("research-sources", vec![vec![tool("web_fetch", json!({ "url": "not a url" })), says("  ## Summary\nNothing found.  ")]], no_demo());
	let id = job(&host, "research", Some(json!({ "question": "Q?", "context": " " })));
	let record = run(&host, &id).await;
	assert_eq!(record["status"], Json::from("done"));
	assert_eq!(record["result"], json!({ "brief": "## Summary\nNothing found.", "sources": [{ "title": "not a url", "url": "not a url" }] }));
	let leftovers: Vec<_> = std::fs::read_dir(&host.tmp).unwrap().collect();
	assert!(leftovers.is_empty(), "the PDF folder goes with the job");

	let host = setup("research-empty", vec![vec![says("   ")]], no_demo());
	let id = job(&host, "research", Some(json!({ "question": "Q?" })));
	assert_eq!(run(&host, &id).await["error"], Json::from("the researcher produced no text"));
}

#[tokio::test]
async fn unknown_kinds_missing_lessons_and_finished_jobs() {
	let host = setup("odd", Vec::new(), no_demo());
	let id = job(&host, "poem", None);
	let record = run(&host, &id).await;
	assert_eq!((record["status"].clone(), record["error"].clone()), (Json::from("error"), Json::from("unknown kind poem")));

	let init = CreateJobInit { kind: "demo", chat_id: "chat_gone", tool_call_id: "c", activity: None, input: None };
	let id = host.jobs.create_job(&init).unwrap()["id"].as_str().unwrap().to_owned();
	let record = run(&host, &id).await;
	assert_eq!(record["error"], Json::from("Chat not found: chat_gone"));
	assert!(host.delivered.lock().is_empty());

	host.jobs.update_job(&id, &json!({ "status": "done", "error": null })).unwrap();
	assert_eq!(run(&host, &id).await["status"], Json::from("done"), "a finished job is left alone");
}

#[tokio::test]
async fn the_input_falls_back_to_the_transcript() {
	let host = setup("transcript", Vec::new(), no_demo());
	let id = job(&host, "demo", None);
	let chat_id = host.jobs.get_job(&id).unwrap()["chatId"].as_str().unwrap().to_owned();
	let call = json!({ "type": "toolCall", "id": "call_job", "name": "demo", "arguments": { "brief": "From the record." } });
	host.chats.save_messages(&chat_id, &[json!({ "role": "assistant", "content": [call] })]).unwrap();
	let runner = create_job_runner(host.clone());
	let job_record = host.jobs.get_job(&id).unwrap();
	assert_eq!(runner.resolve_input(&job_record, None), Some(json!({ "brief": "From the record." })));
	assert_eq!(runner.resolve_input(&job_record, Some(json!(1))), Some(json!(1)));
}

#[tokio::test]
async fn an_aborted_job_unwinds_without_writing_an_outcome() {
	let host = setup("abort", vec![vec![FakeStep::Silence]], no_demo());
	let id = job(&host, "demo", Some(json!({ "brief": "x" })));
	let task = gs_base::tasks::spawn("test", create_job_runner(host.clone()).run_job(id.clone(), None));
	while !is_job_live(&host.aborts, &id) {
		tokio::task::yield_now().await;
	}
	// The abort route flips the record first, then kills the loop.
	host.jobs.update_job(&id, &json!({ "status": "error", "error": "Aborted by learner" })).unwrap();
	assert!(fire_job_abort(&host.aborts, &id));
	task.await.unwrap();
	let record = host.jobs.get_job(&id).unwrap();
	assert_eq!(record["error"], Json::from("Aborted by learner"));
	assert!(record.get("result").is_none());
	assert!(host.delivered.lock().is_empty());
	assert!(!is_job_live(&host.aborts, &id));
}

#[test]
fn hosts_like_the_url_parser() {
	let host = |v: Json| host_of(&v);
	assert_eq!(host(json!("http://127.0.0.1:9/never")), Ok("127.0.0.1".to_owned()));
	assert_eq!(host(json!("HTTPS://User:pw@Example.COM:443/a?b#c")), Ok("example.com".to_owned()));
	assert_eq!(host(json!("ftp://example.com/file.txt")), Ok("example.com".to_owned()));
	assert_eq!(host(json!("file:///etc/hosts")), Ok(String::new()));
	assert_eq!(host(json!("http:example.com")), Ok("example.com".to_owned()));
	assert_eq!(host(json!("http://[::1]:80/")), Ok("[::1]".to_owned()));
	assert_eq!(host(json!("mailto:a@b.c")), Ok(String::new()));
	assert_eq!(host(json!("not a url")), Ok("not a url".to_owned()));
	assert_eq!(host(json!("http://a b/")), Ok("http://a b/".to_owned()));
	assert_eq!(host(json!("http://x:99999/")), Ok("http://x:99999/".to_owned()));
	assert_eq!(host(json!(format!("nope{}", "x".repeat(50)))), Ok(format!("nope{}", "x".repeat(36))));
	assert_eq!(host(json!("")), Ok("(no url)".to_owned()));
	assert_eq!(host(Json::Null), Ok("(no url)".to_owned()));
	assert_eq!(host(json!(0)), Ok("(no url)".to_owned()));
	assert_eq!(host(json!(5)), Err("e.slice is not a function".to_owned()));
	assert_eq!(activity_line("web_fetch_pdf", &json!({ "url": 5 })), Ok("web_fetch_pdf".to_owned()));
}

#[test]
fn sources_come_from_cited_links_then_fetched_urls() {
	let brief = "See [Docs](https://a.com/x) and [ ](https://b.com) and [Again](https://a.com/x) and [Ftp](ftp://c.com).";
	assert_eq!(parse_sources(brief, &["https://z.com/".to_owned()]), vec![json!({ "title": "Docs", "url": "https://a.com/x" })]);
	let fetched = ["https://z.com/p".to_owned(), "https://z.com/p".to_owned(), "nope".to_owned()];
	assert_eq!(parse_sources("none", &fetched), vec![json!({ "title": "z.com", "url": "https://z.com/p" }), json!({ "title": "nope", "url": "nope" })]);
	let many: Vec<String> = (0..12).map(|i| format!("https://s{i}.com/")).collect();
	assert_eq!(parse_sources("", &many).len(), 10);
}

#[test]
fn failure_shapes_per_kind() {
	assert_eq!(failure_result("demo", Some(&json!({ "title": "  " })), "r"), json!({ "title": "Interactive demo", "html": "", "tested": true, "notes": "FAILED: r" }));
	assert_eq!(failure_result("demo", Some(&json!({ "title": " T " })), "r")["title"], Json::from(" T "));
	assert_eq!(failure_result("research", None, "r"), json!({ "brief": "Research failed: r", "sources": [] }));
}

#[test]
fn temp_folders_are_new_each_time() {
	let dir = std::env::temp_dir().join(format!("gs-runner-mkdtemp-{}", std::process::id()));
	std::fs::create_dir_all(&dir).unwrap();
	let a = make_temp_dir(&dir, "lh-research-").unwrap();
	let b = make_temp_dir(&dir, "lh-research-").unwrap();
	assert_ne!(a, b);
	let name = a.file_name().unwrap().to_string_lossy().into_owned();
	assert!(Re::new("^lh-research-[A-Za-z0-9]{6}$", "").test(&name), "{name}");
	std::fs::remove_dir_all(&dir).unwrap();
}

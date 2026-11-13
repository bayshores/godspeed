//! Parity with the TypeScript lesson prompts and tools (tests/golden/lesson_tools.json, recorded from the Node server): every case is replayed in order on the same stub
//! worlds, and what the Rust side gives must match the recorded value exactly. The compose cases
//! write saved prompt versions into a temp data folder, and the agent case reads the last ones.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_agent::teacher::prompt_segments::{AgentKind, all_segment_paths};
use gs_agent::teacher::teacher_agent::{AgentBuildOptions, compose_instructions, create_homework_agent, create_practice_agent, create_prober_agent, create_study_agent, create_talk_agent, create_teacher_agent};
use gs_agent::tools::space::{SpaceSearch, SpaceToolContext};
use gs_agent::tools::fn_tool::FnTool;
use gs_agent::tools::graph::{GraphToolContext, ScopedGraph};
use gs_agent::tools::homework::{HomeworkDeadline, HomeworkToolContext, homework_tools};
use gs_agent::tools::jobs::JobToolContext;
use gs_agent::tools::lesson::{ProberToolContext, StudyToolContext, TeacherToolContext, prober_tools, study_tools, teacher_tools};
use gs_agent::tools::mermaid_plan::parse_mermaid_plan;
use gs_agent::tools::plan::PlanContext;
use gs_agent::tools::ports::{ChatPort, Deliver, JobPort, Spawn};
use gs_agent::tools::practice::{GraphNodes, PracticeToolContext, practice_tools};
use gs_agent::tools::probe::ProbeDoneContext;
use gs_agent::tools::questions::bare_question_tools;
use gs_agent::tools::rules::SaveRule;
use gs_agent::tools::side::LessonSide;
use gs_agent::tools::talk::{SpaceActions, talk_tools};
use gs_base::config::Paths;
use gs_base::fsx;
use gs_core::spaces::space_tools::{SpaceChange, ToolOutcome};
use gs_core::contracts::space::SPACE_ICONS;
use gs_core::graph::ports::{ChatListing, GraphStore, LedgerRewrite};
use gs_engine::turn::abort::Abort;
use gs_engine::turn::agent::Agent;
use gs_engine::turn::faux::{Engine, Scripted, faux_model};
use gs_engine::turn::tool::{ExecutionMode, Tool, ToolContext};
use gs_json::{Json, Obj, json, parse, stringify};
use gs_search::index::PassageRef;
use gs_store::prompt_overrides::PromptOverrides;
use parking_lot::Mutex;

const FILE_TOOLS: [&str; 4] = ["read", "ls", "find", "grep"];
const KINDS: [(&str, AgentKind); 6] = [
	("prober", AgentKind::Prober),
	("teacher", AgentKind::Teacher),
	("practice", AgentKind::Practice),
	("study", AgentKind::Study),
	("homework", AgentKind::Homework),
	("talk", AgentKind::Talk),
];

// The stub world: the same chats, graphs and stores as the TypeScript golden.

fn tool_call(id: &str, name: &str, args: Json) -> Json {
	json!({ "type": "toolCall", "id": id, "name": name, "arguments": args })
}

fn assistant(id: &str, content: Vec<Json>) -> Json {
	json!({ "id": id, "role": "assistant", "content": content, "api": "x", "provider": "x", "model": "x", "usage": {}, "stopReason": "toolUse", "timestamp": 1 })
}

fn tool_result(id: &str, name: &str, is_error: bool, details: Json) -> Json {
	json!({ "role": "toolResult", "toolCallId": id, "toolName": name, "content": [{ "type": "text", "text": "ok" }], "isError": is_error, "details": details, "timestamp": 1 })
}

fn user(text: &str) -> Json {
	json!({ "id": "u1", "role": "user", "content": text, "timestamp": 1 })
}

fn chat_records() -> Vec<(String, Json)> {
	let nodes: Vec<Json> = (1..=7).map(|i| json!({ "id": format!("node-{i}"), "title": format!("Node {i}") })).collect();
	let chats = vec![
		json!({ "id": "lesson", "kind": "lesson", "messages": [], "tree": { "nodes": [{ "id": "alpha", "title": "Alpha" }, { "id": "beta", "title": "Beta" }], "edges": [{ "from": "alpha", "to": "beta" }] } }),
		json!({ "id": "empty", "kind": "lesson", "messages": [] }),
		json!({ "id": "big", "kind": "lesson", "messages": [], "tree": { "nodes": nodes, "edges": [] } }),
		json!({
			"id": "open",
			"kind": "practice",
			"messages": [user("hi"), assistant("a1", vec![tool_call("p1", "problem", json!({ "statement": "s", "mode": "recall", "modelSolution": "m" }))]), tool_result("p1", "problem", false, Json::Null)],
		}),
		json!({ "id": "asking", "kind": "lesson", "messages": [user("hi"), assistant("a1", vec![tool_call("q1", "probe", json!({ "question": "q" }))])] }),
		json!({
			"id": "concluded",
			"kind": "lesson",
			"messages": [user("hi"), assistant("a1", vec![tool_call("d1", "probe_done", json!({}))]), tool_result("d1", "probe_done", false, json!({ "ok": true }))],
		}),
		json!({
			"id": "homework",
			"kind": "homework",
			"messages": [user("hi"), assistant("a1", vec![tool_call("h1", "problem", json!({ "number": "2b", "statement": "s" }))]), tool_result("h1", "problem", false, Json::Null)],
		}),
	];
	chats.into_iter().map(|c| (c["id"].as_str().unwrap().to_owned(), c)).collect()
}

struct Chats {
	records: Mutex<Vec<(String, Json)>>,
	saved: Mutex<Vec<Json>>,
}

impl ChatListing for Chats {
	fn list_chats(&self) -> Vec<Json> {
		vec![json!({ "id": "lesson", "title": "Limits", "createdAt": "2026-02-01T00:00:00.000Z", "updatedAt": "2026-02-02T00:00:00.000Z" })]
	}
}

impl ChatPort for Chats {
	fn get_chat(&self, id: &str) -> Option<Json> {
		self.records.lock().iter().find(|(chat, _)| chat == id).map(|(_, record)| record.clone())
	}

	fn save_tree(&self, id: &str, tree: &Json) -> Result<(), String> {
		self.saved.lock().push(json!([id, tree.clone()]));
		if let Some((_, record)) = self.records.lock().iter_mut().find(|(chat, _)| chat == id) {
			record.as_obj_mut().unwrap().insert("tree", tree.clone());
		}
		Ok(())
	}
}

struct Jobs(Mutex<Vec<Json>>);

impl JobPort for Jobs {
	fn find_job_by_tool_call_id(&self, chat_id: &str, tool_call_id: &str) -> Option<Json> {
		self.0.lock().iter().find(|j| j["chatId"].as_str() == Some(chat_id) && j["toolCallId"].as_str() == Some(tool_call_id)).cloned()
	}

	fn create_job(&self, kind: &str, chat_id: &str, tool_call_id: &str, input: &Json) -> Result<Json, String> {
		let mut jobs = self.0.lock();
		let job = json!({ "id": format!("job_{}", jobs.len() + 1), "kind": kind, "chatId": chat_id, "toolCallId": tool_call_id, "input": input.clone() });
		jobs.push(job.clone());
		Ok(job)
	}
}

/// A graph with only its nodes filled in.
struct Graph(Vec<Json>);

impl GraphStore for Graph {
	fn append_node(&self, _node: &Json) -> Result<(), String> {
		Err("read only".to_owned())
	}
	fn read_nodes(&self) -> Result<Vec<Json>, String> {
		Ok(self.0.clone())
	}
	fn append_chain(&self, _assertion: &Json) -> Result<(), String> {
		Err("read only".to_owned())
	}
	fn read_chains(&self) -> Result<Vec<Json>, String> {
		Ok(Vec::new())
	}
	fn append_checkpoint(&self, _checkpoint: &Json) -> Result<(), String> {
		Err("read only".to_owned())
	}
	fn read_checkpoints(&self) -> Result<Vec<Json>, String> {
		Ok(Vec::new())
	}
	fn append_coverage(&self, _entry: &Json) -> Result<(), String> {
		Err("read only".to_owned())
	}
	fn read_coverage(&self) -> Result<Vec<Json>, String> {
		Ok(Vec::new())
	}
	fn read_sources(&self) -> Result<Vec<Json>, String> {
		Ok(Vec::new())
	}
	fn remove_source(&self, _id: &str) -> Result<bool, String> {
		Ok(false)
	}
	fn rewrite_ledgers(&self, _next: LedgerRewrite) -> Result<(), String> {
		Err("read only".to_owned())
	}
}

fn graph_node(id: &str, name: &str, chat: &str) -> Json {
	json!({ "id": id, "name": name, "statement": format!("{name} holds."), "aliases": [], "createdAt": "2026-01-01T00:00:00.000Z", "provenance": [{ "chatId": chat, "messageId": "" }] })
}

/// The homework deadline: it keeps what the tools post and mark.
struct Deadline {
	problems: Mutex<Vec<Json>>,
	posted: Mutex<Vec<Json>>,
	done: Mutex<Vec<String>>,
}

impl Deadline {
	fn new(problems: Vec<Json>) -> Arc<Deadline> {
		Arc::new(Deadline { problems: Mutex::new(problems), posted: Mutex::new(Vec::new()), done: Mutex::new(Vec::new()) })
	}
}

impl HomeworkDeadline for Deadline {
	fn problems(&self) -> Vec<Json> {
		self.problems.lock().clone()
	}

	fn post(&self, problems: &[Json]) -> Option<String> {
		self.posted.lock().push(Json::Arr(problems.to_vec()));
		if problems.iter().any(|p| p["number"].as_str() == Some("bad")) {
			return Some("Problem numbers must be unique.".to_owned());
		}
		*self.problems.lock() = problems.iter().map(|p| json!({ "number": p["number"].clone(), "title": p["title"].clone() })).collect();
		None
	}

	fn mark_done(&self, number: &str) {
		self.done.lock().push(number.to_owned());
	}
}

struct World {
	chats: Arc<Chats>,
	jobs: Arc<Jobs>,
	spawned: Arc<Mutex<Vec<Json>>>,
	delivered: Arc<Mutex<Vec<Json>>>,
	own: Arc<Graph>,
	other: Arc<Graph>,
}

fn world() -> World {
	World {
		chats: Arc::new(Chats { records: Mutex::new(chat_records()), saved: Mutex::new(Vec::new()) }),
		jobs: Arc::new(Jobs(Mutex::new(Vec::new()))),
		spawned: Arc::new(Mutex::new(Vec::new())),
		delivered: Arc::new(Mutex::new(Vec::new())),
		own: Arc::new(Graph(vec![graph_node("n_a", "Alpha", "lesson"), graph_node("n_b", "Beta", "lesson"), graph_node("n_c", "Gamma", "gone")])),
		other: Arc::new(Graph(vec![graph_node("n_x", "Xi", "other")])),
	}
}

fn card() -> Json {
	json!({
		"spaceId": "space1",
		"name": "Space One",
		"description": "  About it.  ",
		"files": [
			{ "name": "notes.md", "kind": "study", "path": "/files/notes.md", "size": "4 pages" },
			{ "name": "syllabus.pdf", "kind": "info", "path": "/files/syllabus.pdf", "status": "extracting" },
			{ "name": "hidden.bin", "kind": "info", "path": null },
		],
		"topics": [{ "name": "Limits", "facts": 3 }],
	})
}

fn space_actions() -> SpaceActions {
	Arc::new(|name, args| {
		let outcome = match name {
			"remove_space_deadline" => ToolOutcome::Err("No such deadline.".to_owned()),
			"list_spaces" => ToolOutcome::Ok { value: Json::from("Space One (space1)"), changes: Vec::new() },
			_ => ToolOutcome::Ok { value: json!({ "tool": name, "args": args }), changes: vec![SpaceChange { label: format!("Changed {name}"), page: format!("/space/{name}") }] },
		};
		Box::pin(async move { outcome })
	})
}

fn space_search() -> Arc<SpaceSearch> {
	Arc::new(SpaceSearch {
		search_files: Box::new(|query, limit| Box::pin(async move { Ok(format!("found {} limit {limit}", stringify(&Json::from(query)))) }) as BoxFuture<'static, Result<String, String>>),
		read_passage: Box::new(|reference| {
			let shown = match reference {
				PassageRef::Passage(id) => json!({ "passageId": id }),
				PassageRef::Place { file_id, range } => json!({ "fileId": file_id, "range": range }),
			};
			format!("passage {}", stringify(&shown))
		}),
	})
}

fn save_rule() -> SaveRule {
	Arc::new(|rule, scope, area| {
		if rule == "dup" {
			return Json::from("That rule already exists.");
		}
		let this_space = scope == "this_space";
		let place = if this_space { json!({ "spaceId": "space1" }) } else { json!({ "area": area.unwrap_or("teaching") }) };
		json!({ "saved": true, "rule": rule, "for": if this_space { "Space One" } else { "every lesson" }, "where": place, "note": "" })
	})
}

impl World {
	fn chat_port(&self) -> Arc<dyn ChatPort> {
		self.chats.clone()
	}

	fn deliver(&self) -> Deliver {
		let delivered = self.delivered.clone();
		Arc::new(move |steer| {
			let mut steer = steer;
			steer.as_obj_mut().unwrap().insert("timestamp", "<ts>");
			delivered.lock().push(steer);
		})
	}

	fn spawn(&self) -> Spawn {
		let spawned = self.spawned.clone();
		Arc::new(move |job, input| spawned.lock().push(json!([job.clone(), input.clone()])))
	}

	fn plan(&self, chat_id: &str) -> PlanContext {
		PlanContext { chat_id: chat_id.to_owned(), chat_store: self.chat_port() }
	}

	fn jobs(&self, chat_id: &str) -> JobToolContext {
		JobToolContext { chat_id: chat_id.to_owned(), job_store: self.jobs.clone(), spawn: self.spawn() }
	}

	/// The space card, [Today] note, file search, space note, rule saving and deadline changes.
	fn side(&self) -> LessonSide {
		LessonSide {
			space: Some(SpaceToolContext {
				space_card: Arc::new(|| Ok(Some(card()))),
				today_note: Some(Arc::new(|| "[Today] Monday".to_owned())),
				search: Some(space_search()),
				set_note: Some(Arc::new(|text| format!("Note saved: {text}"))),
			}),
			save_rule: Some(save_rule()),
			space_actions: Some(space_actions()),
		}
	}

	fn graph(&self, store: Arc<dyn GraphStore>, across_spaces: bool) -> GraphToolContext {
		let (own, other) = (self.own.clone(), self.other.clone());
		let graphs: Option<Arc<dyn Fn() -> Vec<ScopedGraph> + Send + Sync>> = across_spaces.then(|| {
			Arc::new(move || {
				vec![
					ScopedGraph { space_name: "Space One".to_owned(), graph_store: own.clone(), own: true },
					ScopedGraph { space_name: "Space Two".to_owned(), graph_store: other.clone(), own: false },
				]
			}) as Arc<dyn Fn() -> Vec<ScopedGraph> + Send + Sync>
		});
		GraphToolContext { chat_store: self.chat_port(), graph_store: store, graphs }
	}

	fn prober(&self, chat_id: &str) -> ProberToolContext {
		ProberToolContext { probe: ProbeDoneContext { chat_id: chat_id.to_owned(), chat_store: self.chat_port(), deliver: self.deliver() }, jobs: self.jobs(chat_id), graph: None, side: LessonSide::default() }
	}

	fn teacher(&self, chat_id: &str) -> TeacherToolContext {
		TeacherToolContext { plan: self.plan(chat_id), jobs: self.jobs(chat_id), side: LessonSide::default() }
	}

	fn practice(&self, chat_id: &str) -> PracticeToolContext {
		PracticeToolContext { chat_id: chat_id.to_owned(), chat_store: self.chat_port(), graph_nodes: None, graph: None, jobs: None, side: LessonSide::default() }
	}

	fn homework(&self, chat_id: &str, homework: Arc<Deadline>) -> HomeworkToolContext {
		HomeworkToolContext { chat_id: chat_id.to_owned(), chat_store: self.chat_port(), homework, graph: None, jobs: None, side: LessonSide::default() }
	}
}

fn nodes_of(nodes: Vec<Json>) -> GraphNodes {
	Arc::new(move || nodes.clone())
}

// Running calls and describing registries.

fn describe(reg: &[FnTool]) -> Json {
	reg.iter()
		.map(|tool| {
			if FILE_TOOLS.contains(&tool.name()) {
				return json!({ "name": tool.name() });
			}
			let mode = if tool.execution_mode() == ExecutionMode::Sequential { "sequential" } else { "parallel" };
			json!({ "name": tool.name(), "description": tool.description(), "parameters": tool.parameters().clone(), "executionMode": mode })
		})
		.collect()
}

/// Runs `[tool name, args]` calls in order on one registry, as the golden's `script` does.
async fn script(reg: &[FnTool], calls: Vec<(&str, Json)>) -> Json {
	let mut out = Vec::new();
	let mut n = 0;
	for (name, args) in calls {
		let Some(tool) = reg.iter().rev().find(|t| t.name() == name) else {
			out.push(json!({ "name": name, "missing": true }));
			continue;
		};
		n += 1;
		let prepared = tool.prepare_arguments(args);
		let ctx = ToolContext { tool_call_id: format!("call_{n}"), abort: Abort::new() };
		out.push(match tool.execute(prepared.clone(), ctx).await {
			Ok(result) => json!({ "name": name, "prepared": prepared, "out": result }),
			Err(error) => json!({ "name": name, "prepared": prepared, "threw": error }),
		});
	}
	Json::Arr(out)
}

fn tool<'a>(reg: &'a [FnTool], name: &str) -> &'a FnTool {
	reg.iter().find(|t| t.name() == name).unwrap()
}

fn with(base: &Json, changes: Vec<(&str, Json)>) -> Json {
	let mut out = base.clone();
	for (key, value) in changes {
		out.as_obj_mut().unwrap().insert(key, value);
	}
	out
}

fn quiz_args() -> Json {
	json!({ "type": "check", "nodeId": "alpha", "question": "Q?", "options": [{ "label": "A", "value": "a" }, { "label": "B", "value": "b" }], "explanation": "Because.", "correctAnswer": "a" })
}

fn probe_args() -> Json {
	json!({ "question": "Q?", "options": [{ "label": "A", "value": "a" }, { "label": "B", "value": "b" }], "explanation": "Because.", "correctAnswer": "a" })
}

fn problem_args() -> Json {
	json!({ "statement": "Find x.", "mode": "recall", "modelSolution": "x=1" })
}

fn conclude_args() -> Json {
	json!({ "outcome": "solved", "verdict": "Right.", "rung": null, "missClass": null, "retest": false })
}

fn done_args() -> Json {
	json!({ "assessment": { "strands": [{ "strand": "s", "assessment": "a" }] } })
}

fn encoded(value: &Json) -> Json {
	Json::from(stringify(value))
}

// The cases, in the golden's order.

fn write_overrides(data: &Path, files: &[(&str, &str)]) {
	let dir = data.join("prompts");
	let _ = fs::remove_dir_all(&dir);
	for (segment, text) in files {
		let file = segment.split('/').fold(dir.clone(), |path, part| path.join(part));
		fsx::write_text_atomic(&file, text).unwrap();
	}
}

fn compose(data: &Path, prompts: &PromptOverrides, files: &[(&str, &str)]) -> Json {
	write_overrides(data, files);
	let mut overrides = Obj::new();
	for (segment, text) in files {
		overrides.insert(*segment, *text);
	}
	let mut composed = Obj::new();
	for (name, kind) in KINDS {
		composed.insert(name, compose_instructions(kind, prompts));
	}
	json!({ "overrides": Json::Obj(overrides), "composed": Json::Obj(composed) })
}

fn plan_result(mermaid: &str) -> Json {
	match parse_mermaid_plan(mermaid) {
		Ok(plan) => json!({ "ok": true, "problems": Json::Arr(Vec::new()), "plan": { "nodes": plan.nodes, "edges": plan.edges } }),
		Err(problems) => json!({ "ok": false, "problems": problems }),
	}
}

fn agent_facts(agent: &Agent) -> Json {
	let messages = agent.messages();
	let tools: Vec<String> = messages[0]["toolsAdded"].as_arr().into_iter().flatten().map(|t| t["name"].as_str().unwrap().to_owned()).collect();
	json!({ "systemPrompt": messages[0]["content"].clone(), "tools": tools, "messages": messages.len() })
}

fn agents(prompts: &PromptOverrides) -> Json {
	let w = world();
	let engine = || Engine { model: faux_model("godspeed-agent", "agent", "outside-agent", "Outside agent (MCP)", 200_000.0, 32_000.0), respond: Scripted::new() };
	let opts = || AgentBuildOptions::new(engine(), prompts);
	let toggled = |toggles: Json| AgentBuildOptions { tool_toggles: Some(toggles), ..opts() };
	let rules = || Some("The learner's rules:\n- Use Python.".to_owned());
	let off = || json!({ "research": false, "pdf": false });
	let teacher = || TeacherToolContext { plan: w.plan("lesson"), jobs: w.jobs("lesson"), side: w.side() };
	let study = StudyToolContext { teacher: teacher(), graph_nodes: Some(nodes_of(Vec::new())) };
	let deadline = Deadline::new(Vec::new());
	let explicit: Vec<Arc<dyn Tool>> = bare_question_tools().into_iter().map(FnTool::into_arc).collect();
	json!({
		"prober": agent_facts(&create_prober_agent(&w.prober("lesson"), opts())),
		"prober with rules and toggles": agent_facts(&create_prober_agent(&w.prober("lesson"), AgentBuildOptions { learner_rules: rules(), ..toggled(off()) })),
		"teacher": agent_facts(&create_teacher_agent(Some(&teacher()), opts())),
		"teacher with toggles": agent_facts(&create_teacher_agent(Some(&teacher()), AgentBuildOptions { learner_rules: rules(), ..toggled(json!({ "demo": false, "visual": false, "research": false, "pdf": false })) })),
		"teacher bare": agent_facts(&create_teacher_agent(None, opts())),
		"practice": agent_facts(&create_practice_agent(&w.practice("lesson"), toggled(off()))),
		"study": agent_facts(&create_study_agent(&study, toggled(json!({ "demo": false })))),
		"homework": agent_facts(&create_homework_agent(&w.homework("lesson", deadline), AgentBuildOptions { learner_rules: rules(), ..opts() })),
		"talk": agent_facts(&create_talk_agent(&space_actions(), toggled(off()))),
		"explicit tools": agent_facts(&create_teacher_agent(Some(&teacher()), AgentBuildOptions { tools: Some(explicit), ..toggled(json!({ "quiz": false })) })),
	})
}

async fn run_cases(data: &Path) -> Vec<(&'static str, Json)> {
	let paths = Paths::new(data.to_path_buf(), data.to_path_buf(), data.to_path_buf(), data.to_path_buf());
	let prompts = PromptOverrides::new(&paths);
	let mut cases: Vec<(&'static str, Json)> = Vec::new();
	let mut case = |name: &'static str, value: Json| cases.push((name, value));

	case("compose: no overrides", compose(data, &prompts, &[]));
	case(
		"compose: overrides",
		compose(
			data,
			&prompts,
			&[
				("system-prompt.md", "  Custom base.\n\n"),
				("shared/10-voice.md", "Custom voice."),
				("teacher/20-teaching.md", ""),
				("practice/20-hints.md", "   \n"),
				("talk/00-base.md", "Talk base override.\n"),
				("shared/99-ignored.md", "No such part."),
			],
		),
	);
	case("compose: segment paths", Json::from(all_segment_paths()));

	let w = world();
	let off = json!({ "explain": true, "research": false, "pdf": false, "quiz": false });
	let mut prober_minimal = w.prober("lesson");
	prober_minimal.side = LessonSide::default();
	let mut prober_full = w.prober("lesson");
	prober_full.side = w.side();
	prober_full.graph = Some(w.graph(w.own.clone(), true));
	let mut prober_recall = w.prober("lesson");
	prober_recall.side = w.side();
	prober_recall.graph = Some(w.graph(w.own.clone(), false));
	let teacher_full = TeacherToolContext { side: w.side(), ..w.teacher("lesson") };
	let study_ctx = StudyToolContext { teacher: teacher_full.clone(), graph_nodes: Some(nodes_of(vec![json!({ "id": "n_a", "name": "Alpha" })])) };
	let practice_full = PracticeToolContext {
		graph_nodes: Some(nodes_of(Vec::new())),
		graph: Some(w.graph(w.own.clone(), true)),
		jobs: Some(w.jobs("lesson")),
		side: w.side(),
		..w.practice("lesson")
	};
	let homework_full = HomeworkToolContext { graph: Some(w.graph(w.own.clone(), false)), jobs: Some(w.jobs("lesson")), side: w.side(), ..w.homework("lesson", Deadline::new(Vec::new())) };

	case("registry: prober minimal", describe(&prober_tools(&prober_minimal, None)));
	case("registry: prober full", describe(&prober_tools(&prober_full, None)));
	case("registry: prober free recall and toggles", describe(&prober_tools(&prober_recall, Some(&off))));
	case("registry: teacher minimal", describe(&teacher_tools(&w.teacher("lesson"), None)));
	case("registry: teacher full", describe(&teacher_tools(&teacher_full, None)));
	case("registry: teacher free recall and toggles", describe(&teacher_tools(&teacher_full, Some(&json!({ "explain": true, "demo": false, "visual": false })))));
	case("registry: study full", describe(&study_tools(&study_ctx, None)));
	case("registry: practice minimal", describe(&practice_tools(&w.practice("lesson"), None)));
	case("registry: practice full", describe(&practice_tools(&practice_full, Some(&json!({ "pdf": false })))));
	case("registry: homework full", describe(&homework_tools(&homework_full, None)));
	case("registry: talk", describe(&talk_tools(&space_actions())));
	case("registry: bare questions", describe(&bare_question_tools()));
	case("icons", SPACE_ICONS.iter().map(|(icon, _)| Json::from(*icon)).collect());

	let w = world();
	let reg = teacher_tools(&w.teacher("lesson"), None);
	let options = json!([{ "label": "A", "value": "a" }, { "label": "B", "value": "b" }]);
	case(
		"questions: quiz",
		script(
			&reg,
			vec![
				("quiz", quiz_args()),
				("quiz", with(&quiz_args(), vec![("nodeId", "missing".into())])),
				("quiz", with(&quiz_args(), vec![("options", encoded(&options))])),
				("quiz", with(&quiz_args(), vec![("options", json!([{ "label": "A", "value": "a" }, { "label": "A", "value": "a" }])), ("correctAnswer", "z".into())])),
				("ask_user_question", json!({ "question": "Which?", "options": [{ "label": "X" }, { "label": "X" }] })),
				("ask_user_question", json!({ "question": "Which?", "options": encoded(&json!([{ "label": "X" }, { "label": "Y" }])) })),
				("ask_user_question", json!({ "question": "Free text?" })),
				("write_code", json!({ "question": "Write f", "starter": "def f():", "language": "python" })),
				("write_code", json!({ "question": "Write f", "starter": "", "language": "" })),
			],
		)
		.await,
	);
	case("questions: quiz without a plan", script(&teacher_tools(&w.teacher("empty"), None), vec![("quiz", quiz_args())]).await);
	case("questions: quiz with many nodes", script(&teacher_tools(&w.teacher("big"), None), vec![("quiz", with(&quiz_args(), vec![("nodeId", "nope".into())]))]).await);
	case(
		"questions: explain",
		script(
			&teacher_tools(&w.teacher("lesson"), Some(&json!({ "explain": true }))),
			vec![
				("explain", json!({ "type": "check", "nodeId": "alpha", "question": "Why?", "correctAnswer": "Because." })),
				("explain", json!({ "type": "check", "nodeId": "zzz", "question": "Why?", "correctAnswer": "" })),
			],
		)
		.await,
	);
	let probe = prober_tools(&w.prober("lesson"), None);
	let recall = prober_tools(&w.prober("lesson"), Some(&json!({ "explain": true })));
	case(
		"questions: probe and recall",
		json!({
			"probe": script(&probe, vec![("probe", probe_args()), ("probe", with(&probe_args(), vec![("correctAnswer", "z".into())])), ("probe", with(&probe_args(), vec![("options", encoded(&options))]))]).await,
			"recall": script(&recall, vec![("recall", json!({ "question": "Why?", "correctAnswer": "Because." })), ("recall", json!({ "question": "Why?", "correctAnswer": " " }))]).await,
		}),
	);
	case(
		"questions: bare",
		script(&bare_question_tools(), vec![("quiz", quiz_args()), ("quiz", with(&quiz_args(), vec![("nodeId", "anything".into())])), ("ask_user_question", json!({ "question": "Q", "options": "[1" }))]).await,
	);

	let w = world();
	let first = script(&prober_tools(&w.prober("lesson"), None), vec![("probe_done", done_args()), ("probe", probe_args()), ("probe_done", done_args())]).await;
	case("probe: done gate", json!({ "first": first, "delivered": w.delivered.lock().clone() }));
	let w = world();
	let out = script(&prober_tools(&w.prober("lesson"), None), vec![("probe", probe_args()), ("probe_done", done_args())]).await;
	case("probe: question then done", json!({ "out": out, "delivered": w.delivered.lock().clone() }));
	let w = world();
	let out = script(&prober_tools(&w.prober("lesson"), None), vec![("probe", with(&probe_args(), vec![("correctAnswer", "z".into())])), ("probe_done", done_args())]).await;
	case("probe: failed question leaves the gate", json!({ "out": out, "delivered": w.delivered.lock().clone() }));
	let w = world();
	let mut states = Obj::new();
	for chat_id in ["asking", "concluded", "nope"] {
		states.insert(chat_id, script(&prober_tools(&w.prober(chat_id), None), vec![("probe_done", done_args())]).await);
	}
	case("probe: record states", json!({ "out": Json::Obj(states), "delivered": w.delivered.lock().clone() }));

	let w = world();
	let out = script(
		&teacher_tools(&w.teacher("empty"), None),
		vec![
			("plan_init", json!({ "mermaid": "graph TD\n  a[Alpha] --> b[Beta] --> c\n  c --> a" })),
			("plan_init", json!({ "mermaid": "graph TD\n  Bad[Id] --> b\n  x -->" })),
			("plan_init", json!({ "mermaid": "%% nothing\n" })),
			("plan_init", json!({ "mermaid": "graph TD\n  one[One]\n  two(\"Two\") --> one" })),
			("quiz", with(&quiz_args(), vec![("nodeId", "one".into())])),
		],
	)
	.await;
	case("plan: init", json!({ "out": out, "saved": w.chats.saved.lock().clone() }));
	case("plan: missing chat", script(&teacher_tools(&w.teacher("ghost"), None), vec![("plan_init", json!({ "mermaid": "graph TD\n a --> b" }))]).await);
	let plans = [
		"",
		"flowchart LR\n",
		"graph TD\n a",
		"graph sideways\n a --> b",
		"graph TD\n a[\"Quoted\"] ==> b('Single') -.-> c(\"Paren\")\n a --> b",
		"graph TD\n a --> a",
		"graph TD\n a[One] --> b\n a[Two]\n b[Two]\n a",
		"graph TD\n  A_b --> c\n  d -->\n  --> e\n  subgraph x",
		"graph TD;\n a --> b;\n a;\n",
		"graph TD\r\n a[T; with semi] --> b\r\n",
		"%% c\n\ngraph td\n x[ spaced ]\n",
	];
	case("plan: mermaid parser", plans.iter().map(|m| plan_result(m)).collect());

	let w = world();
	let reg = teacher_tools(&w.teacher("lesson"), None);
	case("work plan", script(&reg, vec![("work_plan", json!({ "items": ["a", "b", "c"], "done": 1 })), ("work_plan", json!({ "items": ["a", "b", "c"], "done": 4 }))]).await);

	let w = world();
	let reg = teacher_tools(&w.teacher("lesson"), None);
	let out = script(
		&reg,
		vec![
			("research", json!({ "question": "Why?", "context": "For the lesson." })),
			("demo", json!({ "title": "Osc", "brief": "A spring." })),
			("visual", json!({ "brief": "A triangle." })),
			("pdf", json!({ "path": "/a.pdf", "question": "Summarize." })),
		],
	)
	.await;
	// The same call id again returns the same job and spawns nothing new.
	let again = tool(&reg, "research").execute(json!({ "question": "Why?" }), ToolContext { tool_call_id: "call_1".to_owned(), abort: Abort::new() }).await.unwrap();
	case("jobs: dispatch", json!({ "out": out, "again": again, "jobs": w.jobs.0.lock().clone(), "spawned": w.spawned.lock().clone() }));

	let w = world();
	let reg = teacher_tools(&TeacherToolContext { side: w.side(), ..w.teacher("lesson") }, None);
	let out = script(
		&reg,
		vec![
			("read_space", json!({})),
			("set_space_note", json!({ "text": "Two sentences." })),
			("search_space_files", json!({ "query": "limits" })),
			("search_space_files", json!({ "query": "limits", "limit": 3 })),
			("read_passage", json!({ "passage_id": "f1:3" })),
			("read_passage", json!({ "file_id": "f1", "range": "p. 3" })),
			("read_passage", json!({ "file_id": "f1" })),
			("read_passage", json!({})),
			("save_rule", json!({ "rule": "Use Python.", "for": "every_lesson", "area": "files" })),
			("save_rule", json!({ "rule": "Use Python.", "for": "this_space" })),
			("save_rule", json!({ "rule": "dup", "for": "every_lesson" })),
			("list_spaces", json!({})),
			("add_space_deadline", json!({ "space_id": "space1", "deadlines": [{ "kind": "exam", "name": "Midterm", "date": "2026-03-01" }] })),
			("update_space_deadline", json!({ "space_id": "space1", "deadline_id": "d1", "time": null, "done": true })),
			("remove_space_deadline", json!({ "space_id": "space1", "deadline_id": "d1" })),
		],
	)
	.await;
	let space_only = |space_card: Arc<dyn Fn() -> Result<Option<Json>, String> + Send + Sync>| {
		let side = LessonSide { space: Some(SpaceToolContext { space_card, today_note: None, search: None, set_note: None }), ..LessonSide::default() };
		teacher_tools(&TeacherToolContext { side, ..w.teacher("lesson") }, None)
	};
	let gone = script(&space_only(Arc::new(|| Ok(None))), vec![("read_space", json!({}))]).await;
	let no_today = script(&space_only(Arc::new(|| Ok(Some(card())))), vec![("read_space", json!({}))]).await;
	case("space: tools", json!({ "out": out, "gone": gone, "noToday": no_today }));
	let icon = SPACE_ICONS[0].0;
	case(
		"space: talk",
		script(
			&talk_tools(&space_actions()),
			vec![
				("list_spaces", json!({})),
				("read_space", json!({ "space_id": "space1", "files": true })),
				("search_space_files", json!({ "space_id": "space1", "query": "q", "limit": 2 })),
				("create_space", json!({ "name": "New", "icon": icon, "signature": { "kind": "math", "value": "x^2" } })),
				("add_space_file", json!({ "space_id": "space1", "path": "/a.md", "kind": "study" })),
				("set_space_file_kind", json!({ "space_id": "space1", "file_ids": ["f1"], "kind": "info" })),
				("add_space_deadline", json!({ "space_id": "space1", "deadlines": [{ "kind": "quiz", "name": "Q1", "date": "2026-03-01", "time": "10:00", "file_ids": ["f1"] }] })),
				("remove_space_deadline", json!({ "space_id": "space1", "deadline_id": "d1" })),
				("start_lesson", json!({ "topic": "Limits" })),
				("link_space_folder", json!({ "space_id": "space1", "path": "/folder" })),
			],
		)
		.await,
	);

	let w = world();
	let with_graph = |graph: GraphToolContext| ProberToolContext { graph: Some(graph), ..w.prober("lesson") };
	let own = prober_tools(&with_graph(w.graph(w.own.clone(), false)), None);
	let cross = prober_tools(&with_graph(w.graph(w.own.clone(), true)), None);
	let empty = prober_tools(&with_graph(w.graph(Arc::new(Graph(Vec::new())), false)), None);
	case(
		"graph: tools",
		json!({
			"own": script(&own, vec![("list_sessions", json!({})), ("list_propositions", json!({ "session": "lesson" })), ("list_propositions", json!({ "session": "nope" })), ("list_propositions", json!({ "session": "gone" }))]).await,
			"cross": script(&cross, vec![("list_sessions", json!({})), ("list_propositions", json!({ "session": "other" })), ("list_propositions", json!({ "session": "lesson" }))]).await,
			"empty": script(&empty, vec![("list_sessions", json!({}))]).await,
		}),
	);

	let w = world();
	let reg = practice_tools(&w.practice("lesson"), None);
	case(
		"practice: gates",
		script(
			&reg,
			vec![
				("conclude", conclude_args()),
				("problem", problem_args()),
				("problem", problem_args()),
				("conclude", conclude_args()),
				("conclude", conclude_args()),
				("problem", with(&problem_args(), vec![("target", json!([]))])),
			],
		)
		.await,
	);
	let reg = practice_tools(&w.practice("open"), None);
	case("practice: record seeds the gate", script(&reg, vec![("problem", problem_args()), ("conclude", conclude_args())]).await);
	let nodes = vec![json!({ "id": "n_a", "name": "Alpha" }), json!({ "id": "n_b", "name": "Beta" })];
	let reg = practice_tools(&PracticeToolContext { graph_nodes: Some(nodes_of(nodes)), ..w.practice("lesson") }, None);
	let problem = tool(&reg, "problem");
	let prepared: Vec<Json> = [
		with(&problem_args(), vec![("target", json!(["Alpha", "n_b", "unknown"]))]),
		with(&problem_args(), vec![("target", json!([]))]),
		with(&problem_args(), vec![("target", encoded(&json!(["n_a"])))]),
		with(&problem_args(), vec![("target", json!(["n_a"]))]),
	]
	.into_iter()
	.map(|args| problem.prepare_arguments(args))
	.collect();
	let out = script(&reg, vec![("problem", with(&problem_args(), vec![("target", json!(["unknown"]))])), ("problem", with(&problem_args(), vec![("target", json!(["n_a"]))]))]).await;
	case("practice: targets", json!({ "prepared": prepared, "out": out }));
	let reg = study_tools(&StudyToolContext { teacher: w.teacher("lesson"), graph_nodes: Some(nodes_of(Vec::new())) }, None);
	case(
		"practice: study problem",
		script(&reg, vec![("problem", with(&problem_args(), vec![("nodeId", "missing".into())])), ("problem", with(&problem_args(), vec![("nodeId", "alpha".into())])), ("conclude", conclude_args())]).await,
	);
	let reg = practice_tools(&w.practice("lesson"), None);
	case(
		"practice: heal",
		json!([
			tool(&reg, "problem").prepare_arguments(json!({ "statement": "s", "mode": "\"recall\"", "modelSolution": "m", "target": "[]" })),
			tool(&reg, "conclude").prepare_arguments(json!({ "outcome": "\"solved\"", "verdict": "v", "rung": "\"R1\"", "missClass": "null", "retest": "true" })),
			tool(&reg, "conclude").prepare_arguments(Json::from("not an object")),
		]),
	);

	let w = world();
	let deadline = Deadline::new(Vec::new());
	let reg = homework_tools(&w.homework("lesson", deadline.clone()), None);
	let listed = encoded(&json!([{ "number": "1", "title": "One", "text": "x" }, { "number": "2b", "title": "Two", "text": "y", "page": 2 }]));
	let out = script(
		&reg,
		vec![
			("problem", json!({ "number": "1", "statement": "s" })),
			("part", json!({ "part": "a" })),
			("post_problems", json!({ "problems": [{ "number": "bad", "title": "t", "text": "x" }] })),
			("post_problems", json!({ "problems": listed })),
			("problem", json!({ "number": "9", "statement": "s" })),
			("problem", json!({ "number": "1", "statement": "s" })),
			("part", json!({ "part": "b" })),
			("problem", json!({ "number": "2b", "statement": "s" })),
			("conclude", json!({ "outcome": "movedOn", "verdict": "v" })),
			("part", json!({ "part": "c" })),
			("problem", json!({ "number": "2b", "statement": "s" })),
			("conclude", json!({ "outcome": "solved", "verdict": "v" })),
			("conclude", json!({ "outcome": "solved", "verdict": "v" })),
		],
	)
	.await;
	case("homework: flow", json!({ "out": out, "posted": deadline.posted.lock().clone(), "done": deadline.done.lock().clone() }));
	let deadline = Deadline::new(vec![json!({ "number": "2b", "title": "t" })]);
	let reg = homework_tools(&w.homework("homework", deadline.clone()), None);
	let out = script(&reg, vec![("problem", json!({ "number": "2b", "statement": "s" })), ("conclude", json!({ "outcome": "solvedWithHints", "verdict": "v" }))]).await;
	case("homework: record seeds the gate", json!({ "out": out, "done": deadline.done.lock().clone() }));

	case("agents: system prompts and tool lists", agents(&prompts));
	cases
}

/// Where the first differing character is, with some of what comes around it.
fn first_difference(got: &str, want: &str) -> String {
	let (got, want): (Vec<char>, Vec<char>) = (got.chars().collect(), want.chars().collect());
	let at = got.iter().zip(&want).position(|(a, b)| a != b).unwrap_or(got.len().min(want.len()));
	let window = |text: &[char]| text[at.saturating_sub(80)..(at + 160).min(text.len())].iter().collect::<String>();
	format!("first difference at character {at}\n  rust: {}\n  node: {}", window(&got), window(&want))
}

#[tokio::test]
async fn the_prompts_and_tools_match_the_typescript() {
	let golden = parse(&fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/lesson_tools.json")).unwrap()).unwrap();
	let golden = golden.as_arr().unwrap();
	let data: PathBuf = fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("gs-lesson-tools-golden-{}", std::process::id()));
	let _ = fs::remove_dir_all(&data);
	fs::create_dir_all(&data).unwrap();
	let cases = run_cases(&data).await;
	let _ = fs::remove_dir_all(&data);

	assert_eq!(cases.len(), golden.len(), "the golden has {} cases", golden.len());
	let mut failures = Vec::new();
	for ((name, got), recorded) in cases.iter().zip(golden) {
		assert_eq!(*name, recorded["name"].as_str().unwrap(), "the cases are out of order");
		assert!(recorded.get("error").is_none(), "{name} failed in TypeScript: {:?}", recorded.get("error"));
		let (got, want) = (stringify(got), stringify(&recorded["output"]));
		if got != want {
			failures.push(format!("{name}: {}", first_difference(&got, &want)));
		}
	}
	assert!(failures.is_empty(), "{} of {} cases differ:\n{}", failures.len(), cases.len(), failures.join("\n"));
}

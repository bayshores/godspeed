// The lesson agents' prompts and tools on the real TypeScript: the composed instructions (with
// and without saved overrides), every registry's tool names, descriptions, schemas and modes,
// and what the tools answer on small stub worlds. tests/lesson_tools_golden.rs replays it on the
// Rust tools with the same stubs. The file tools (read, ls, find, grep) have their own golden;
// here they only mark their place in each registry.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-lesson-tools-golden-"));
process.env.LH_DATA_DIR = dataDir;

const src = "../../../../src/backend/agent";
const { composeInstructions } = await import(`${src}/teacher-agent.ts`);
const { allSegmentPaths } = await import(`${src}/prompt-segments.ts`);
const teacherAgent = await import(`${src}/teacher-agent.ts`);
const tools = await import(`${src}/tools.ts`);
const { practiceTools } = await import(`${src}/tools/practice.ts`);
const { homeworkTools } = await import(`${src}/tools/homework.ts`);
const { talkTools } = await import(`${src}/tools/talk.ts`);
const { parseMermaidPlan } = await import(`${src}/tools/mermaid-plan.ts`);
const { loadAgentCore } = await import(`${src}/engine-load.ts`);
const { createFauxCore } = await import("@earendil-works/pi-ai/providers/faux");
const { SPACE_ICONS } = await import("../../../../src/shared/core/contracts.ts");

type AnyTool = { name: string; description: string; parameters: unknown; executionMode?: string; prepareArguments?: (a: unknown) => unknown; execute: (id: string, args: unknown, signal?: AbortSignal) => Promise<unknown> };
type Registry = Record<string, AnyTool>;

const FILE_TOOLS = ["read", "ls", "find", "grep"];

// ─── the stub world ─────────────────────────────────────────────────────────────────────────────

const toolCall = (id: string, name: string, args: unknown) => ({ type: "toolCall", id, name, arguments: args });
const assistant = (id: string, ...content: unknown[]) => ({ id, role: "assistant", content, api: "x", provider: "x", model: "x", usage: {}, stopReason: "toolUse", timestamp: 1 });
const result = (id: string, name: string, isError = false, details: unknown = null) => ({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: "ok" }], isError, details, timestamp: 1 });
const user = (text: string) => ({ id: "u1", role: "user", content: text, timestamp: 1 });

const slugs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `node-${i + 1}`, title: `Node ${i + 1}` }));

function world() {
	const chats: Record<string, any> = {
		lesson: { id: "lesson", kind: "lesson", messages: [], tree: { nodes: [{ id: "alpha", title: "Alpha" }, { id: "beta", title: "Beta" }], edges: [{ from: "alpha", to: "beta" }] } },
		empty: { id: "empty", kind: "lesson", messages: [] },
		big: { id: "big", kind: "lesson", messages: [], tree: { nodes: slugs(7), edges: [] } },
		open: {
			id: "open",
			kind: "practice",
			messages: [user("hi"), assistant("a1", toolCall("p1", "problem", { statement: "s", mode: "recall", modelSolution: "m" })), result("p1", "problem")],
		},
		asking: { id: "asking", kind: "lesson", messages: [user("hi"), assistant("a1", toolCall("q1", "probe", { question: "q" }))] },
		concluded: { id: "concluded", kind: "lesson", messages: [user("hi"), assistant("a1", toolCall("d1", "probe_done", {})), result("d1", "probe_done", false, { ok: true })] },
		homework: {
			id: "homework",
			kind: "homework",
			messages: [user("hi"), assistant("a1", toolCall("h1", "problem", { number: "2b", statement: "s" })), result("h1", "problem")],
		},
	};
	const saved: unknown[] = [];
	const chatStore = {
		getChat: (id: string) => chats[id] ?? null,
		listChats: () => [{ id: "lesson", title: "Limits", createdAt: "2026-02-01T00:00:00.000Z", updatedAt: "2026-02-02T00:00:00.000Z" }],
		saveTree: (id: string, tree: unknown) => {
			saved.push([id, tree]);
			if (chats[id]) chats[id].tree = tree;
		},
	};
	const node = (id: string, name: string, chat: string) => ({ id, name, statement: `${name} holds.`, aliases: [], createdAt: "2026-01-01T00:00:00.000Z", provenance: [{ chatId: chat, messageId: "" }] });
	const graphStore = (nodes: unknown[]) => ({ readNodes: () => nodes, readChains: () => [], readCheckpoints: () => [], readCoverage: () => [], readSources: () => [] }) as any;
	const own = graphStore([node("n_a", "Alpha", "lesson"), node("n_b", "Beta", "lesson"), node("n_c", "Gamma", "gone")]);
	const other = graphStore([node("n_x", "Xi", "other")]);
	const jobs: any[] = [];
	const spawned: unknown[] = [];
	const jobStore = {
		findJobByToolCallId: (chatId: string, toolCallId: string) => jobs.find((j) => j.chatId === chatId && j.toolCallId === toolCallId),
		createJob: (init: any) => {
			const job = { id: `job_${jobs.length + 1}`, ...init };
			jobs.push(job);
			return job;
		},
	};
	const spawn = (job: unknown, input: unknown) => void spawned.push([job, input]);
	const delivered: unknown[] = [];
	const deliver = (steer: any) => void delivered.push({ ...steer, timestamp: "<ts>" });
	const card = {
		spaceId: "space1",
		name: "Space One",
		description: "  About it.  ",
		files: [
			{ name: "notes.md", kind: "study", path: "/files/notes.md", size: "4 pages" },
			{ name: "syllabus.pdf", kind: "info", path: "/files/syllabus.pdf", status: "extracting" },
			{ name: "hidden.bin", kind: "info", path: null },
		],
		topics: [{ name: "Limits", facts: 3 }],
	};
	const spaceSearch = {
		searchFiles: async (query: string, limit: number) => `found ${JSON.stringify(query)} limit ${limit}`,
		readPassage: (ref: unknown) => `passage ${JSON.stringify(ref)}`,
	};
	const saveRule = (rule: string, scope: string, area: string | undefined) =>
		rule === "dup" ? "That rule already exists." : { saved: true, rule, for: scope === "this_space" ? "Space One" : "every lesson", where: scope === "this_space" ? { spaceId: "space1" } : { area: area ?? "teaching" }, note: "" };
	const ok = (name: string) => (args: unknown) => ({ ok: true, value: { tool: name, args }, changes: [{ label: `Changed ${name}`, page: `/space/${name}` }] });
	const spaceActions: any = {};
	for (const name of ["list_spaces", "read_space", "search_space_files", "read_passage", "create_space", "update_space", "add_space_file", "set_space_file_kind", "add_space_deadline", "update_space_deadline", "remove_space_deadline", "link_space_folder", "start_lesson"]) {
		spaceActions[name] = name === "remove_space_deadline" ? () => ({ ok: false, error: "No such deadline." }) : name === "list_spaces" ? () => ({ ok: true, value: "Space One (space1)", changes: [] }) : ok(name);
	}
	const base = { chatId: "lesson", chatStore, jobStore, spawn, deliver };
	const side = { spaceCard: () => card, todayNote: () => "[Today] Monday", spaceSearch, spaceNote: (text: string) => `Note saved: ${text}`, saveRule, spaceActions };
	const graphs = () => [
		{ spaceName: "Space One", graphStore: own, own: true },
		{ spaceName: "Space Two", graphStore: other, own: false },
	];
	return { spaceActions, chats, saved, chatStore, jobStore, jobs, spawned, delivered, base, side, own, other, graphs, card };
}

const strip = (t: AnyTool) => (FILE_TOOLS.includes(t.name) ? { name: t.name } : { name: t.name, description: t.description, parameters: t.parameters, executionMode: t.executionMode ?? "parallel" });
const describe = (reg: Registry) => Object.values(reg).map(strip);

/** Runs a list of `[tool name, args]` calls in order on one registry. */
async function script(reg: Registry, calls: [string, unknown][]) {
	const out: unknown[] = [];
	let n = 0;
	for (const [name, args] of calls) {
		const tool = reg[name];
		if (!tool) {
			out.push({ name, missing: true });
			continue;
		}
		const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args;
		try {
			out.push({ name, prepared, out: await tool.execute(`call_${++n}`, prepared) });
		} catch (err) {
			out.push({ name, prepared, threw: (err as Error).message });
		}
	}
	return out;
}

// ─── the cases ──────────────────────────────────────────────────────────────────────────────────

const KINDS = ["prober", "teacher", "practice", "study", "homework", "talk"] as const;

function writeOverrides(files: Record<string, string>) {
	fs.rmSync(path.join(dataDir, "prompts"), { recursive: true, force: true });
	for (const [segment, text] of Object.entries(files)) {
		const file = path.join(dataDir, "prompts", ...segment.split("/"));
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, text);
	}
}

function compose(overrides: Record<string, string>) {
	writeOverrides(overrides);
	return { overrides, composed: Object.fromEntries(KINDS.map((k) => [k, composeInstructions(k)])) };
}

const quizArgs = { type: "check", nodeId: "alpha", question: "Q?", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], explanation: "Because.", correctAnswer: "a" };
const probeArgs = { question: "Q?", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }], explanation: "Because.", correctAnswer: "a" };
const problemArgs = { statement: "Find x.", mode: "recall", modelSolution: "x=1" };
const concludeArgs = { outcome: "solved", verdict: "Right.", rung: null, missClass: null, retest: false };

const cases: Record<string, () => unknown> = {
	"compose: no overrides": () => compose({}),
	"compose: overrides": () =>
		compose({
			"system-prompt.md": "  Custom base.\n\n",
			"shared/10-voice.md": "Custom voice.",
			"teacher/20-teaching.md": "",
			"practice/20-hints.md": "   \n",
			"talk/00-base.md": "Talk base override.\n",
			"shared/99-ignored.md": "No such part.",
		}),
	"compose: segment paths": () => allSegmentPaths(),

	"registry: prober minimal": () => {
		const w = world();
		return describe(tools.createProberTools({ chatId: "lesson", chatStore: w.chatStore, jobStore: w.jobStore, spawn: w.spawn, deliver: w.deliver }));
	},
	"registry: prober full": () => {
		const w = world();
		return describe(tools.createProberTools({ ...w.base, ...w.side, graphStore: w.own, graphs: w.graphs }));
	},
	"registry: prober free recall and toggles": () => {
		const w = world();
		return describe(tools.createProberTools({ ...w.base, ...w.side, graphStore: w.own }, { explain: true, research: false, pdf: false, quiz: false }));
	},
	"registry: teacher minimal": () => {
		const w = world();
		return describe(tools.createTeacherTools({ chatId: "lesson", chatStore: w.chatStore, jobStore: w.jobStore, spawn: w.spawn }));
	},
	"registry: teacher full": () => {
		const w = world();
		return describe(tools.createTeacherTools({ ...w.base, ...w.side }));
	},
	"registry: teacher free recall and toggles": () => {
		const w = world();
		return describe(tools.createTeacherTools({ ...w.base, ...w.side }, { explain: true, demo: false, visual: false }));
	},
	"registry: study full": () => {
		const w = world();
		return describe(tools.createStudyTools({ ...w.base, ...w.side, graphNodes: () => [{ id: "n_a", name: "Alpha" }] }));
	},
	"registry: practice minimal": () => {
		const w = world();
		return describe(practiceTools({ chatId: "lesson", chatStore: w.chatStore }));
	},
	"registry: practice full": () => {
		const w = world();
		return describe(
			practiceTools(
				{ chatId: "lesson", chatStore: w.chatStore, graphNodes: () => [], graph: { chatStore: w.chatStore, graphStore: w.own, graphs: w.graphs }, jobs: { chatId: "lesson", jobStore: w.jobStore, spawn: w.spawn }, ...w.side },
				{ pdf: false },
			),
		);
	},
	"registry: homework full": () => {
		const w = world();
		const homework = { problems: () => [], post: () => null, markDone: () => {} };
		return describe(homeworkTools({ chatId: "lesson", chatStore: w.chatStore, homework, graph: { chatStore: w.chatStore, graphStore: w.own }, jobs: { chatId: "lesson", jobStore: w.jobStore, spawn: w.spawn }, ...w.side }));
	},
	"registry: talk": () => {
		const w = world();
		return describe(talkTools(w.spaceActions));
	},
	"registry: bare questions": () => describe(teacherAgent.bareQuestionTools()),
	"icons": () => Object.keys(SPACE_ICONS),

	"questions: quiz": async () => {
		const w = world();
		const reg = tools.createTeacherTools({ ...w.base });
		return script(reg, [
			["quiz", quizArgs],
			["quiz", { ...quizArgs, nodeId: "missing" }],
			["quiz", { ...quizArgs, options: JSON.stringify(quizArgs.options) }],
			["quiz", { ...quizArgs, options: [{ label: "A", value: "a" }, { label: "A", value: "a" }], correctAnswer: "z" }],
			["ask_user_question", { question: "Which?", options: [{ label: "X" }, { label: "X" }] }],
			["ask_user_question", { question: "Which?", options: JSON.stringify([{ label: "X" }, { label: "Y" }]) }],
			["ask_user_question", { question: "Free text?" }],
			["write_code", { question: "Write f", starter: "def f():", language: "python" }],
			["write_code", { question: "Write f", starter: "", language: "" }],
		]);
	},
	"questions: quiz without a plan": async () => {
		const w = world();
		const reg = tools.createTeacherTools({ ...w.base, chatId: "empty" });
		return script(reg, [["quiz", quizArgs]]);
	},
	"questions: quiz with many nodes": async () => {
		const w = world();
		const reg = tools.createTeacherTools({ ...w.base, chatId: "big" });
		return script(reg, [["quiz", { ...quizArgs, nodeId: "nope" }]]);
	},
	"questions: explain": async () => {
		const w = world();
		const reg = tools.createTeacherTools({ ...w.base }, { explain: true });
		return script(reg, [
			["explain", { type: "check", nodeId: "alpha", question: "Why?", correctAnswer: "Because." }],
			["explain", { type: "check", nodeId: "zzz", question: "Why?", correctAnswer: "" }],
		]);
	},
	"questions: probe and recall": async () => {
		const w = world();
		const probe = tools.createProberTools({ ...w.base });
		const recall = tools.createProberTools({ ...w.base }, { explain: true });
		return {
			probe: await script(probe, [["probe", probeArgs], ["probe", { ...probeArgs, correctAnswer: "z" }], ["probe", { ...probeArgs, options: JSON.stringify(probeArgs.options) }]]),
			recall: await script(recall, [["recall", { question: "Why?", correctAnswer: "Because." }], ["recall", { question: "Why?", correctAnswer: " " }]]),
		};
	},
	"questions: bare": async () => script(teacherAgent.bareQuestionTools(), [["quiz", quizArgs], ["quiz", { ...quizArgs, nodeId: "anything" }], ["ask_user_question", { question: "Q", options: "[1" }]]),

	"probe: done gate": async () => {
		const w = world();
		const reg = tools.createProberTools({ ...w.base });
		const first = await script(reg, [["probe_done", { assessment: { strands: [{ strand: "s", assessment: "a" }] } }], ["probe", probeArgs], ["probe_done", { assessment: { strands: [{ strand: "s", assessment: "a" }] } }]]);
		return { first, delivered: w.delivered };
	},
	"probe: question then done": async () => {
		const w = world();
		const reg = tools.createProberTools({ ...w.base });
		const out = await script(reg, [["probe", probeArgs], ["probe_done", { assessment: { strands: [{ strand: "s", assessment: "a" }] } }]]);
		return { out, delivered: w.delivered };
	},
	"probe: failed question leaves the gate": async () => {
		const w = world();
		const reg = tools.createProberTools({ ...w.base });
		const out = await script(reg, [["probe", { ...probeArgs, correctAnswer: "z" }], ["probe_done", { assessment: { strands: [{ strand: "s", assessment: "a" }] } }]]);
		return { out, delivered: w.delivered };
	},
	"probe: record states": async () => {
		const w = world();
		const done = { assessment: { strands: [{ strand: "s", assessment: "a" }] } };
		const out: Record<string, unknown> = {};
		for (const chatId of ["asking", "concluded", "nope"]) {
			out[chatId] = await script(tools.createProberTools({ ...w.base, chatId }), [["probe_done", done]]);
		}
		return { out, delivered: w.delivered };
	},

	"plan: init": async () => {
		const w = world();
		const reg = tools.createTeacherTools({ ...w.base, chatId: "empty" });
		const out = await script(reg, [
			["plan_init", { mermaid: "graph TD\n  a[Alpha] --> b[Beta] --> c\n  c --> a" }],
			["plan_init", { mermaid: "graph TD\n  Bad[Id] --> b\n  x -->" }],
			["plan_init", { mermaid: "%% nothing\n" }],
			["plan_init", { mermaid: "graph TD\n  one[One]\n  two(\"Two\") --> one" }],
			["quiz", { ...quizArgs, nodeId: "one" }],
		]);
		return { out, saved: w.saved };
	},
	"plan: missing chat": async () => {
		const w = world();
		const reg = tools.createTeacherTools({ ...w.base, chatId: "ghost" });
		return script(reg, [["plan_init", { mermaid: "graph TD\n a --> b" }]]);
	},
	"plan: mermaid parser": () =>
		[
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
		].map((m) => parseMermaidPlan(m)),

	"work plan": async () => {
		const w = world();
		const reg = tools.createTeacherTools({ ...w.base });
		return script(reg, [["work_plan", { items: ["a", "b", "c"], done: 1 }], ["work_plan", { items: ["a", "b", "c"], done: 4 }]]);
	},

	"jobs: dispatch": async () => {
		const w = world();
		const reg = tools.createTeacherTools({ ...w.base });
		const out = await script(reg, [
			["research", { question: "Why?", context: "For the lesson." }],
			["demo", { title: "Osc", brief: "A spring." }],
			["visual", { brief: "A triangle." }],
			["pdf", { path: "/a.pdf", question: "Summarize." }],
		]);
		// The same call id again returns the same job and spawns nothing new.
		const tool = reg.research!;
		const again = await tool.execute("call_1", { question: "Why?" });
		return { out, again, jobs: w.jobs, spawned: w.spawned };
	},

	"space: tools": async () => {
		const w = world();
		const reg = tools.createTeacherTools({ ...w.base, ...w.side });
		const out = await script(reg, [
			["read_space", {}],
			["set_space_note", { text: "Two sentences." }],
			["search_space_files", { query: "limits" }],
			["search_space_files", { query: "limits", limit: 3 }],
			["read_passage", { passage_id: "f1:3" }],
			["read_passage", { file_id: "f1", range: "p. 3" }],
			["read_passage", { file_id: "f1" }],
			["read_passage", {}],
			["save_rule", { rule: "Use Python.", for: "every_lesson", area: "files" }],
			["save_rule", { rule: "Use Python.", for: "this_space" }],
			["save_rule", { rule: "dup", for: "every_lesson" }],
			["list_spaces", {}],
			["add_space_deadline", { space_id: "space1", deadlines: [{ kind: "exam", name: "Midterm", date: "2026-03-01" }] }],
			["update_space_deadline", { space_id: "space1", deadline_id: "d1", time: null, done: true }],
			["remove_space_deadline", { space_id: "space1", deadline_id: "d1" }],
		]);
		const gone = tools.createTeacherTools({ ...w.base, spaceCard: () => null });
		return { out, gone: await script(gone, [["read_space", {}]]), noToday: await script(tools.createTeacherTools({ ...w.base, spaceCard: () => w.card }), [["read_space", {}]]) };
	},
	"space: talk": async () => {
		const w = world();
		const reg = talkTools(w.spaceActions);
		return script(reg, [
			["list_spaces", {}],
			["read_space", { space_id: "space1", files: true }],
			["search_space_files", { space_id: "space1", query: "q", limit: 2 }],
			["create_space", { name: "New", icon: Object.keys(SPACE_ICONS)[0], signature: { kind: "math", value: "x^2" } }],
			["add_space_file", { space_id: "space1", path: "/a.md", kind: "study" }],
			["set_space_file_kind", { space_id: "space1", file_ids: ["f1"], kind: "info" }],
			["add_space_deadline", { space_id: "space1", deadlines: [{ kind: "quiz", name: "Q1", date: "2026-03-01", time: "10:00", file_ids: ["f1"] }] }],
			["remove_space_deadline", { space_id: "space1", deadline_id: "d1" }],
			["start_lesson", { topic: "Limits" }],
			["link_space_folder", { space_id: "space1", path: "/folder" }],
		]);
	},

	"graph: tools": async () => {
		const w = world();
		const own = tools.createProberTools({ ...w.base, graphStore: w.own });
		const cross = tools.createProberTools({ ...w.base, graphStore: w.own, graphs: w.graphs });
		const empty = tools.createProberTools({ ...w.base, graphStore: { ...w.own, readNodes: () => [] } as any });
		return {
			own: await script(own, [["list_sessions", {}], ["list_propositions", { session: "lesson" }], ["list_propositions", { session: "nope" }], ["list_propositions", { session: "gone" }]]),
			cross: await script(cross, [["list_sessions", {}], ["list_propositions", { session: "other" }], ["list_propositions", { session: "lesson" }]]),
			empty: await script(empty, [["list_sessions", {}]]),
		};
	},

	"practice: gates": async () => {
		const w = world();
		const reg = practiceTools({ chatId: "lesson", chatStore: w.chatStore });
		return script(reg, [["conclude", concludeArgs], ["problem", problemArgs], ["problem", problemArgs], ["conclude", concludeArgs], ["conclude", concludeArgs], ["problem", { ...problemArgs, target: [] }]]);
	},
	"practice: record seeds the gate": async () => {
		const w = world();
		const reg = practiceTools({ chatId: "open", chatStore: w.chatStore });
		return script(reg, [["problem", problemArgs], ["conclude", concludeArgs]]);
	},
	"practice: targets": async () => {
		const w = world();
		const nodes = [{ id: "n_a", name: "Alpha" }, { id: "n_b", name: "Beta" }];
		const reg = practiceTools({ chatId: "lesson", chatStore: w.chatStore, graphNodes: () => nodes });
		const prepared = [
			reg.problem!.prepareArguments!({ ...problemArgs, target: ["Alpha", "n_b", "unknown"] }),
			reg.problem!.prepareArguments!({ ...problemArgs, target: [] }),
			reg.problem!.prepareArguments!({ ...problemArgs, target: JSON.stringify(["n_a"]) }),
			reg.problem!.prepareArguments!({ ...problemArgs, target: ["n_a"] }),
		];
		const out = await script(reg, [["problem", { ...problemArgs, target: ["unknown"] }], ["problem", { ...problemArgs, target: ["n_a"] }]]);
		return { prepared, out };
	},
	"practice: study problem": async () => {
		const w = world();
		const reg = tools.createStudyTools({ ...w.base, graphNodes: () => [] });
		return script(reg, [["problem", { ...problemArgs, nodeId: "missing" }], ["problem", { ...problemArgs, nodeId: "alpha" }], ["conclude", concludeArgs]]);
	},
	"practice: heal": () => {
		const w = world();
		const reg = practiceTools({ chatId: "lesson", chatStore: w.chatStore });
		return [
			reg.problem!.prepareArguments!({ statement: "s", mode: '"recall"', modelSolution: "m", target: "[]" }),
			reg.conclude!.prepareArguments!({ outcome: '"solved"', verdict: "v", rung: '"R1"', missClass: "null", retest: "true" }),
			reg.conclude!.prepareArguments!("not an object"),
		];
	},

	"homework: flow": async () => {
		const w = world();
		const posted: unknown[] = [];
		let problems: any[] = [];
		const done: string[] = [];
		const homework = {
			problems: () => problems,
			post: (list: any[]) => {
				posted.push(list);
				if (list.some((p) => p.number === "bad")) return "Problem numbers must be unique.";
				problems = list.map((p) => ({ number: p.number, title: p.title }));
				return null;
			},
			markDone: (n: string) => void done.push(n),
		};
		const reg = homeworkTools({ chatId: "lesson", chatStore: w.chatStore, homework });
		const out = await script(reg, [
			["problem", { number: "1", statement: "s" }],
			["post_problems", { problems: [{ number: "bad", title: "t", text: "x" }] }],
			["post_problems", { problems: JSON.stringify([{ number: "1", title: "One", text: "x" }, { number: "2b", title: "Two", text: "y", page: 2 }]) }],
			["problem", { number: "9", statement: "s" }],
			["problem", { number: "1", statement: "s" }],
			["problem", { number: "2b", statement: "s" }],
			["conclude", { outcome: "movedOn", verdict: "v" }],
			["problem", { number: "2b", statement: "s" }],
			["conclude", { outcome: "solved", verdict: "v" }],
			["conclude", { outcome: "solved", verdict: "v" }],
		]);
		return { out, posted, done };
	},
	"homework: record seeds the gate": async () => {
		const w = world();
		const done: string[] = [];
		const homework = { problems: () => [{ number: "2b", title: "t" }], post: () => null, markDone: (n: string) => void done.push(n) };
		const reg = homeworkTools({ chatId: "homework", chatStore: w.chatStore, homework });
		const out = await script(reg, [["problem", { number: "2b", statement: "s" }], ["conclude", { outcome: "solvedWithHints", verdict: "v" }]]);
		return { out, done };
	},
};

// ─── the agents ─────────────────────────────────────────────────────────────────────────────────

async function agentFacts() {
	await loadAgentCore();
	const w = world();
	const core = createFauxCore({ api: "godspeed-agent", provider: "agent", models: [{ id: "outside-agent", name: "Outside agent (MCP)", reasoning: false, input: ["text", "image"], contextWindow: 200_000, maxTokens: 32_000 }] });
	const engine = { model: core.getModel(), streamFn: (model: any, context: any, options: any) => core.streamSimple(model, context, { ...options, cacheRetention: "none" }) } as any;
	const facts = (agent: any) => ({ systemPrompt: agent.state.systemPrompt, tools: agent.state.tools.map((t: AnyTool) => t.name), messages: agent.state.messages.length });
	const off = { research: false, pdf: false };
	const rules = "The learner's rules:\n- Use Python.";
	const teacherCtx = { ...w.base, ...w.side };
	const homework = { problems: () => [], post: () => null, markDone: () => {} };
	return {
		prober: facts(teacherAgent.createProberAgent({ ...w.base }, { engine })),
		"prober with rules and toggles": facts(teacherAgent.createProberAgent({ ...w.base }, { engine, toolToggles: off, learnerRules: rules })),
		teacher: facts(teacherAgent.createTeacherAgent(teacherCtx, { engine })),
		"teacher with toggles": facts(teacherAgent.createTeacherAgent(teacherCtx, { engine, toolToggles: { demo: false, visual: false, research: false, pdf: false }, learnerRules: rules })),
		"teacher bare": facts(teacherAgent.createTeacherAgent(undefined, { engine })),
		practice: facts(teacherAgent.createPracticeAgent({ chatId: "lesson", chatStore: w.chatStore }, { engine, toolToggles: off })),
		study: facts(teacherAgent.createStudyAgent({ ...teacherCtx, graphNodes: () => [] }, { engine, toolToggles: { demo: false } })),
		homework: facts(teacherAgent.createHomeworkAgent({ chatId: "lesson", chatStore: w.chatStore, homework }, { engine, learnerRules: rules })),
		talk: facts(teacherAgent.createTalkAgent(w.spaceActions, { engine, toolToggles: off })),
		"explicit tools": facts(teacherAgent.createTeacherAgent(teacherCtx, { engine, tools: teacherAgent.bareQuestionTools(), toolToggles: { quiz: false } })),
	};
}

export default { ...cases, "agents: system prompts and tool lists": agentFacts };

// The study rules (progress, study sessions, homework, deadline plan, cheat sheets) on the two
// fixture spaces and on inputs that probe each branch. Every case is `{ args, result }`; the Rust replay
// feeds the args to the Rust function and compares the result.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getGraph } from "../../../../src/shared/core/graph.ts";
import { planDays, topicsToWorkOn } from "../../../../src/shared/core/deadline-plan.ts";
import { continueStudyFor } from "../../../../src/shared/core/continue-study.ts";
import { concludeMarksDone, hasProblems, homeworkContextText, latestHomework, mergeProblems, problemsDone } from "../../../../src/shared/core/homework.ts";
import { collectAnswers, daysBetween, deriveProgress, rampColor, topicStatus } from "../../../../src/shared/core/progress.ts";
import {
	cheatSheetRequestText,
	currentVersion,
	mistakeCounts,
	newCheatSheet,
	newerFolderPdf,
	pageSizeLabel,
	parseCheatSheet,
	pdfProblem,
	regionProblem,
	regionText,
	sheetCards,
	sheetFolderName,
	sheetMistakes,
	withMessage,
	withRules,
	withVersion,
	withoutRule,
} from "../../../../src/shared/core/cheat-sheet.ts";
import { deadlineStudyTopicIds, factSpaceOrder, isLatestWrong, studyContextText, studyPlanTree, studyTitle, studyTopics, topicStudy } from "../../../../src/shared/core/study.ts";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures");
const CSE21 = "cls_cvq4t7in_101dfecb";
const CSE29 = "cls_cvq4t7n0_31e7df8c";
const GRAPH_DIRS: Record<string, string> = { [CSE21]: "cse21", [CSE29]: "cse29" };
const MIDTERM = "ddl_49d23b6ea4ca";

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const readLines = (file: string): any[] => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sourceIdFor = (spaceId: string, fileId: string) => `src_${createHash("sha256").update(`${spaceId}:${fileId}`).digest("hex").slice(0, 12)}`;

// ─── the fixture chats, already cut down to what the answer rules read ──────

const chats: any[] = readJson(path.join(FIXTURES, "study_chats.json")).chats;
const trimmed = chats.map((c) => ({ id: c.id, messages: c.messages }));

// ─── the fixture spaces, as the server hands them to deriveProgress ───────────

function lessonsOf(spaceId: string | null) {
	const lessons: any[] = [];
	const deadlineSessions: any[] = [];
	const homeworkSessions: any[] = [];
	for (const c of chats) {
		if ((c.spaceId ?? null) !== spaceId) continue;
		if (c.kind === "homework" && c.deadlineId) homeworkSessions.push({ chatId: c.id, deadlineId: c.deadlineId, createdAt: c.createdAt });
		lessons.push({ id: c.id, title: c.title, kind: c.kind, updatedAt: c.updatedAt, answers: collectAnswers(c.id, c.messages) });
		if (c.deadlineId && c.tree) deadlineSessions.push({ chatId: c.id, deadlineId: c.deadlineId, createdAt: c.createdAt, done: Math.min(c.turns ?? 0, 3), total: 3 });
	}
	return { lessons, deadlineSessions, homeworkSessions };
}

function progressInput(spaceId: string | null, today: string) {
	const graphDir = spaceId ? path.join(FIXTURES, "graph", GRAPH_DIRS[spaceId]!) : null;
	const lines = (name: string) => (graphDir ? readLines(path.join(graphDir, name)) : []);
	const graph = getGraph({ readNodes: () => lines("nodes.jsonl"), readChains: () => lines("chains.jsonl") });
	const record = spaceId ? readJson(path.join(FIXTURES, "spaces", spaceId, "space.json")) : null;
	return {
		spaceId,
		today,
		facts: graph.nodes,
		chains: graph.chains,
		topics: lines("topics.jsonl").at(-1) ?? null,
		files: (record?.files ?? []).map((f: any) => ({ id: f.id, name: f.name, kind: f.kind, sourceId: f.sourceId ?? sourceIdFor(record.id, f.id) })),
		deadlines: record?.deadlines ?? [],
		...lessonsOf(spaceId),
		grouping: false,
	};
}

const BASE21 = "derive CSE 21 on 2026-11-10";
const BASE29 = "derive CSE 29 on 2026-11-10";
const BASE_NONE = "derive no space on 2026-11-10";
const inputs: Record<string, any> = {
	[BASE21]: progressInput(CSE21, "2026-11-10"),
	[BASE29]: progressInput(CSE29, "2026-11-10"),
	[BASE_NONE]: progressInput(null, "2026-11-10"),
};
const progress = (name: string) => deriveProgress(inputs[name]);
const progress21 = progress(BASE21);
const progress29 = progress(BASE29);
const filesOf = (name: string) => inputs[name].files;

const cases: Record<string, () => unknown> = {};
const add = (name: string, args: unknown, result: () => unknown) => {
	cases[name] = () => ({ args, result: result() });
};

// ─── progress ───────────────────────────────────────────────────────────────

for (const [name, input] of Object.entries(inputs)) add(name, { input }, () => deriveProgress(input));
// A variant that only moves the day or the grouping flag keeps the topics and facts of its base:
// "slim" leaves those big parts out of the result.
const variants: [string, string, Record<string, unknown>, boolean][] = [
	["derive CSE 21 on 2026-10-30", BASE21, { today: "2026-10-30" }, true],
	["derive CSE 21 on 2026-11-04", BASE21, { today: "2026-11-04" }, true],
	["derive CSE 21 on 2027-01-15 while grouping", BASE21, { today: "2027-01-15", grouping: true }, true],
	["derive CSE 29 on 2026-11-12", BASE29, { today: "2026-11-12" }, true],
	["derive CSE 29 without topics", BASE29, { topics: null }, false],
	["derive CSE 29 without lessons", BASE29, { lessons: [], deadlineSessions: [], homeworkSessions: [] }, false],
];
const slimmed = (p: any) => Object.fromEntries(Object.entries(p).filter(([k]) => !["facts", "topics", "topicLinks", "files"].includes(k)));
for (const [name, base, patch, slim] of variants) {
	const input = { ...inputs[base], ...patch };
	add(name, { base, patch, slim }, () => (slim ? slimmed(deriveProgress(input)) : deriveProgress(input)));
}
add("derive an empty space", { input: { spaceId: null, today: "2026-11-10", facts: [], chains: [], topics: null, files: [], deadlines: [], lessons: [] } }, () =>
	deriveProgress({ spaceId: null, today: "2026-11-10", facts: [], chains: [], topics: null, files: [], deadlines: [], lessons: [] }),
);

// A made-up space that reaches the branches the fixtures do not: a topic another struggling one
// builds on, an ungrouped fact, a lesson listed twice, practice answers naming a fact twice and
// answers found through an earlier message of the turn.
const answer = (id: string, outcome: string, at: string, extra: Record<string, unknown> = {}) => ({
	chatId: "c1",
	messageId: `m_${id}`,
	contextMessageIds: [],
	toolCallId: `call_${id}`,
	tool: "quiz",
	question: `Question ${id}?`,
	outcome,
	answeredAt: at,
	...extra,
});
const madeUp = {
	spaceId: "cls_x",
	today: "2026-11-10",
	facts: [
		{ id: "f1", name: "Uno", statement: "One.", provenance: [{ chatId: "src_a" }, { chatId: "c1", messageId: "m_a1" }] },
		{ id: "f2", name: "dos", statement: "Two.", provenance: [{ chatId: "src_a" }] },
		{ id: "f3", name: "Tres", statement: "Three.", provenance: [{ chatId: "src_a" }] },
		{ id: "f4", name: "Cuatro", statement: "Four.", provenance: [{ chatId: "src_c" }, { chatId: "c1", messageId: "m_a4" }] },
		{ id: "f5", name: "Cinco", statement: "Five.", provenance: [{ chatId: "c1", messageId: "m_x" }] },
		{ id: "f6", name: "Seis", statement: "Six.", provenance: [{ chatId: "src_b", messageId: "m_a5" }, { chatId: "c1", messageId: "m_a5" }] },
	],
	chains: [
		{ premises: ["f1", "f2"], conclusion: "f3" },
		{ premises: ["f3"], conclusion: "f4" },
		{ premises: ["f1"], conclusion: "f5" },
		{ premises: ["f2", "f6"], conclusion: "f5" },
		{ premises: ["f5"], conclusion: "f1" },
	],
	topics: {
		at: "2026-11-09T00:00:00.000Z",
		topics: [
			{ id: "T1", name: "One", members: ["f1", "f2", "gone"], material: "term" },
			{ id: "T2", name: "Two", members: ["f3"] },
			{ id: "T3", name: "Three", members: ["f4"], material: "proof" },
			{ id: "T4", name: "Four", members: ["f5", "f1"] },
		],
	},
	files: [
		{ id: "file1", name: "Week 1 notes", kind: "study", sourceId: "src_a" },
		{ id: "file2", name: "Syllabus", kind: "info", sourceId: "src_b" },
		{ id: "file3", name: "Week 3 notes", kind: "study", sourceId: "src_c" },
		{ id: "file4", name: "Empty notes", kind: "study", sourceId: "src_d" },
	],
	deadlines: [
		{ id: "d1", kind: "homework", name: "HW 1", date: "2026-11-20", time: "09:00", done: false, fileIds: ["file1", "file9"], problems: [{ number: "1", title: "A", text: "a", done: true }, { number: "2", title: "B", text: "b", done: false }] },
		{ id: "d2", kind: "exam", name: "Quiz", date: "2026-11-12", done: true, fileIds: [] },
		{ id: "d3", kind: "exam", name: "Midterm", date: "2026-11-12", fileIds: ["file3", "file2"], done: false },
	],
	lessons: [
		{ id: "c1", title: "First", kind: "teach", updatedAt: "2026-11-01T00:00:00.000Z", answers: [answer("old", "right", "2026-11-01T00:00:00.000Z")] },
		{ id: "c2", title: null, updatedAt: "2026-11-05T00:00:00.000Z", answers: [] },
		{
			id: "c1",
			title: "Again",
			kind: "practice",
			updatedAt: "2026-11-03T00:00:00.000Z",
			answers: [
				answer("a1", "wrong", "2026-11-02T01:00:00.000Z", { confidence: 90, level: 5 }),
				answer("a2", "right", "2026-11-02T02:00:00.000Z", { contextMessageIds: ["m_a1"], confidence: 70, level: 4 }),
				answer("a3", "wrong", "2026-11-02T03:00:00.000Z", { tool: "problem", factIds: ["f3", "f3"] }),
				answer("a4", "dontKnow", "2026-11-02T04:00:00.000Z"),
				answer("a5", "right", "2026-11-02T05:00:00.000Z", { confidence: 100, level: 5 }),
				answer("a6", "wrong", "2026-11-02T06:00:00.000Z", { factIds: ["f5"], confidence: 70, level: 4 }),
				answer("a7", "wrong", "2026-11-02T00:00:00.000Z", { factIds: ["f5"], confidence: 90, level: 5 }),
			],
		},
	],
	deadlineSessions: [{ chatId: "c1", deadlineId: "d1", createdAt: "2026-11-01T00:00:00.000Z", done: 1, total: 3 }],
	homeworkSessions: [{ chatId: "c2", deadlineId: "d1", createdAt: "2026-11-02T00:00:00.000Z" }],
};
const MADE_UP = "derive a made-up space with every branch";
add(MADE_UP, { input: madeUp }, () => deriveProgress(madeUp as any));

for (const [i, t] of trimmed.entries()) add(`collect answers ${i}`, { chatId: t.id, messages: t.messages }, () => collectAnswers(t.id, t.messages));
// Predictions are no evidence either way (their type read past model debris, the answer's own
// type first); a study problem names its plan node.
const quizTurn = (id: string, args: Record<string, unknown>, details: Record<string, unknown>) => [
	{ role: "assistant", id: `m_${id}`, content: [{ type: "toolCall", id, name: "quiz", arguments: { question: `Q ${id}?`, ...args } }] },
	{ role: "toolResult", id: `r_${id}`, toolCallId: id, toolName: "quiz", details: { kind: "quiz", correct: false, answeredAt: "2026-11-02T00:00:00.000Z", ...details } },
];
const predictionMessages = [
	...quizTurn("q1", { type: "predict", nodeId: "n1" }, {}),
	...quizTurn("q2", { type: "check" }, { questionType: '"predict"' }),
	...quizTurn("q3", { type: "predict" }, { questionType: "check", confidence: 80 }),
	...quizTurn("q4", { type: " predict:" }, { correct: true }),
	...quizTurn("q5", { type: "check", nodeId: "n5" }, { dontKnow: true }),
	{ role: "assistant", id: "m_p", content: [{ type: "toolCall", id: "p1", name: "problem", arguments: { statement: "Solve it", nodeId: "tpc_1", target: ["f1"] } }] },
	{ role: "toolResult", id: "r_p1", toolCallId: "p1", toolName: "problem", timestamp: 1_762_000_000_000 },
	{ role: "assistant", id: "m_c", content: [{ type: "toolCall", id: "c1", name: "conclude", arguments: { outcome: "surrendered" } }] },
	{ role: "toolResult", id: "r_c1", toolCallId: "c1", toolName: "conclude", timestamp: 1_762_000_100_000 },
];
add("collect answers with predictions and study problems", { chatId: "c9", messages: predictionMessages }, () => collectAnswers("c9", predictionMessages as any));

const rates = [null, 0, 0.2, 0.39, 0.4, 0.5, 0.69, 0.7, 0.9, 1];
add("ramp color and status", { rates }, () => rates.map((r) => ({ color: rampColor(r), status: topicStatus(r) })));
const dayPairs: [string, string][] = [
	["2026-11-10", "2026-11-10"],
	["2026-11-10", "2026-11-11"],
	["2026-11-10", "2026-11-09"],
	["2026-02-27", "2026-03-02"],
	["2026-12-31", "2027-01-01"],
];
add("days between", { pairs: dayPairs }, () => dayPairs.map(([a, b]) => daysBetween(a, b)));

// ─── study sessions ─────────────────────────────────────────────────────────

const progresses: Record<string, any> = { [BASE21]: progress21, [BASE29]: progress29, [MADE_UP]: deriveProgress(madeUp as any) };
for (const [name, p] of Object.entries(progresses)) {
	const files = name === MADE_UP ? madeUp.files : filesOf(name);
	const facts = p.facts as any[];
	add(`fact space order ${name}`, { from: name }, () => Object.fromEntries(factSpaceOrder(p.facts, files)));
	const order = factSpaceOrder(p.facts, files);
	const topics = p.topics as any[];
	const ids = (list: any[], n: number) => list.slice(0, n).map((f) => f.id);
	const picks: Record<string, string[]> = {
		"first five": ids(facts, 5),
		"one topic": topics[0] ? topics[0].members.slice(0, 7) : [],
		"two topics reversed": [...(topics[1]?.members.slice(0, 3) ?? []), ...(topics[0]?.members.slice(0, 3) ?? [])].reverse(),
		"repeats and strangers": [...ids(facts, 3), ...ids(facts, 3), "n_nope", "n_other"],
		"none": [],
		"every fact": ids(facts, facts.length),
	};
	for (const [pick, factIds] of Object.entries(picks)) {
		add(`study topics ${name} ${pick}`, { from: name, factIds, freeTopic: "Typed topic" }, () => studyTopics({ factIds, topics: p.topics, spaceOrder: order, freeTopic: "Typed topic" }));
	}
	const topicIds = topics.map((t) => t.id);
	const sets: Record<string, string[]> = {
		"all topics": topicIds,
		"first two": topicIds.slice(0, 2),
		"repeats and strangers": [...topicIds.slice(0, 2), ...topicIds.slice(0, 2), "tpc_nope"],
		"none": [],
	};
	for (const [label, set] of Object.entries(sets)) {
		add(`topic study ${name} ${label}`, { from: name, topicIds: set, studiedToday: null }, () => topicStudy({ topicIds: set, topics: p.topics, facts: p.facts, spaceOrder: order }));
	}
	const studied = new Set(topicIds.filter((_, i) => i % 2 === 0));
	add(`topic study ${name} with studied today`, { from: name, topicIds, studiedToday: [...studied] }, () =>
		topicStudy({ topicIds, topics: p.topics, facts: p.facts, spaceOrder: order, studiedToday: studied }),
	);
	const strongFirst = new Set(topicIds);
	add(`topic study ${name} all studied today`, { from: name, topicIds, studiedToday: [...strongFirst] }, () =>
		topicStudy({ topicIds, topics: p.topics, facts: p.facts, spaceOrder: order, studiedToday: strongFirst }),
	);

	for (const d of p.deadlines as any[]) {
		for (const today of ["2026-10-01", "2026-11-05", "2026-11-10", "2027-03-01"]) {
			add(`deadline study topics ${name} ${d.id} on ${today}`, { from: name, today, deadline: { date: d.date, topics: d.topics } }, () => deadlineStudyTopicIds(today, d, p.topics));
		}
		add(`plan days ${name} ${d.id}`, { today: "2026-11-05", due: d.date, topics: d.topics }, () => planDays("2026-11-05", d.date, d.topics));
		add(`topics to work on ${name} ${d.id}`, { topics: d.topics }, () => topicsToWorkOn(d.topics));
	}
}

// A strong topic not answered for a week comes back as a check; one answered six days ago, one
// outside the deadline, one never answered and one with an unreadable time do not.
const recheckDeadline = {
	date: "2026-11-20",
	topics: [
		{ id: "a", name: "Alpha", rate: 0.2 },
		{ id: "s", name: "Strong", rate: 0.9 },
		{ id: "r", name: "Recent", rate: 0.95 },
		{ id: "n", name: "Never", rate: null },
		{ id: "x", name: "Unreadable", rate: 0.9 },
	],
};
const strongTopic = (id: string, at: string) => ({ id, status: "strong", answers: [{ outcome: "right", answeredAt: "2026-10-01T12:00:00.000Z" }, { outcome: "right", answeredAt: at }] });
const recheckTopics = [
	strongTopic("s", "2026-11-03T12:00:00.000Z"),
	strongTopic("r", "2026-11-04T12:00:00.000Z"),
	strongTopic("elsewhere", "2026-10-01T12:00:00.000Z"),
	{ id: "n", status: "strong", answers: [] },
	strongTopic("x", "not a time"),
	{ id: "a", status: "weak", answers: [{ outcome: "wrong", answeredAt: "2026-10-01T12:00:00.000Z" }] },
];
for (const today of ["2026-11-10", "2026-11-11", "2026-11-25"]) {
	add(`deadline study topics recheck on ${today}`, { today, deadline: recheckDeadline, topics: recheckTopics }, () => deadlineStudyTopicIds(today, recheckDeadline, recheckTopics as any));
}

const sampleTopics = [
	{ id: "tpc_a", name: "Counting", material: "procedure", status: "weak", latestWrong: true, factIds: ["n_1", "n_2"] },
	{ id: "tpc_b", name: "Probability", status: "shaky", factIds: [] },
	{ id: "topic", name: "Typed topic", status: "untested", factIds: ["n_3"] },
	{ id: "tpc_c", name: "Induction", material: "proof", status: "strong", factIds: ["n_4"] },
];
add("study title", { topics: sampleTopics }, () => studyTitle(sampleTopics as any));
add("study title of one", { topics: sampleTopics.slice(0, 1) }, () => studyTitle(sampleTopics.slice(0, 1) as any));
add("study context text", { topics: sampleTopics }, () => studyContextText(sampleTopics as any));
const planTree = (topics: unknown[]) => {
	try {
		return { tree: studyPlanTree(topics as any) };
	} catch (err) {
		return { error: (err as Error).message };
	}
};
const twice = [...sampleTopics, sampleTopics[0]];
add("study plan tree", { topics: sampleTopics }, () => planTree(sampleTopics));
add("study plan tree with a topic twice", { topics: twice }, () => planTree(twice));
const latestPairs: [string, string | null][] = [
	["weak", "wrong"],
	["weak", "dontKnow"],
	["weak", null],
	["weak", "right"],
	["shaky", "wrong"],
	["strong", "wrong"],
	["untested", null],
];
add("is latest wrong", { pairs: latestPairs }, () => latestPairs.map(([status, latest]) => isLatestWrong(status as any, (latest ?? undefined) as any)));

// ─── plan days and topics to work on ────────────────────────────────────────

const planTopics = [
	{ id: "a", name: "Alpha", rate: 0.2 },
	{ id: "b", name: "Beta", rate: null },
	{ id: "c", name: "Gamma", rate: 0.55 },
	{ id: "d", name: "Delta", rate: 0.95 },
	{ id: "e", name: "Epsilon", rate: 0.2 },
	{ id: "f", name: "Zeta", rate: 0.65 },
	{ id: "g", name: "Eta", rate: null },
];
add("topics to work on", { topics: planTopics }, () => topicsToWorkOn(planTopics));
for (const [today, due] of [
	["2026-11-10", "2026-11-10"],
	["2026-11-10", "2026-11-11"],
	["2026-11-10", "2026-11-12"],
	["2026-11-10", "2026-11-17"],
	["2026-11-10", "2026-12-25"],
	["2026-11-10", "2026-11-09"],
	["2026-12-29", "2027-01-03"],
]) {
	add(`plan days ${today} to ${due}`, { today, due, topics: planTopics }, () => planDays(today, due, planTopics));
}
add("plan days of nothing", { today: "2026-11-10", due: "2026-11-14", topics: [] }, () => planDays("2026-11-10", "2026-11-14", []));
add("plan days of strong topics", { today: "2026-11-10", due: "2026-11-14", topics: planTopics.filter((t) => (t.rate ?? 0) > 0.9) }, () =>
	planDays("2026-11-10", "2026-11-14", planTopics.filter((t) => (t.rate ?? 0) > 0.9)),
);

// ─── continue studying ──────────────────────────────────────────────────────

const sessions = [
	{ chatId: "c1", deadlineId: "d1", createdAt: "2026-11-01T10:00:00.000Z", done: 1, total: 3 },
	{ chatId: "c2", deadlineId: "d1", createdAt: "2026-11-02T10:00:00.000Z", done: 3, total: 3 },
	{ chatId: "c3", deadlineId: "d2", createdAt: "2026-11-02T10:00:00.000Z", done: 0, total: 4 },
	{ chatId: "c4", deadlineId: "d2", createdAt: "2026-11-02T10:00:00.000Z", done: 2, total: 4 },
	{ chatId: "c5", deadlineId: "d3", createdAt: "2026-11-03T10:00:00.000Z", done: 0, total: 0 },
];
for (const id of ["d1", "d2", "d3", "d4"]) add(`continue study ${id}`, { deadlineId: id, sessions }, () => continueStudyFor(id, sessions));
add("continue study with nothing", { deadlineId: "d1", sessions: [] }, () => continueStudyFor("d1", []));

// ─── homework ───────────────────────────────────────────────────────────────

const kinds = ["homework", "exam", "quiz", "project", "lab", "other", ""];
add("has problems", { kinds }, () => kinds.map((k) => hasProblems(k as any)));
const problem = (number: string, title: string, done = false, extra: Record<string, unknown> = {}) => ({ number, title, text: `Text of ${title}`, done, ...extra });
const previous = [problem("1", "Binary search", true, { page: 2 }), problem("2", "Queues", false, { page: 2 }), problem("3", "Counting")];
const posted = [
	{ number: "2", title: "Queues, reworded", text: "New text", page: 3 },
	{ number: "4", title: "Brand new", text: "Fresh" },
	{ number: "1", title: "Binary search", text: "Same", page: 2 },
	{ number: "4", title: "Duplicate four", text: "Dupe" },
];
add("merge problems", { previous, posted }, () => mergeProblems(previous as any, posted as any));
add("merge problems from nothing", { previous: [], posted }, () => mergeProblems([], posted as any));
add("merge problems with nothing posted", { previous, posted: [] }, () => mergeProblems(previous as any, []));
const doneLists: [string, unknown][] = [
	["none", undefined],
	["empty", []],
	["some done", previous],
	["all done", previous.map((p) => ({ ...p, done: true }))],
	["one open", [problem("1", "Only", false)]],
];
for (const [label, list] of doneLists) add(`problems done ${label}`, { problems: list ?? null }, () => problemsDone(list as any));
const homeworkSessions = [
	{ chatId: "h1", deadlineId: "d1", createdAt: "2026-11-01T10:00:00.000Z" },
	{ chatId: "h2", deadlineId: "d1", createdAt: "2026-11-03T10:00:00.000Z" },
	{ chatId: "h3", deadlineId: "d1", createdAt: "2026-11-03T10:00:00.000Z" },
	{ chatId: "h4", deadlineId: "d2", createdAt: "2026-11-02T10:00:00.000Z" },
];
for (const id of ["d1", "d2", "d3"]) add(`latest homework ${id}`, { deadlineId: id, sessions: homeworkSessions }, () => latestHomework(id, homeworkSessions));
const outcomes: unknown[] = ["solved", "solvedWithHints", "movedOn", "surrendered", "dismissed", "", null, undefined, 3, { outcome: "solved" }, [], ["solved"]];
add("conclude marks done", { outcomes: outcomes.map((o) => (o === undefined ? null : o)) }, () => outcomes.map((o) => concludeMarksDone(o)));
const deadline = { id: "ddl_hw5", name: "HW5", kind: "homework", date: "2026-11-09", time: "23:59" };
const assignment = { id: "f_1", name: "HW5.pdf", path: "Homework/HW5.pdf" };
const spaceId = "spc_test_0000aaaa";
add("homework context with problems", { spaceId, deadline, assignment, problems: previous }, () => homeworkContextText(spaceId, deadline as any, assignment, previous as any));
add("homework context without problems", { spaceId, deadline: { ...deadline, time: undefined }, assignment: { ...assignment, path: null }, problems: [] }, () =>
	homeworkContextText(spaceId, { ...deadline, time: undefined } as any, { ...assignment, path: null }, []),
);
add("homework context without an assignment", { spaceId, deadline, assignment: null, problems: previous.slice(0, 1) }, () => homeworkContextText(spaceId, deadline as any, null, previous.slice(0, 1) as any));

// ─── cheat sheets ───────────────────────────────────────────────────────────

const page = { widthPt: 612, heightPt: 792 };
const when = "2026-11-05T10:00:00.000Z";
const version = (n: unknown, extra: Record<string, unknown> = {}) => ({ n, prompt: "ask", at: when, pages: [page], ...extra });
const midterm = readJson(path.join(FIXTURES, "spaces", CSE21, "cheat-sheets", `${MIDTERM}.json`));
const goodRecord = { version: 4, deadlineId: "ddl_x", versions: [version(1), version(2, { file: "/tmp/a.pdf", fromFolder: true })], messages: [], rules: [], folder: "CSE Test", updatedAt: when };
const raws: [string, unknown][] = [
	["the midterm sheet", midterm],
	["a clean format 4 record", goodRecord],
	["not an object", "text"],
	["null", null],
	["an array", []],
	["a number", 7],
	["no deadline id", { version: 4, updatedAt: when }],
	["id is a number", { version: 4, deadlineId: 1, updatedAt: when }],
	["no updatedAt", { version: 4, deadlineId: "d" }],
	["updatedAt is a number", { version: 4, deadlineId: "d", updatedAt: 12 }],
	["empty folder", { ...goodRecord, folder: "" }],
	["folder is a number", { ...goodRecord, folder: 5 }],
	["no version number", { deadlineId: "d", versions: [], updatedAt: when }],
	["version 0", { ...goodRecord, version: 0 }],
	["version 1.5", { ...goodRecord, version: 1.5 }],
	["version 5 is newer", { ...goodRecord, version: 5 }],
	["version 99 is newer", { ...goodRecord, version: 99 }],
	["version is a string", { ...goodRecord, version: "4" }],
	["format 1 block sheet", { version: 1, deadlineId: "d", prefs: { instructions: " x " }, blocks: [{ kind: "x" }], updatedAt: when }],
	["format 2 html sheet", { version: 2, deadlineId: "d", prompts: [{ text: "a", at: when }], doc: { html: "<p>x</p>" }, updatedAt: when }],
	[
		"format 3 with prompts",
		{
			version: 3,
			deadlineId: "d",
			versions: [version(1)],
			prompts: [
				{ text: "first ask", at: when, files: ["a.png", { name: "b.pdf", file: "bbbb-b.pdf" }, 5] },
				{ text: "second ask", at: when },
				{ text: 3, at: when },
				{ at: when },
			],
			updatedAt: when,
		},
	],
	["format 3 without prompts", { version: 3, deadlineId: "d", versions: [], updatedAt: when }],
	[
		"format 4 with unreadable parts",
		{
			version: 4,
			deadlineId: "d",
			versions: [version(1, { pages: [] }), { n: "2" }, 7, version(3, { pages: [page, { widthPt: "x", heightPt: 1 }, { widthPt: null }] }), version(4, { file: 5, fromFolder: false })],
			messages: [
				{ id: 1, role: "you", text: "bad id", at: "x" },
				{ id: "m1", role: "you", text: "kept", at: when, files: ["plain.png", 5, { name: "n", file: 3 }], region: { n: 1 }, about: { kind: "other" } },
				{ id: "m2", role: "robot", text: "x", at: "y" },
				{ id: "m3", role: "agent", text: "made", at: when, version: 3, rules: ["a", 5, "b"] },
				{ id: "m4", role: "agent", text: "no extras", at: when, version: "3", rules: "x" },
			],
			rules: [{ text: "ok", at: when }, { text: 3 }, "str", { text: "no at" }],
			updatedAt: when,
		},
	],
	[
		"messages with regions and about",
		{
			...goodRecord,
			messages: [
				{ id: "a", role: "you", text: "t", at: when, region: { n: 1, page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, about: { kind: "problem", session: "S", text: "Q", work: "w" } },
				{ id: "b", role: "you", text: "t", at: when, region: { n: 1, page: 1.5, x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, about: { kind: "question", session: "S", text: "Q", work: 3 } },
				{ id: "c", role: "you", text: "t", at: when, region: { n: "1", page: 1, x: 0, y: 0, w: 1, h: 1 }, about: { kind: "problem", session: 1, text: "Q" } },
				{ id: "d", role: "you", text: "t", at: when, region: { n: 1, page: 1, x: 0, y: 0, w: 1, h: 1 }, about: { kind: "problem", session: "S", text: "" } },
			],
		},
	],
	["many messages", { ...goodRecord, messages: Array.from({ length: 120 }, (_, i) => ({ id: `m${i}`, role: i % 2 ? "agent" : "you", text: `t${i}`, at: when })) }],
	["many versions", { ...goodRecord, versions: Array.from({ length: 9 }, (_, i) => version(i + 1)) }],
	["rules with surrogates", { ...goodRecord, rules: [{ text: "😀 emoji", at: when }, { text: "", at: when }, { text: "x".repeat(300), at: when }] }],
];
for (const [label, raw] of raws) add(`parse cheat sheet ${label}`, { raw }, () => parseCheatSheet(raw));

const sheetsFor: Record<string, any> = {};
for (const [label, raw] of raws) sheetsFor[label] = parseCheatSheet(raw);
const deadlines = [
	{ id: "early", name: "Early quiz", kind: "quiz", date: "2026-11-12", time: "09:00", done: false },
	{ id: "late", name: "Late exam", kind: "exam", date: "2026-12-01", done: false },
	{ id: "same", name: "Same day", kind: "lab", date: "2026-11-12", done: false },
	{ id: "old", name: "Old hw", kind: "homework", date: "2026-11-01", time: "08:00", done: false },
	{ id: "older", name: "Older hw", kind: "homework", date: "2026-10-01", done: false },
	{ id: "done", name: "Done project", kind: "project", date: "2027-01-01", done: true },
	{ id: "today", name: "Due today", kind: "exam", date: "2026-11-10", done: false },
];
const sheetTable: Record<string, unknown> = {
	early: sheetsFor["a clean format 4 record"],
	late: "newer",
	old: sheetsFor["format 2 html sheet"],
	older: sheetsFor["format 3 without prompts"],
	done: sheetsFor["format 1 block sheet"],
	today: sheetsFor["a clean format 4 record"],
};
for (const [label, running, today] of [
	["nothing running", [], "2026-11-10"],
	["two running", ["early", "older"], "2026-11-10"],
	["later today", [], "2026-12-15"],
] as [string, string[], string][]) {
	add(`sheet cards ${label}`, { deadlines, sheets: sheetTable, running, today }, () =>
		sheetCards(deadlines as any, (id) => (sheetTable[id] as any) ?? null, (id) => running.includes(id), today),
	);
}
add("sheet cards of the fixture deadlines", { deadlines: inputs[BASE21].deadlines, sheets: { [MIDTERM]: parseCheatSheet(midterm) }, running: [], today: "2026-11-10" }, () =>
	sheetCards(inputs[BASE21].deadlines, (id) => (id === MIDTERM ? parseCheatSheet(midterm) : null), () => false, "2026-11-10"),
);

const answerList = [
	{ text: "What is the sum rule?", kind: "wrong", at: "2026-11-01T10:00:00.000Z", topicIds: ["t1", "t9"] },
	{ text: "  What   is the sum\nrule?  ", kind: "hint", at: "2026-11-02T10:00:00.000Z", topicIds: ["t1"] },
	{ text: "Count the strings.", kind: "wrong", at: "2026-11-03T10:00:00.000Z", topicIds: ["t2"] },
	{ text: "Outside topics.", kind: "wrong", at: "2026-11-04T10:00:00.000Z", topicIds: ["t7"] },
	{ text: "   ", kind: "wrong", at: "2026-11-05T10:00:00.000Z", topicIds: ["t1"] },
	{ text: "Long ".repeat(60), kind: "hint", at: "2026-11-06T10:00:00.000Z", topicIds: ["t2", "t1"] },
	{ text: "A", kind: "wrong", at: "2026-11-07T10:00:00.000Z", topicIds: ["t1"] },
	{ text: "B", kind: "wrong", at: "2026-11-08T10:00:00.000Z", topicIds: ["t1"] },
	{ text: "C", kind: "wrong", at: "2026-11-09T10:00:00.000Z", topicIds: ["t1"] },
	{ text: "D😀", kind: "wrong", at: "2026-11-09T11:00:00.000Z", topicIds: ["t2"] },
	{ text: "E", kind: "wrong", at: "2026-11-09T12:00:00.000Z", topicIds: ["t1"] },
	{ text: "F", kind: "wrong", at: "2026-11-09T12:00:00.000Z", topicIds: [] },
];
add("sheet mistakes", { answers: answerList, topicIds: ["t1", "t2"] }, () => sheetMistakes(answerList as any, ["t1", "t2"]));
add("sheet mistakes with no topics", { answers: answerList, topicIds: [] }, () => sheetMistakes(answerList as any, []));
add("sheet mistakes with no answers", { answers: [], topicIds: ["t1"] }, () => sheetMistakes([], ["t1"]));
add("mistake counts", { answers: answerList, topicIds: ["t1", "t2"] }, () => [...mistakeCounts(answerList, ["t1", "t2"])]);
add("mistake counts of nothing", { answers: [], topicIds: ["t1"] }, () => [...mistakeCounts([], ["t1"])]);

const pdfPages = (n: number, w = 612, h = 792) => Array.from({ length: n }, () => ({ widthPt: w, heightPt: h }));
const pdfInputs: { bytes: number; head?: string; pages?: unknown[] }[] = [
	{ bytes: 100 },
	{ bytes: 20 * 1024 * 1024 },
	{ bytes: 20 * 1024 * 1024 + 1 },
	{ bytes: 30_000_000 },
	{ bytes: 100, head: "%PDF-1.7" },
	{ bytes: 100, head: "<html>" },
	{ bytes: 100, head: "" },
	{ bytes: 100, head: "%PDF-", pages: pdfPages(1) },
	{ bytes: 100, head: "%PDF-", pages: pdfPages(0) },
	{ bytes: 100, head: "%PDF-", pages: pdfPages(5) },
	{ bytes: 100, head: "%PDF-", pages: pdfPages(4) },
	{ bytes: 100, pages: pdfPages(1, 143, 792) },
	{ bytes: 100, pages: pdfPages(1, 144, 792) },
	{ bytes: 100, pages: pdfPages(1, 612, 1441) },
	{ bytes: 100, pages: pdfPages(1, 612, 1440) },
	{ bytes: 100, pages: [{ widthPt: 612, heightPt: 792 }, { widthPt: 612, heightPt: 5000 }] },
];
add("pdf problem", { inputs: pdfInputs }, () => pdfInputs.map((p) => pdfProblem(p as any)));

const sizes: [number, number, number][] = [
	[612, 792, 1],
	[792, 612, 2],
	[595.276, 841.89, 2],
	[841.89, 595.276, 2],
	[595, 842, 3],
	[432, 648, 1],
	[648, 432, 1],
	[360, 216, 2],
	[216, 360, 1],
	[300, 300, 4],
	[612, 1008, 1],
	[1008, 612, 2],
	[288, 432, 1],
	[432, 288, 1],
	[1000, 300, 1],
];
add("page size label", { sizes }, () => sizes.map(([w, h, n]) => pageSizeLabel(pdfPages(n, w, h))));
add("page size label of nothing", { sizes: [] }, () => pageSizeLabel([]));

const folderNames: [string, string][] = [
	["CSE 21", "Midterm"],
	["CSE 29", "PA/2: pointers?"],
	["", ""],
	["A", "con"],
	["x".repeat(100), "y".repeat(100)],
	["Intro", "  spaced  out  "],
	["What?", "Final: Part 1 / 2"],
];
add("sheet folder name", { names: folderNames }, () => folderNames.map(([c, d]) => sheetFolderName(c, d)));

const folderFiles = [
	{ name: "sheet.pdf", mtimeMs: Date.parse("2026-11-05T11:00:00.000Z") },
	{ name: "old.PDF", mtimeMs: Date.parse("2026-11-05T09:00:00.000Z") },
	{ name: "Cheat Sheet v2.pdf", mtimeMs: Date.parse("2026-11-06T09:00:00.000Z") },
	{ name: "notes.tex", mtimeMs: Date.parse("2026-11-07T09:00:00.000Z") },
];
add("newer folder pdf after the current version", { files: folderFiles, at: when }, () => newerFolderPdf(folderFiles, { at: when }));
add("newer folder pdf with no current version", { files: folderFiles, at: null }, () => newerFolderPdf(folderFiles, null));
add("newer folder pdf before the current version", { files: folderFiles, at: "2026-11-05T12:00:00.000Z" }, () => newerFolderPdf(folderFiles, { at: "2026-11-05T12:00:00.000Z" }));
add("newer folder pdf with no pdfs", { files: folderFiles.slice(3), at: null }, () => newerFolderPdf(folderFiles.slice(3), null));
add("newer folder pdf with an unreadable date", { files: folderFiles, at: "soon" }, () => newerFolderPdf(folderFiles, { at: "soon" }));

const regionVersions = [version(1, { pages: pdfPages(2) }), version(2, { pages: pdfPages(1) })];
const regions: Record<string, unknown>[] = [
	{ n: 1, page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.35 },
	{ n: 1, page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.35 },
	{ n: 1, page: 3, x: 0.1, y: 0.2, w: 0.3, h: 0.35 },
	{ n: 1, page: 0, x: 0.1, y: 0.2, w: 0.3, h: 0.35 },
	{ n: 1, page: 1.5, x: 0.1, y: 0.2, w: 0.3, h: 0.35 },
	{ n: 9, page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.35 },
	{ n: 2, page: 1, x: 0, y: 0, w: 1, h: 1 },
	{ n: 2, page: 1, x: 0.5, y: 0, w: 0.5005, h: 1 },
	{ n: 2, page: 1, x: 0.5, y: 0, w: 0.502, h: 1 },
	{ n: 2, page: 1, x: -0.1, y: 0, w: 0.5, h: 1 },
	{ n: 2, page: 1, x: 0, y: 0, w: 0, h: 1 },
	{ n: 2, page: 1, x: 0, y: 0, w: 1, h: 1.2 },
	{ n: 2, page: 1, x: 0.105, y: 0.2349, w: 0.2951, h: 0.1 },
];
add("region problem", { regions, versions: regionVersions }, () => regions.map((r) => regionProblem(r as any, regionVersions as any)));
const textCases: [Record<string, unknown>, number][] = [
	[regions[0], 1],
	[regions[0], 2],
	[regions[1], 2],
	[regions[1], 3],
	[regions[12], 2],
	[{ n: 1, page: 1, x: 0.005, y: 0.015, w: 0.045, h: 0.025 }, 2],
	[{ n: 1, page: 1, x: 0.125, y: 0.375, w: 0.5, h: 0.5 }, 1],
];
add("region text", { cases: textCases }, () => textCases.map(([r, pages]) => regionText(r as any, pages)));

const aSheet = { deadlineId: "d", versions: [version(1), version(2)], messages: [{ id: "m1", role: "you", text: "hi", at: when }], rules: [{ text: "A4, both sides", at: when }], updatedAt: when };
add("new cheat sheet", { deadlineId: "ddl_1", now: when }, () => newCheatSheet("ddl_1", when));
add("current version", { sheet: aSheet }, () => currentVersion(aSheet as any));
add("current version of a new sheet", { sheet: newCheatSheet("d", when) }, () => currentVersion(newCheatSheet("d", when)));
const reply = { id: "m2", role: "agent", text: "done", at: when, version: 2 };
add("with message", { sheet: aSheet, message: reply }, () => withMessage(aSheet as any, reply as any));
const crowded = { ...aSheet, messages: Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, role: "you", text: `t${i}`, at: when })) };
add("with message on a full chat", { sheet: crowded, message: reply }, () => withMessage(crowded as any, reply as any));
const newRules = ["Single sided", "a4, BOTH sides", "  single   sided ", "", "😀".repeat(200), "x".repeat(300), "line\nbreak", "ok"];
add("with rules", { sheet: aSheet, texts: newRules, at: "2026-11-06T10:00:00.000Z" }, () => withRules(aSheet as any, newRules, "2026-11-06T10:00:00.000Z"));
add("with rules that are all old", { sheet: aSheet, texts: ["a4, both sides"], at: when }, () => withRules(aSheet as any, ["a4, both sides"], when));
const manyRules = Array.from({ length: 30 }, (_, i) => `rule number ${i}`);
add("with too many rules", { sheet: aSheet, texts: manyRules, at: when }, () => withRules(aSheet as any, manyRules, when));
add("without rule", { sheet: aSheet, text: "A4, both sides" }, () => withoutRule(aSheet as any, "A4, both sides"));
add("without a rule it does not have", { sheet: aSheet, text: "nope" }, () => withoutRule(aSheet as any, "nope"));
const nextVersion = { prompt: "again", at: "2026-11-06T10:00:00.000Z", pages: [page], file: "/tmp/x.pdf" };
add("with version", { sheet: aSheet, version: nextVersion }, () => withVersion(aSheet as any, nextVersion));
const fullSheet = { ...aSheet, versions: Array.from({ length: 5 }, (_, i) => version(i + 3)) };
add("with version on a full sheet", { sheet: fullSheet, version: nextVersion }, () => withVersion(fullSheet as any, nextVersion));
const olderSheet = { ...newCheatSheet("d", when), olderFormat: true };
add("with version on an older format sheet", { sheet: olderSheet, version: nextVersion }, () => withVersion(olderSheet as any, nextVersion));
add("with version on a new sheet", { sheet: newCheatSheet("d", when), version: { prompt: "", at: when, pages: [page], fromFolder: true } }, () =>
	withVersion(newCheatSheet("d", when), { prompt: "", at: when, pages: [page], fromFolder: true }),
);

const topicRows = [
	{ id: "t1", name: "Counting", status: "weak", mistakes: 3, facts: [{ name: "Sum rule", statement: "Adds   disjoint\ncounts." }, { name: "Long", statement: "L".repeat(200) }] },
	{ id: "t2", name: "Probability", status: "untested", mistakes: 1, facts: [{ name: "Bayes", statement: "P(A|B)." }] },
	{ id: "t3", name: "Sorting", status: "strong", mistakes: 0, facts: [] },
	{ id: "t4", name: "Graphs", status: "shaky", mistakes: 0, facts: [{ name: "Edge", statement: "A pair." }] },
];
const mistakeRows = [
	{ topicId: "t1", text: "What is the sum rule?", kind: "wrong", at: when },
	{ topicId: "t2", text: "Bayes problem", kind: "hint", at: when },
	{ topicId: "tx", text: "Outside", kind: "wrong", at: when },
];
const youMessage = (extra: Record<string, unknown>) => ({ id: "m9", role: "you", text: "Make it denser.", at: when, ...extra });
const earlier = [
	{ id: "e1", role: "you", text: "First ask  with   spaces", at: when },
	{ id: "e2", role: "agent", text: "Made it.", at: when, version: 1 },
	{ id: "e3", role: "you", text: "", at: when },
	{ id: "e4", role: "agent", text: "", at: when },
	{ id: "e5", role: "agent", text: "Changed.", at: when, version: 2 },
	...Array.from({ length: 6 }, (_, i) => ({ id: `x${i}`, role: i % 2 ? "agent" : "you", text: `Later ${i} ${"w".repeat(600)}`, at: when })),
];
const baseRequest = {
	title: "CSE 21 Midterm",
	date: "2026-11-04",
	spaceNotes: "We use Rosen.  Notation: |A| is size.",
	infoFiles: ["syllabus.txt", "Course Policies.pdf", "week1.pdf", "week2.pdf"],
	rules: [{ text: "A4, both sides", at: when }, { text: "No colour", at: when }],
	topics: topicRows,
	mistakes: mistakeRows,
	folder: { path: "/home/x/godspeed/cheat-sheets/CSE 21 Midterm", files: [] as string[] },
	versions: [] as unknown[],
	earlier: [] as unknown[],
	message: youMessage({}),
};
const requests: Record<string, any> = {
	"first ask with an empty folder": baseRequest,
	"with a sheet already": { ...baseRequest, versions: [version(1, { pages: pdfPages(2, 841.89, 595.276) }), version(2, { pages: pdfPages(1) })], folder: { path: "/f", files: ["sheet.tex", "sheet.pdf"] } },
	"with many files and info files": {
		...baseRequest,
		infoFiles: Array.from({ length: 12 }, (_, i) => (i === 9 ? "Syllabus.pdf" : i === 4 ? "grading policy.txt" : `info${i}.pdf`)),
		folder: { path: "/f", files: Array.from({ length: 15 }, (_, i) => `file${i}.tex`) },
	},
	"with a chat so far": { ...baseRequest, earlier },
	"with no words": { ...baseRequest, message: youMessage({ text: "   " }) },
	"with nothing else": { title: "T", date: "d", spaceNotes: "", infoFiles: [], rules: [], topics: [], mistakes: [], folder: { path: "/p", files: [] }, versions: [], earlier: [], message: youMessage({}) },
	"about a problem": {
		...baseRequest,
		message: youMessage({ about: { kind: "problem", session: "HW5", text: "Prove the invariant  holds.", work: "  Let lo <= r.  " } }),
	},
	"about a question without work": { ...baseRequest, message: youMessage({ about: { kind: "question", session: "Study: Counting", text: "How many?" } }) },
	"about with long text": { ...baseRequest, message: youMessage({ about: { kind: "problem", session: "S", text: "P".repeat(2000), work: "W".repeat(2000) } }) },
	"pointing at the current version": {
		...baseRequest,
		versions: [version(1, { pages: pdfPages(2) }), version(2, { pages: pdfPages(2) })],
		message: youMessage({ region: { n: 2, page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.35 } }),
	},
	"pointing at an older version": {
		...baseRequest,
		versions: [version(1, { pages: pdfPages(2) }), version(2, { pages: pdfPages(1) })],
		message: youMessage({ region: { n: 1, page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.35 } }),
	},
	"pointing at a gone version": { ...baseRequest, versions: [version(2, { pages: pdfPages(3) })], message: youMessage({ region: { n: 1, page: 2, x: 0, y: 0, w: 0.5, h: 0.5 } }) },
	"one mistake": { ...baseRequest, topics: [{ ...topicRows[0], mistakes: 1 }], mistakes: [] },
};
for (const [label, r] of Object.entries(requests)) add(`cheat sheet request ${label}`, { request: r }, () => cheatSheetRequestText(r));

export default cases;

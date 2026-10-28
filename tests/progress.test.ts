/**
 * PROGRESS (redesign plan, owner-approved 2026-10-27): every derived number
 * of the Overview and the topic Graph (core/progress.ts), plus the server
 * assembly behind GET /api/progress. Isolated LH_DATA_DIR for the route.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-progress-"));
process.env.LH_DATA_DIR = TMP_DATA;

const P = await import("../src/core/progress.ts");
const { classStore } = await import("../src/store/classes.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { graphStoreFor } = await import("../src/server/stores.ts");
const { sourceIdFor } = await import("../src/server/classes.ts");
const progressRoute = await import("../src/app/api/progress/route.ts");

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

import type { LhMessage } from "../src/core/native-messages.ts";
import type { QuestionAnswerData } from "../src/core/question-core.ts";

// ─── fixture builders ───────────────────────────────────────────────────────

const user = (id: string, text: string) => ({ id, role: "user", content: text, timestamp: 0 }) as unknown as LhMessage;
const prose = (id: string, text = "teaching") =>
	({ id, role: "assistant", content: [{ type: "text", text }], timestamp: 0 }) as unknown as LhMessage;
const ask = (id: string, callId: string, tool: string, args: Record<string, unknown>) =>
	({ id, role: "assistant", content: [{ type: "text", text: "Check:" }, { type: "toolCall", id: callId, name: tool, arguments: args }], timestamp: 0 }) as unknown as LhMessage;
const answer = (callId: string, tool: string, ad: Partial<QuestionAnswerData>) =>
	({
		id: `r_${callId}`,
		role: "toolResult",
		toolCallId: callId,
		toolName: tool,
		content: [{ type: "text", text: "{}" }],
		details: { kind: "quiz", questionText: `Q ${callId}?`, dontKnow: false, answers: [], answeredAt: "2026-10-20T00:00:00.000Z", ...ad },
		isError: false,
		timestamp: 0,
	}) as unknown as LhMessage;

const fact = (id: string, provenance: Array<[string, string]>) => ({
	id,
	name: `Fact ${id}`,
	statement: `${id} holds`,
	provenance: provenance.map(([chatId, messageId]) => ({ chatId, messageId })),
});

// Lesson c1: four graded answers. q2's asking message made no facts, so it
// falls back to the prose message before it (m_teach2).
const C1: LhMessage[] = [
	user("u1", "teach me counting"),
	ask("m_ask1", "q1", "quiz", { nodeId: "a", question: "Q1?" }),
	answer("q1", "quiz", { correct: true, confidence: 100, answeredAt: "2026-10-20T01:00:00.000Z" }),
	prose("m_teach2"),
	ask("m_ask2", "q2", "quiz", { nodeId: "b" }),
	answer("q2", "quiz", { correct: false, confidence: 90, answeredAt: "2026-10-20T02:00:00.000Z" }),
	ask("m_ask3", "q3", "quiz", { nodeId: "b" }),
	answer("q3", "quiz", { correct: false, confidence: 80, answeredAt: "2026-10-20T03:00:00.000Z" }),
	ask("m_ask4", "q4", "probe", {}),
	answer("q4", "probe", { tool: "probe", dontKnow: true, answeredAt: "2026-10-20T04:00:00.000Z" }),
	// Not graded: an ask, an explain, and a dismissed quiz.
	ask("m_ask5", "q5", "ask_user_question", {}),
	answer("q5", "ask_user_question", { kind: "ask" }),
	ask("m_ask6", "q6", "quiz", { nodeId: "b" }),
	answer("q6", "quiz", { dismissed: true }),
];
// Lesson c2 (practice): one wrong answer, no confidence.
const C2: LhMessage[] = [ask("m5", "q7", "quiz", {}), answer("q7", "quiz", { correct: false, answeredAt: "2026-10-21T00:00:00.000Z" })];

const FACTS = [
	fact("f1", [["src_A", ""], ["c1", "m_ask1"]]),
	fact("f2", [["src_A", ""]]),
	fact("f3", [["src_A", ""]]),
	fact("f9", [["src_A", ""]]),
	fact("f4", [["src_B", ""], ["c1", "m_teach2"]]),
	fact("f5", [["src_B", ""], ["c1", "m_ask3"]]),
	fact("f7", [["src_B", ""], ["c2", "m5"]]),
	fact("f8", [["src_B", ""]]),
	fact("f10", [["src_C", ""]]),
	fact("f6", [["c1", "m_other"]]),
];
const TOPICS = {
	at: "2026-10-26T00:00:00.000Z",
	topics: [
		{ id: "tpc_1", name: "Counting", members: ["f1", "f2", "f3"] },
		{ id: "tpc_2", name: "Proofs", members: ["f4", "f5", "gone"] },
		{ id: "tpc_3", name: "Induction", members: ["f7", "f8"] },
		{ id: "tpc_4", name: "Graphs", members: ["f9", "f10"] },
	],
};
const CHAINS = [
	{ premises: ["f1"], conclusion: "f4" }, // Counting → Proofs
	{ premises: ["f2", "f3"], conclusion: "f5" }, // Counting → Proofs (weight 2)
	{ premises: ["f5"], conclusion: "f2" }, // Proofs → Counting: the weaker side of a loop
	{ premises: ["f4"], conclusion: "f7" }, // Proofs → Induction
];
const FILES = [
	{ id: "fA", name: "lecture1.md", kind: "study" as const, sourceId: "src_A" },
	{ id: "fS", name: "syllabus.md", kind: "info" as const, sourceId: "src_S" },
	{ id: "fB", name: "lecture2.md", kind: "study" as const, sourceId: "src_B" },
	{ id: "fD", name: "lecture3.md", kind: "study" as const, sourceId: "src_D" }, // no facts yet
	{ id: "fC", name: "lecture4.md", kind: "study" as const, sourceId: "src_C" },
];

const payload = () =>
	P.deriveProgress({
		classId: "cls_test_1",
		today: "2026-10-27",
		facts: FACTS,
		chains: CHAINS,
		topics: TOPICS,
		files: FILES,
		exams: [
			{ id: "exm_final", name: "Final", date: "2026-12-10", fileIds: ["fA", "fB", "fC"] },
			{ id: "exm_mid", name: "Midterm", date: "2026-11-05", fileIds: ["fB"] },
		],
		lessons: [
			{ id: "c1", title: "Counting", updatedAt: "2026-10-20T05:00:00.000Z", messages: C1 },
			{ id: "c2", title: "Practice", kind: "practice", updatedAt: "2026-10-21T05:00:00.000Z", messages: C2 },
		],
	});

// ─── the pieces ─────────────────────────────────────────────────────────────

describe("progress: ramp and statuses", () => {
	it("colors by right rate on the design ramp; gray when untested", () => {
		assert.equal(P.rampColor(null), P.UNTESTED_COLOR);
		assert.deepEqual([0, 0.39, 0.4, 0.54, 0.55, 0.69, 0.7, 0.84, 0.85, 1].map(P.rampColor), [
			"#F2545B", "#F2545B", "#F59E4C", "#F59E4C", "#E8C547", "#E8C547", "#9BD35A", "#9BD35A", "#3DD68C", "#3DD68C",
		]);
	});

	it("strong ≥ 85%, shaky 55–85%, weak < 55%", () => {
		assert.deepEqual([null, 0.85, 0.84, 0.55, 0.54].map(P.topicStatus), ["untested", "strong", "shaky", "shaky", "weak"]);
	});

	it("overconfident needs 2+ answers at level 4–5, right less often than claimed", () => {
		const a = (outcome: "right" | "wrong", level?: 1 | 2 | 3 | 4 | 5) => ({ outcome, level });
		assert.equal(P.isOverconfident([a("wrong", 5)]), false, "one answer is not enough");
		assert.equal(P.isOverconfident([a("right", 5), a("wrong", 4)]), true, "50% right vs a 90% claim");
		assert.equal(P.isOverconfident([a("right", 4), a("right", 4)]), false);
		assert.equal(P.isOverconfident([a("wrong", 3), a("wrong", 3)]), false, "low confidence is honest");
		const fourOfFive = [a("right", 4), a("right", 4), a("right", 4), a("right", 4), a("wrong", 4)];
		assert.equal(P.isOverconfident(fourOfFive), false, "80% right at level 4 is calibrated");
	});

	it("counts whole days", () => {
		assert.equal(P.daysBetween("2026-10-27", "2026-11-05"), 9);
		assert.equal(P.daysBetween("2026-10-27", "2026-10-27"), 0);
		assert.equal(P.daysBetween("2026-10-27", "2026-10-20"), -7);
		assert.equal(P.daysBetween("2026-03-07", "2026-03-09"), 2, "a daylight-saving weekend is still 2 days");
	});
});

describe("progress: answers", () => {
	it("collects graded quiz/probe answers with the asking message and its turn", () => {
		const answers = P.collectAnswers("c1", C1);
		assert.deepEqual(answers.map((a) => [a.toolCallId, a.outcome, a.level, a.messageId, a.contextMessageIds]), [
			["q1", "right", 5, "m_ask1", []],
			["q2", "wrong", 4, "m_ask2", ["m_teach2"]],
			["q3", "wrong", 4, "m_ask3", []],
			["q4", "dontKnow", undefined, "m_ask4", []],
		]);
		assert.equal(answers[0]!.nodeId, "a");
		assert.equal(answers[3]!.tool, "probe");
		assert.equal(answers[0]!.question, "Q q1?");
	});

	it("matches an answer to the facts of the asking message, else the prose before it", () => {
		const index = P.factsByMessage(FACTS);
		const [q1, q2, q3, q4] = P.collectAnswers("c1", C1);
		assert.deepEqual(P.factsForAnswer(q1!, index), ["f1"]);
		assert.deepEqual(P.factsForAnswer(q2!, index), ["f4"], "fallback to m_teach2");
		assert.deepEqual(P.factsForAnswer(q3!, index), ["f5"]);
		assert.deepEqual(P.factsForAnswer(q4!, index), []);
	});
});

describe("progress: topic links and columns", () => {
	it("weights chains between topics and drops the weaker side of a loop", () => {
		const topicOf = new Map([["a1", "A"], ["a2", "A"], ["b1", "B"], ["c1", "C"]]);
		const links = P.topicLinks(
			[
				{ premises: ["a1", "a2"], conclusion: "b1" }, // A→B once (per chain)
				{ premises: ["a1"], conclusion: "b1" }, // A→B: weight 2
				{ premises: ["b1"], conclusion: "a2" }, // B→A: loop, weaker → dropped
				{ premises: ["b1"], conclusion: "c1" },
				{ premises: ["a1"], conclusion: "a2" }, // inside A: no arrow
				{ premises: ["x"], conclusion: "c1" }, // unknown fact: no arrow
			],
			topicOf,
		);
		assert.deepEqual(links, [{ from: "A", to: "B", weight: 2 }, { from: "B", to: "C", weight: 1 }]);
		const columns = P.topicColumns(["A", "B", "C", "D"], [...links, { from: "A", to: "C", weight: 1 }]);
		assert.deepEqual(Object.fromEntries(columns), { A: 0, B: 1, C: 2, D: 0 });
	});
});

// ─── the whole payload ──────────────────────────────────────────────────────

describe("progress: deriveProgress", () => {
	const p = payload();
	const topic = (id: string) => p.topics.find((t) => t.id === id)!;

	it("scores each topic from its facts' answers", () => {
		assert.deepEqual(p.topics.map((t) => t.id), ["tpc_1", "tpc_2", "tpc_3", "tpc_4", "ungrouped"]);
		assert.deepEqual(topic("tpc_2").members, ["f4", "f5"], "a dead member is dropped");
		assert.deepEqual(topic("ungrouped").members, ["f6"]);
		const c = topic("tpc_1");
		assert.deepEqual([c.answered, c.right, c.rate, c.status, c.color, c.overconfident], [1, 1, 1, "strong", "#3DD68C", false]);
		const pr = topic("tpc_2");
		assert.deepEqual([pr.answered, pr.wrong, pr.status, pr.overconfident], [2, 2, "weak", true]);
		assert.deepEqual(pr.answers.map((a) => a.toolCallId), ["q2", "q3"]);
		assert.equal(topic("tpc_3").status, "weak");
		assert.deepEqual([topic("tpc_4").status, topic("tpc_4").color], ["untested", P.UNTESTED_COLOR]);
		assert.deepEqual(p.totals, { answered: 5, right: 1, wrong: 3, dontKnow: 1, rate: 0.2 });
	});

	it("draws topic arrows and columns", () => {
		assert.deepEqual(p.topicLinks, [{ from: "tpc_1", to: "tpc_2", weight: 2 }, { from: "tpc_2", to: "tpc_3", weight: 1 }]);
		assert.deepEqual(p.topics.map((t) => t.column), [0, 1, 2, 0, 0]);
	});

	it("lists facts with their topic, birth and answers", () => {
		const f4 = p.facts.find((f) => f.id === "f4")!;
		assert.deepEqual([f4.topicId, f4.born, f4.inLessons, f4.answers.map((a) => a.outcome)], ["tpc_2", "src_B", true, ["wrong"]]);
		assert.equal(p.facts.find((f) => f.id === "f6")!.topicId, "ungrouped");
		assert.equal(p.facts.find((f) => f.id === "f2")!.inLessons, false);
	});

	it("covers study files in class order and picks Next up", () => {
		assert.deepEqual(p.files.map((f) => [f.fileId, f.facts, f.inLessons, f.share]), [
			["fA", 4, 1, 0.25],
			["fB", 4, 3, 0.75],
			["fD", 0, 0, null],
			["fC", 1, 0, 0],
		]);
		assert.equal(p.nextUp?.fileId, "fC", "the first file with facts and no lesson coverage");
	});

	it("summarizes each lesson, newest first", () => {
		assert.deepEqual(p.lessons.map((l) => [l.chatId, l.kind, l.answers.map((a) => a.outcome), l.right, l.answered, l.score]), [
			["c2", "practice", ["wrong"], 0, 1, 0],
			["c1", "teach", ["right", "wrong", "wrong", "dontKnow"], 1, 4, 0.25],
		]);
	});

	it("measures calibration per level and lists sure-but-wrong answers", () => {
		assert.deepEqual(p.calibration.levels.map((l) => [l.level, l.target, l.answered, l.right, l.rate]), [
			[1, 20, 0, 0, null],
			[2, 40, 0, 0, null],
			[3, 60, 0, 0, null],
			[4, 80, 2, 0, 0],
			[5, 100, 1, 1, 1],
		]);
		assert.deepEqual(p.calibration.sureButWrong.map((s) => [s.toolCallId, s.level, s.lessonTitle, s.messageId]), [
			["q3", 4, "Counting", "m_ask3"],
			["q2", 4, "Counting", "m_ask2"],
		]);
	});

	it("builds each exam: days left, its topics, where you're at, work on next", () => {
		assert.deepEqual(p.exams.map((e) => [e.id, e.daysUntil]), [["exm_mid", 9], ["exm_final", 44]], "soonest first");
		const mid = p.exams[0]!;
		assert.deepEqual(mid.files, [{ id: "fB", name: "lecture2.md" }]);
		assert.deepEqual(mid.topicIds, ["tpc_2", "tpc_3"]);
		assert.deepEqual(mid.counts, { strong: 0, shaky: 0, weak: 2, untested: 0 });
		assert.deepEqual(mid.workOnNext.map((w) => [w.topicId, w.reason]), [
			["tpc_2", "Induction builds on it, so fix it first"],
			["tpc_3", "0% right"],
		]);
		const fin = p.exams[1]!;
		assert.deepEqual(fin.topicIds, ["tpc_1", "tpc_2", "tpc_3", "tpc_4"]);
		assert.deepEqual(fin.counts, { strong: 1, shaky: 0, weak: 2, untested: 1 });
		assert.deepEqual(fin.workOnNext.map((w) => [w.topicId, w.reason]), [
			["tpc_2", "Induction builds on it, so fix it first"],
			["tpc_3", "0% right"],
			["tpc_4", "On the exam, never practiced"],
		]);
	});

	it("falls back to a class-wide view without the Ungrouped bucket", () => {
		assert.deepEqual(p.overall.topicIds, ["tpc_1", "tpc_2", "tpc_3", "tpc_4"]);
		assert.deepEqual(p.overall.workOnNext.at(-1), { topicId: "tpc_4", name: "Graphs", status: "untested", reason: "Never practiced" });
	});

	it("orders work: prerequisites, then overconfident, then the rest, then untested", () => {
		const t = (id: string, rate: number | null, extra: Partial<{ overconfident: boolean; column: number }> = {}) =>
			({ id, name: id, members: [], answered: rate === null ? 0 : 1, right: 0, wrong: 0, dontKnow: 0, rate, status: P.topicStatus(rate), color: "", overconfident: false, answers: [], column: 0, ...extra });
		const items = P.workOnNext(
			[t("Strong", 0.9, { overconfident: true }), t("Shaky", 0.6, { column: 1 }), t("Weak", 0.2), t("Base", 0.5), t("New", null)],
			[{ from: "Base", to: "Shaky", weight: 1 }, { from: "Shaky", to: "Strong", weight: 1 }],
			"exam",
		);
		assert.deepEqual(items.map((i) => [i.topicId, i.reason]), [
			["Base", "Shaky builds on it, so fix it first"],
			["Strong", "overconfident"],
			["Weak", "20% right"],
			["Shaky", "Needed for Strong"],
			["New", "On the exam, never practiced"],
		]);
	});

	it("works with no topics, no files and no exams (No class)", () => {
		const empty = P.deriveProgress({ classId: null, today: "2026-10-27", facts: FACTS.slice(0, 2), chains: [], topics: null, files: [], exams: [], lessons: [] });
		assert.deepEqual(empty.topics.map((t) => [t.id, t.members]), [["ungrouped", ["f1", "f2"]]]);
		assert.deepEqual([empty.files, empty.nextUp, empty.exams, empty.topicsAt], [[], null, [], null]);
		assert.deepEqual(empty.overall, { topicIds: [], counts: { strong: 0, shaky: 0, weak: 0, untested: 0 }, workOnNext: [] });
	});
});

// ─── the plan step bar ──────────────────────────────────────────────────────

describe("progress: planStepBar", () => {
	const tree = { nodes: [{ id: "b", title: "Bayes" }, { id: "a", title: "Priors" }, { id: "c", title: "Posteriors" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }], version: 1 };
	const part = (type: string, nodeId: string | undefined, output: unknown, toolCallId: string) => ({ type, state: output === undefined ? "input-available" : "output-available", toolCallId, input: nodeId ? { nodeId } : {}, output });
	const quiz = (ad: Partial<QuestionAnswerData>) => ({ kind: "quiz", questionText: "?", dontKnow: false, answers: [], answeredAt: "", ...ad });

	it("orders steps by the plan, with statuses and the answers per step", () => {
		const bar = P.planStepBar(tree, [
			{ parts: [part("tool-quiz", "a", quiz({ correct: true, confidence: 70 }), "q1"), part("tool-quiz", "a", quiz({ dontKnow: true }), "q2")] },
			{ parts: [part("tool-explain", "b", { kind: "explain", questionText: "?", dontKnow: false, answers: [], answeredAt: "" }, "q3")] },
			{ parts: [part("tool-quiz", "b", quiz({ dismissed: true }), "q4"), part("tool-quiz", "b", undefined, "q5")] },
		]);
		assert.deepEqual(bar.steps.map((s) => [s.id, s.status]), [["a", "visited"], ["b", "current"], ["c", "upcoming"]]);
		assert.equal(bar.currentIndex, 1);
		assert.deepEqual(bar.steps[0]!.answers, [{ toolCallId: "q1", outcome: "right", level: 3 }, { toolCallId: "q2", outcome: "dontKnow" }]);
		assert.deepEqual(bar.steps[1]!.answers, [{ toolCallId: "q3", outcome: "ungraded" }], "dismissed and unanswered calls don't count");
	});

	it("is empty without a plan", () => {
		assert.deepEqual(P.planStepBar(null, []), { steps: [], currentIndex: -1 });
		assert.equal(P.planStepBar(tree, []).currentIndex, -1);
	});
});

// ─── GET /api/progress ──────────────────────────────────────────────────────

describe("GET /api/progress", () => {
	it("assembles one class's graph, files, exams and lessons", async () => {
		const cls = classStore.createClass({ name: "CSE 21" });
		const file = { id: "f_aaaaaaaaaaaa", origin: "copied" as const, name: "lecture1.md", path: "x/lecture1.md", kind: "study" as const, contentFp: "", status: "ready" as const, addedAt: "2026-10-26T00:00:00.000Z" };
		classStore.saveFiles(cls.id, [file]); // no sourceId recorded: the server derives it
		classStore.addExam(cls.id, { name: "Midterm", date: "2026-11-05", fileIds: [file.id] });
		const src = sourceIdFor(cls.id, file.id);
		const store = graphStoreFor(cls.id);
		const chat = chatStore.createChat("Counting", undefined, cls.id);
		chatStore.saveMessages(chat.id, [ask("m1", "q1", "quiz", { nodeId: "a" }), answer("q1", "quiz", { correct: true, confidence: 100 })]);
		for (const id of ["n1", "n2"]) {
			store.appendNode({ id, name: id, statement: `${id} holds`, aliases: [], createdAt: "2026-10-26T00:00:00.000Z", provenance: [{ chatId: src, messageId: "" }, ...(id === "n1" ? [{ chatId: chat.id, messageId: "m1" }] : [])] });
		}
		store.appendTopics({ at: "2026-10-26T00:00:00.000Z", topics: [{ id: "tpc_x", name: "Counting", members: ["n1", "n2"] }] });
		// A lesson in another class never counts here.
		const other = classStore.createClass({ name: "Other" });
		const stray = chatStore.createChat("Elsewhere", undefined, other.id);
		chatStore.saveMessages(stray.id, [ask("m1", "q9", "quiz", {}), answer("q9", "quiz", { correct: false })]);

		const res = await progressRoute.GET(new Request(`http://localhost/api/progress?class=${cls.id}&today=2026-10-27`));
		assert.equal(res.status, 200);
		const body = (await res.json()) as import("../src/core/progress.ts").ProgressPayload;
		assert.equal(body.classId, cls.id);
		assert.equal(body.grouping, false);
		assert.deepEqual(body.topics.map((t) => [t.name, t.answered, t.status]), [["Counting", 1, "strong"]]);
		assert.deepEqual(body.files.map((f) => [f.name, f.facts, f.inLessons]), [["lecture1.md", 2, 1]]);
		assert.deepEqual(body.lessons.map((l) => l.chatId), [chat.id]);
		assert.deepEqual(body.exams.map((e) => [e.name, e.daysUntil, e.topicIds]), [["Midterm", 9, ["tpc_x"]]]);

		const none = await progressRoute.GET(new Request("http://localhost/api/progress?class=none"));
		assert.equal(none.status, 200);
		assert.equal((await none.json()).classId, null);
		assert.equal((await progressRoute.GET(new Request("http://localhost/api/progress?class=cls_missing_1"))).status, 404);
		assert.equal((await progressRoute.GET(new Request(`http://localhost/api/progress?class=${cls.id}&today=soon`))).status, 400);
	});
});

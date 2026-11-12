/**
 * MOCKS end to end against a scripted agent: the questions land, the
 * clock runs with no agent (answers saved, examples run), ending asks for
 * the grades, the grades count for the sheet's topics, a mock past its
 * time is ended on read, a failed write can be tried again, the routes,
 * and the study sessions a prep starts.
 * Isolated LH_DATA_DIR (set before any config-loading import).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, type ToolCall } from "@earendil-works/pi-ai";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-mocks-"));
process.env.LH_DATA_DIR = path.join(TMP_DATA, "data");
process.env.HOME = path.join(TMP_DATA, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });

const { spaceStore } = await import("../../src/backend/store/spaces.ts");
const { chatStore } = await import("../../src/backend/store/chats.ts");
const { readMock, writeMock } = await import("../../src/backend/store/mocks.ts");
const preps = await import("../../src/backend/server/preps.ts");
const { prepSeams } = await import("../../src/backend/server/prep-runs.ts");
const mocks = await import("../../src/backend/server/mocks.ts");
const { createLesson } = await import("../../src/backend/server/lessons.ts");
const mocksRoute = await import("../../src/app/api/spaces/[id]/mocks/route.ts");
const mockRoute = await import("../../src/app/api/spaces/[id]/mocks/[mockId]/route.ts");
import type { MockView } from "../../src/shared/core/mock.ts";
import type { RunOutcome } from "../../src/shared/core/mock-run.ts";

after(() => {
	prepSeams.engine = undefined;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const SHEET = {
	name: "Acme junior web test",
	about: "Two questions in 30 minutes.",
	sources: [],
	topics: [{ name: "Strings" }, { name: "Closures" }],
	mock: { questions: 2, minutes: 30 },
};

const CODE = "function countVowels(s) {\n\treturn [...s].filter((c) => 'aeiou'.includes(c)).length;\n}\n";

/** The mock's two questions: a code one on the first topic, a written one on the second. */
const questions = (topicIds: string[]) => ({
	questions: [
		{
			title: "Count the vowels",
			statement: "Return how many vowels `s` has.",
			kind: "code",
			topic_id: topicIds[0],
			function_name: "countVowels",
			params: ["s"],
			examples: [
				{ args: '["hello"]', expected: "2" },
				{ args: '["xyz"]', expected: "0" },
			],
		},
		{ title: "Explain closures", statement: "What is a closure?", kind: "text", topic_id: topicIds[1] },
	],
});

type Step = { tool: string; args: Record<string, unknown> } | string;

/** A faux agent that answers each request with the next step (a string:
 *  it only talks); records each request's prompt and what godspeed
 *  answered its calls. */
function agent(...steps: Step[]) {
	const faux = createFauxCore({});
	const prompts: string[] = [];
	const replies: string[] = [];
	faux.setResponses(
		steps.map((step) => (ctx: { messages: Array<{ role: string; content: unknown }> }) => {
			const first = ctx.messages.find((m) => m.role === "user");
			prompts.push(typeof first?.content === "string" ? first.content : JSON.stringify(first?.content));
			const last = ctx.messages[ctx.messages.length - 1];
			if (last?.role === "toolResult") replies.push(JSON.stringify(last.content));
			if (typeof step === "string") return fauxAssistantMessage([fauxText(step)], { stopReason: "stop" });
			return fauxAssistantMessage([fauxToolCall(step.tool, step.args as ToolCall["arguments"])], { stopReason: "toolUse" });
		}),
	);
	prepSeams.engine = { model: faux.getModel(), streamFn: faux.streamSimple };
	return { prompts, replies };
}

const prep = (spaceId: string) => {
	const v = preps.prepView(spaceId);
	assert.ok(v.ok);
	return v.value;
};

const view = (spaceId: string, mockId: string): MockView => {
	const v = mocks.mockView(spaceId, mockId);
	assert.ok(v.ok);
	return v.value;
};

async function until(done: () => boolean, what: string): Promise<void> {
	for (let i = 0; i < 1000 && !done(); i++) await new Promise((r) => setTimeout(r, 5));
	assert.ok(done(), what);
}

/** A prep whose sheet is written. */
async function newPrep(): Promise<{ spaceId: string; topicIds: string[] }> {
	agent({ tool: "write_prep_sheet", args: SHEET });
	const made = preps.createPrep({ goal: "Acme online test for a junior web role" });
	assert.ok(made.ok);
	const { spaceId } = made.value;
	await until(() => !prep(spaceId).writing, "the sheet was written");
	return { spaceId, topicIds: prep(spaceId).topics.map((t) => t.id) };
}

const settled = (spaceId: string, mockId: string) => until(() => !view(spaceId, mockId).working, "the mock's request ended");

/** A mock of the prep with its questions written. */
async function readyMock(spaceId: string, topicIds: string[]): Promise<string> {
	agent({ tool: "write_mock_questions", args: questions(topicIds) });
	const made = mocks.createMock(spaceId);
	assert.ok(made.ok);
	await settled(spaceId, made.value.mockId);
	return made.value.mockId;
}

const ctx = (id: string, mockId: string) => ({ params: Promise.resolve({ id, mockId }) });
const post = (id: string, mockId: string, body: unknown) => mockRoute.POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx(id, mockId));
const state = (spaceId: string, mockId: string) => prep(spaceId).mocks.find((m) => m.id === mockId)?.state;

describe("a mock", () => {
	it("is written, taken with no agent, graded, and counts for the sheet's topics", async () => {
		agent({ tool: "write_prep_sheet", args: SHEET });
		const made = preps.createPrep({ goal: "Acme online test for a junior web role" });
		assert.ok(made.ok);
		const { spaceId } = made.value;
		const early = mocks.createMock(spaceId);
		assert.ok(!early.ok && early.status === 409 && /Write the sheet first/.test(early.error), "no mock before the sheet says what one is");
		await until(() => !prep(spaceId).writing, "the sheet was written");
		const topicIds = prep(spaceId).topics.map((t) => t.id);

		const writer = agent({ tool: "write_mock_questions", args: questions(topicIds) });
		const res = await mocksRoute.POST(new Request("http://x/api", { method: "POST" }), { params: Promise.resolve({ id: spaceId }) });
		assert.equal(res.status, 201);
		const { mockId } = (await res.json()) as { mockId: string };
		assert.equal(state(spaceId, mockId), "writing");
		const second = mocks.createMock(spaceId);
		assert.ok(!second.ok && second.error === "Finish Mock 1 first.");
		await settled(spaceId, mockId);
		assert.match(writer.prompts[0]!, /They are preparing for: Acme online test for a junior web role/);
		assert.match(writer.prompts[0]!, /Write a mock of exactly 2 questions for 30 minutes\./);
		assert.ok(writer.prompts[0]!.includes(`- ${topicIds[0]}: Strings (not tested yet)`));

		const ready = view(spaceId, mockId).mock;
		assert.deepEqual(ready.questions.map((q) => [q.id, q.kind, q.topicId]), [["q1", "code", topicIds[0]], ["q2", "text", topicIds[1]]]);
		assert.equal(state(spaceId, mockId), "ready");
		const PY = "def countVowels(s):\n    return 0\n";
		const answer = { action: "answer", questionId: "q1", text: CODE, language: "javascript", code: { javascript: CODE, python: PY }, seconds: 61.4, submitted: true };
		assert.equal((await post(spaceId, mockId, answer)).status, 409, "no answers before the clock starts");
		assert.equal((await post(spaceId, mockId, { action: "run", questionId: "q1", code: CODE, language: "javascript" })).status, 409);

		assert.equal((await post(spaceId, mockId, { action: "start" })).status, 200);
		assert.equal((await post(spaceId, mockId, { action: "start" })).status, 409);
		assert.equal(state(spaceId, mockId), "running");
		assert.equal((await post(spaceId, mockId, answer)).status, 200);
		assert.deepEqual(view(spaceId, mockId).mock.answers.q1, { text: CODE, language: "javascript", code: { javascript: CODE, python: PY }, seconds: 61, submitted: true }, "both languages are kept");

		const ran = await post(spaceId, mockId, { action: "run", questionId: "q1", code: CODE, language: "javascript" });
		assert.equal(ran.status, 200);
		assert.deepEqual(((await ran.json()) as RunOutcome).examples, [{ returned: "2", passed: true }, { returned: "0", passed: true }]);
		assert.equal((await post(spaceId, mockId, { action: "run", questionId: "q2", code: CODE, language: "javascript" })).status, 404, "a written question has nothing to run");
		assert.equal((await post(spaceId, mockId, { action: "run", questionId: "q1", code: CODE, language: "ruby" })).status, 400);

		const grader = agent({ tool: "grade_mock", args: { grades: [] } }, { tool: "grade_mock", args: { grades: [{ question: "q1", verdict: "right", feedback: "Correct and fast enough." }] } });
		assert.equal((await post(spaceId, mockId, { action: "end" })).status, 200);
		assert.equal(state(spaceId, mockId), "grading");
		assert.equal((await post(spaceId, mockId, { action: "retry" })).status, 409, "the teacher is still grading");
		await settled(spaceId, mockId);
		assert.match(grader.prompts[0]!, /Mock 1: 2 questions in 30 minutes\. They used 1 of them\./);
		assert.match(grader.prompts[0]!, /Their answer \(JavaScript, 1 min\):/);
		assert.match(grader.prompts[0]!, /Run on the examples here: example 1 passed, example 2 passed\./);
		assert.match(grader.prompts[0]!, /## q2: Explain closures \(written\)\nWhat is a closure\?\nThey left this blank\. Don't grade it\./);
		assert.match(grader.replies[0]!, /No grade for q1/, "grades that miss an answered question are sent back");

		const graded = view(spaceId, mockId).mock;
		assert.deepEqual(graded.grades, { q1: { verdict: "right", feedback: "Correct and fast enough." } });
		const sheet = prep(spaceId);
		assert.deepEqual(sheet.mocks.map((m) => [m.n, m.state, m.solved]), [[1, "graded", 1]]);
		assert.deepEqual(sheet.topics.map((t) => [t.name, t.answered, t.right]), [["Strings", 1, 1], ["Closures", 1, 0]], "a blank question counts as not known");

		const goOver = createLesson({ spaceId, mockQuestion: { mockId, questionId: "q1" } });
		assert.ok(goOver.ok);
		assert.equal(goOver.title, "Go over: Count the vowels");
		const lesson = chatStore.getChat(goOver.chat.id)!;
		assert.deepEqual(lesson.tree?.nodes.map((n) => n.id), [topicIds[0]], "its topic is the plan's one step");
		const [card, plan] = lesson.messages;
		assert.ok(card?.role === "custom" && card.customType === "space-context" && typeof card.content === "string");
		assert.match(card.content, /This space is a prep\. The learner is getting ready for: Acme online test for a junior web role/);
		assert.match(card.content, /Two questions in 30 minutes\./);
		assert.ok(plan?.role === "custom" && plan.customType === "study-context" && typeof plan.content === "string");
		assert.match(plan.content, /\[Mock question\] The learner wants to go over this question from Mock 1\./);
		assert.match(plan.content, /Your grade then: right\. Your feedback then:\nCorrect and fast enough\./);
		assert.match(plan.content, new RegExp(`1\\. Strings — node ${topicIds[0]}, strong, no facts`), "its topic with where the learner stands");
		assert.deepEqual(createLesson({ spaceId, mockQuestion: { mockId, questionId: "q9" } }), { ok: false, status: 404, code: "topics_not_found", error: "No such question" });
		const studyPlan = (chatId: string) => {
			const content = chatStore.getChat(chatId)!.messages.find((m) => m.role === "custom" && m.customType === "study-context")?.content;
			assert.equal(typeof content, "string");
			return content as string;
		};
		const blank = createLesson({ spaceId, mockQuestion: { mockId, questionId: "q2" } });
		assert.ok(blank.ok);
		assert.match(studyPlan(blank.chat.id), new RegExp(`1\\. Closures — node ${topicIds[1]}, weak \\(latest wrong\\)`), "left blank: taught first");
		const { topicId: _topic, ...untagged } = graded.questions[1]!;
		writeMock(spaceId, { ...graded, questions: [graded.questions[0]!, untagged] });
		const free = createLesson({ spaceId, mockQuestion: { mockId, questionId: "q2" } });
		assert.ok(free.ok);
		assert.match(studyPlan(free.chat.id), /1\. Explain closures — node topic, weak \(latest wrong\)/, "a question with no topic is its own, gone over because it went wrong");

		const next = agent({ tool: "write_mock_questions", args: questions(topicIds) });
		const again = mocks.createMock(spaceId);
		assert.ok(again.ok, "a graded mock no longer holds the next one back");
		await settled(spaceId, again.value.mockId);
		assert.equal(view(spaceId, again.value.mockId).mock.n, 2);
		assert.match(next.prompts[0]!, /Earlier mocks asked these\. Don't ask them again:\n- Count the vowels\n- Explain closures/);
		assert.equal((await mockRoute.DELETE(new Request("http://x/api", { method: "DELETE" }), ctx(spaceId, again.value.mockId))).status, 200);
		assert.equal(mocks.mockView(spaceId, again.value.mockId).ok, false);
		assert.deepEqual(prep(spaceId).mocks.map((m) => m.n), [1]);
	});

	it("is ended on read once its time is over, and with nothing answered nothing is asked", async () => {
		const { spaceId, topicIds } = await newPrep();
		const mockId = await readyMock(spaceId, topicIds);
		assert.ok(mocks.changeMock(spaceId, mockId, { action: "start" }).ok);
		const { prompts } = agent("never asked");
		const startedAt = new Date(Date.now() - 31 * 60_000).toISOString();
		writeMock(spaceId, { ...readMock(spaceId, mockId)!, startedAt });

		const over = view(spaceId, mockId);
		assert.equal(over.mock.endedAt, new Date(Date.parse(startedAt) + 30 * 60_000).toISOString(), "ended when its time ran out, not when it was read");
		assert.deepEqual(over.mock.grades, {});
		assert.equal(over.working, false);
		assert.equal(prompts.length, 0);
		assert.deepEqual(prep(spaceId).mocks.map((m) => [m.state, m.solved]), [["graded", 0]]);
		assert.equal(mocks.changeMock(spaceId, mockId, { action: "retry" }).ok, false, "nothing to try again");
	});

	it("is ended when its prep is read once its time is over, so the next one can be made", async () => {
		const { spaceId, topicIds } = await newPrep();
		const mockId = await readyMock(spaceId, topicIds);
		assert.ok(mocks.changeMock(spaceId, mockId, { action: "start" }).ok);
		writeMock(spaceId, { ...readMock(spaceId, mockId)!, startedAt: new Date(Date.now() - 31 * 60_000).toISOString() });
		assert.deepEqual(prep(spaceId).mocks.map((m) => m.state), ["graded"], "the prep's page never shows it running");
		agent({ tool: "write_mock_questions", args: questions(topicIds) });
		const next = mocks.createMock(spaceId);
		assert.ok(next.ok, "it no longer holds the next one back");
		await settled(spaceId, next.value.mockId);
	});

	it("refuses answers and runs once its time is over, and ends then", async () => {
		const { spaceId, topicIds } = await newPrep();
		const mockId = await readyMock(spaceId, topicIds);
		assert.ok(mocks.changeMock(spaceId, mockId, { action: "start" }).ok);
		writeMock(spaceId, { ...readMock(spaceId, mockId)!, startedAt: new Date(Date.now() - 31 * 60_000).toISOString() });
		const ran = await mocks.runMockExamples(spaceId, mockId, { questionId: "q1", code: CODE, language: "javascript" });
		assert.deepEqual(ran, { ok: false, status: 409, error: "Time is up." });
		assert.equal(readMock(spaceId, mockId)!.endedAt !== undefined, true, "the run ended it");

		const later = await readyMock(spaceId, topicIds);
		assert.ok(mocks.changeMock(spaceId, later, { action: "start" }).ok);
		writeMock(spaceId, { ...readMock(spaceId, later)!, startedAt: new Date(Date.now() - 31 * 60_000).toISOString() });
		const saved = mocks.changeMock(spaceId, later, { action: "answer", questionId: "q1", answer: { text: CODE, language: "javascript", code: { javascript: CODE }, seconds: 5, submitted: true } });
		assert.deepEqual(saved, { ok: false, status: 409, error: "Time is up." });
		assert.deepEqual(readMock(spaceId, later)!.answers, {}, "the late answer isn't kept");
		assert.equal(state(spaceId, later), "graded");
	});

	it("says why a write failed, sends bad questions back, and asks again on retry", async () => {
		const { spaceId, topicIds } = await newPrep();
		agent("I can't write one.", "No.", "No.", "No.", "No.");
		const made = mocks.createMock(spaceId);
		assert.ok(made.ok);
		const { mockId } = made.value;
		await settled(spaceId, mockId);
		assert.match(view(spaceId, mockId).error ?? "", /never sent the questions/);
		assert.match(prep(spaceId).mocks[0]!.error ?? "", /never sent the questions/);
		assert.equal(state(spaceId, mockId), "writing");

		const { replies } = agent({ tool: "write_mock_questions", args: { questions: questions(topicIds).questions.slice(0, 1) } }, { tool: "write_mock_questions", args: questions(topicIds) });
		assert.equal((await post(spaceId, mockId, { action: "retry" })).status, 200);
		await settled(spaceId, mockId);
		assert.match(replies[0]!, /Write exactly 2 questions \(got 1\)\./);
		assert.equal(view(spaceId, mockId).error, undefined);
		assert.equal(state(spaceId, mockId), "ready");
		assert.equal((await post(spaceId, mockId, { action: "retry" })).status, 409);
	});

	it("refuses ids and actions it doesn't know through its routes", async () => {
		const { spaceId, topicIds } = await newPrep();
		const mockId = await readyMock(spaceId, topicIds);
		const got = await mockRoute.GET(new Request("http://x/api"), ctx(spaceId, mockId));
		assert.equal(((await got.json()) as MockView).prepName, "Acme junior web test");
		assert.equal((await mockRoute.GET(new Request("http://x/api"), ctx(spaceId, "nope"))).status, 404);
		assert.equal((await mockRoute.GET(new Request("http://x/api"), ctx(spaceId, "mock_00000000"))).status, 404);
		assert.equal((await post(spaceId, mockId, { action: "nope" })).status, 400);
		assert.equal((await post(spaceId, mockId, { action: "answer", questionId: "q1" })).status, 400);
		assert.equal((await post("nope", mockId, { action: "start" })).status, 404);
		const plain = spaceStore.createSpace({ name: "Plain space" });
		assert.equal((await mocksRoute.POST(new Request("http://x/api", { method: "POST" }), { params: Promise.resolve({ id: plain.id }) })).status, 404);
	});
});

describe("a prep's study session", () => {
	it("takes the topics that most need work, or the ones named", async () => {
		const { spaceId, topicIds } = await newPrep();
		const weakest = createLesson({ spaceId, prepTopicIds: [] });
		assert.ok(weakest.ok);
		assert.deepEqual(chatStore.getChat(weakest.chat.id)!.tree?.nodes.map((n) => n.id), topicIds);
		const one = createLesson({ spaceId, prepTopicIds: [topicIds[1]!] });
		assert.ok(one.ok);
		assert.equal(one.title, "Study: Closures");
		assert.deepEqual(chatStore.getChat(one.chat.id)!.tree?.nodes.map((n) => n.id), [topicIds[1]]);
		assert.deepEqual(createLesson({ spaceId, prepTopicIds: ["pt_00000000"] }), { ok: false, status: 404, code: "topics_not_found", error: "No such topics" });
	});
});

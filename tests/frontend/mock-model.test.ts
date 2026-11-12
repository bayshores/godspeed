/** A mock's words and counts on its pages. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MockQuestion, MockSummary } from "../../src/shared/core/mock.ts";
import {
	answerOf,
	clockText,
	exampleCall,
	exampleLine,
	fixFirst,
	lastMockLine,
	mockHref,
	mockLine,
	nextOpen,
	openMock,
	openMockLabel,
	parseMockLanguage,
	spentText,
	workOf,
} from "../../src/frontend/components/prep/mock-model.ts";

const FORMAT = { questions: 4, minutes: 70 };
const summary = (over: Partial<MockSummary>): MockSummary => ({ id: "mock_1", n: 1, state: "graded", format: FORMAT, createdAt: "2026-11-11T09:00:00.000Z", working: false, ...over });

const CODE: MockQuestion = { id: "q1", title: "Two sum", statement: "s", kind: "code", topicId: "pt_a", fn: { name: "twoSum", params: ["nums", "target"] }, examples: [{ args: "[[2,7],9]", expected: "[0,1]" }] };
const TEXT: MockQuestion = { id: "q2", title: "Event loop", statement: "s", kind: "text", topicId: "pt_b" };

describe("a mock's words", () => {
	it("links to its page", () => {
		assert.equal(mockHref("cls_a", "mock_1"), "/space/mock/cls_a/mock_1");
	});
	it("shows the clock with hours only when there are some", () => {
		assert.equal(clockText(48 * 60 + 12), "48:12");
		assert.equal(clockText(3600 + 8 * 60 + 2), "1:08:02");
		assert.equal(clockText(-4), "00:00");
	});
	it("says how long a question took", () => {
		assert.equal(spentText(59), "under a minute");
		assert.equal(spentText(12 * 60 + 10), "12 min");
	});
	it("says where a mock is", () => {
		const start = Date.parse("2026-11-11T10:00:00.000Z");
		assert.equal(mockLine(summary({ state: "writing", working: true }), 0), "being written");
		assert.equal(mockLine(summary({ state: "writing" }), 0), "not written");
		assert.equal(mockLine(summary({ state: "ready" }), 0), "ready to start");
		assert.equal(mockLine(summary({ state: "running", startedAt: new Date(start).toISOString() }), start + 38 * 60_000 + 1000), "32 min left");
		assert.equal(mockLine(summary({ state: "grading", working: true }), 0), "being graded");
		assert.equal(mockLine(summary({ state: "grading" }), 0), "not graded");
		assert.equal(mockLine(summary({ solved: 2 }), 0), "2 of 4 solved");
	});
	it("finds the unfinished mock and names its button", () => {
		const mocks = [summary({}), summary({ id: "mock_2", n: 2, state: "running" })];
		assert.equal(openMock(mocks)?.id, "mock_2");
		assert.equal(openMock([summary({})]), undefined);
		assert.equal(openMockLabel(summary({ n: 2, state: "ready" })), "Start Mock 2");
		assert.equal(openMockLabel(summary({ n: 2, state: "running" })), "Continue Mock 2");
		assert.equal(openMockLabel(summary({ n: 2, state: "grading" })), "Open Mock 2");
	});
	it("says how the last graded mock went", () => {
		assert.equal(lastMockLine([]), "None taken yet.");
		assert.equal(lastMockLine([summary({ solved: 1 }), summary({ n: 2, solved: 3 }), summary({ n: 3, state: "ready" })]), "Mock 2: 3 of 4 solved.");
	});
});

describe("a code question's examples", () => {
	it("are shown as calls", () => {
		assert.equal(exampleCall({ name: "twoSum", params: ["nums", "target"] }, "[[2,7,11,15], 9]"), "twoSum([2,7,11,15], 9)");
		assert.equal(exampleCall({ name: "f", params: ["s"] }, '["a b"]'), 'f("a b")');
		assert.equal(exampleCall({ name: "f", params: ["s"] }, "not json"), "f(not json)");
	});
	it("say what came back", () => {
		assert.equal(exampleLine({ returned: "3", passed: true }, "3"), "returned 3");
		assert.equal(exampleLine({ returned: "2", passed: false }, "1"), "returned 2, should be 1");
		assert.equal(exampleLine({ error: "TypeError: x", passed: false }, "1"), "TypeError: x");
	});
});

describe("a graded mock", () => {
	it("names the topics of what wasn't right, each once, in question order", () => {
		const topics = [
			{ id: "pt_a", name: "Arrays" },
			{ id: "pt_b", name: "Async" },
		];
		const questions = [TEXT, CODE, { ...CODE, id: "q3" }, { ...TEXT, id: "q4", topicId: "pt_gone" }];
		assert.deepEqual(fixFirst({ questions, grades: { q1: { verdict: "right", feedback: "f" }, q2: { verdict: "partly", feedback: "f" } } }, topics), [
			{ id: "pt_b", name: "Async" },
			{ id: "pt_a", name: "Arrays" },
		]);
		assert.deepEqual(fixFirst({ questions: [CODE], grades: { q1: { verdict: "right", feedback: "f" } } }, topics), []);
	});
});

describe("answering", () => {
	it("goes to the next question that isn't submitted, wrapping around", () => {
		assert.equal(nextOpen([false, true, false], 0), 2);
		assert.equal(nextOpen([false, true, true], 1), 0);
		assert.equal(nextOpen([false, true, true], 0), 0, "only this one is left");
		assert.equal(nextOpen([true, true], 0), null);
	});
	it("remembers JavaScript unless Python was picked", () => {
		assert.equal(parseMockLanguage("python"), "python");
		assert.equal(parseMockLanguage(null), "javascript");
		assert.equal(parseMockLanguage("ruby"), "javascript");
	});
	it("starts a code question from the function's first lines, and saves those as no answer", () => {
		const work = workOf(CODE, undefined, "python");
		assert.equal(work.language, "python");
		assert.match(work.code.python, /^def twoSum\(nums, target\):/);
		assert.match(work.code.javascript, /^function twoSum\(nums, target\) \{/);
		assert.deepEqual(answerOf(CODE, work), { text: "", language: "python", seconds: 0, submitted: false });
		const typed = { ...work, code: { ...work.code, python: "def twoSum(nums, target):\n    return [0, 1]\n" }, seconds: 90, submitted: true };
		assert.deepEqual(answerOf(CODE, typed), { text: typed.code.python, language: "python", seconds: 90, submitted: true });
	});
	it("keeps the code written in one language while the other is only looked at", () => {
		const js = "function twoSum() { return [0, 1]; }";
		const work = { ...workOf(CODE, { text: js, language: "javascript", seconds: 30, submitted: false }, "javascript"), language: "python" as const };
		assert.deepEqual(answerOf(CODE, work), { text: js, language: "javascript", seconds: 30, submitted: false });
		assert.equal(workOf(CODE, answerOf(CODE, work), "python").code.javascript, js, "coming back shows it again");
		const both = { ...work, code: { ...work.code, python: "def twoSum(nums, target):\n    return [1, 0]\n" } };
		assert.equal(answerOf(CODE, both).language, "python", "once the picked one is written, it is the answer");
	});
	it("picks a saved answer back up in its own language", () => {
		const work = workOf(CODE, { text: "function twoSum() { return [] }", language: "javascript", seconds: 30, submitted: true }, "python");
		assert.equal(work.language, "javascript");
		assert.equal(work.code.javascript, "function twoSum() { return [] }");
		assert.equal(work.seconds, 30);
		assert.equal(work.submitted, true);
	});
	it("keeps a written answer as typed", () => {
		const work = workOf(TEXT, { text: "It is a queue.", seconds: 12, submitted: false }, "javascript");
		assert.equal(work.text, "It is a queue.");
		assert.deepEqual(answerOf(TEXT, { ...work, text: "It is a loop." }), { text: "It is a loop.", seconds: 12, submitted: false });
	});
});

/** A mock's words and counts on its pages. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Mock, MockQuestion, MockSummary } from "../../src/shared/core/mock.ts";
import {
	answerOf,
	clockText,
	endedByTime,
	exampleCall,
	exampleLine,
	formatLine,
	mockAnnouncement,
	mockHref,
	mockLine,
	nextOpen,
	openMock,
	openMockLabel,
	parseMockLanguage,
	pauseLine,
	spentText,
	usedLine,
	workOf,
} from "../../src/frontend/components/mock/mock-model.ts";

const FORMAT = { questions: 4, minutes: 70 };
const summary = (over: Partial<MockSummary>): MockSummary => ({ id: "mock_1", deadlineId: "ddl_1", n: 1, state: "graded", format: FORMAT, createdAt: "2026-11-11T09:00:00.000Z", working: false, ...over });

const CODE: MockQuestion = { id: "q1", title: "Two sum", statement: "s", kind: "code", factIds: ["fct_a"], fn: { name: "twoSum", params: ["nums", "target"] }, examples: [{ args: "[[2,7],9]", expected: "[0,1]" }] };
const TEXT: MockQuestion = { id: "q2", title: "Event loop", statement: "s", kind: "text" };

describe("a mock's words", () => {
	it("links to its page", () => {
		assert.equal(mockHref("cls_a", "mock_1"), "/space/mock/cls_a/mock_1");
	});
	it("shows the clock with hours only when there are some", () => {
		assert.equal(clockText(48 * 60 + 12), "48:12");
		assert.equal(clockText(3600 + 8 * 60 + 12), "1:08:12");
		assert.equal(clockText(-5), "00:00");
	});
	it("says how long a question took", () => {
		assert.equal(spentText(30), "under a minute");
		assert.equal(spentText(12 * 60 + 20), "12 min");
	});
	it("says how many questions, and the time limit or that there is none", () => {
		assert.equal(formatLine({ questions: 5 }), "5 questions, no time limit");
		assert.equal(formatLine({ questions: 1, minutes: 45 }), "1 question in 45 minutes");
	});
	it("says where a mock is, a paused one with its time left", () => {
		const start = Date.parse("2026-11-11T10:00:00.000Z");
		assert.equal(mockLine(summary({ state: "writing", working: true }), 0), "being written");
		assert.equal(mockLine(summary({ state: "writing" }), 0), "not written");
		assert.equal(mockLine(summary({ state: "ready" }), 0), "ready to start");
		assert.equal(mockLine(summary({ state: "running", startedAt: new Date(start).toISOString(), endsAt: new Date(start + 70 * 60_000).toISOString() }), start + 38 * 60_000 + 1000), "32 min left");
		assert.equal(mockLine(summary({ state: "running", format: { questions: 4 }, startedAt: new Date(start).toISOString() }), start + 60_000), "started");
		assert.equal(mockLine(summary({ state: "paused", paused: { at: new Date(start).toISOString(), left: 31 * 60 + 9 } }), start + 86_400_000), "Paused, 31:09 left");
		assert.equal(mockLine(summary({ state: "grading", working: true }), 0), "being graded");
		assert.equal(mockLine(summary({ state: "grading" }), 0), "not graded");
		assert.equal(mockLine(summary({ solved: 2 }), 0), "2 of 4 right");
	});
	it("finds the unfinished mock and names its button", () => {
		const mocks = [summary({ id: "mock_3", n: 3, state: "paused" }), summary({ id: "mock_2", n: 2 })];
		assert.equal(openMock(mocks)?.id, "mock_3");
		assert.equal(openMock([summary({})]), undefined);
		assert.equal(openMockLabel({ n: 2, state: "ready" }), "Start Mock 2");
		assert.equal(openMockLabel({ n: 3, state: "paused" }), "Continue Mock 3");
		assert.equal(openMockLabel({ n: 3, state: "writing" }), "Continue Mock 3");
	});
	it("says how long it took and how often it was paused", () => {
		assert.equal(usedLine(32, { questions: 5, minutes: 45 }), "in 32 of 45 minutes");
		assert.equal(usedLine(1, { questions: 5 }), "in 1 minute");
		assert.equal(pauseLine({ times: 0, seconds: 0 }), null);
		assert.equal(pauseLine({ times: 2, seconds: 14 * 60 + 10 }), "Paused 2 times, 14 minutes in total.");
		assert.equal(pauseLine({ times: 1, seconds: 40 }), "Paused once, under a minute in total.");
	});
	it("knows when its time ran out, and says so out loud with the other changes nobody clicked for", () => {
		const base = { id: "mock_1", deadlineId: "ddl_1", n: 3, format: FORMAT, createdAt: "2026-11-11T09:00:00.000Z", questions: [TEXT], answers: {}, pauses: [], startedAt: "2026-11-11T10:00:00.000Z" } satisfies Mock;
		const byTime = { ...base, endsAt: "2026-11-11T11:10:00.000Z", endedAt: "2026-11-11T11:09:59.500Z" };
		const byHand = { ...base, endsAt: "2026-11-11T11:10:00.000Z", endedAt: "2026-11-11T10:40:00.000Z" };
		assert.equal(endedByTime(byTime), true);
		assert.equal(endedByTime(byHand), false);
		assert.equal(endedByTime({ ...base, endedAt: "2026-11-11T11:00:00.000Z" }), false, "no time limit");
		assert.equal(mockAnnouncement(byTime, "grading"), "The time is up, so Mock 3 ended.");
		assert.equal(mockAnnouncement(byHand, "grading"), "");
		assert.equal(mockAnnouncement(base, "ready"), "Mock 3 is ready.");
		assert.equal(mockAnnouncement(base, "graded"), "Mock 3 is graded.");
		assert.equal(mockAnnouncement(base, "running"), "");
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
		assert.deepEqual(answerOf(CODE, work), { text: "", language: "python", code: {}, seconds: 0, submitted: false });
		const typed = { ...work, code: { ...work.code, python: "def twoSum(nums, target):\n    return [0, 1]\n" }, seconds: 90, submitted: true };
		assert.deepEqual(answerOf(CODE, typed), { text: typed.code.python, language: "python", code: { python: typed.code.python }, seconds: 90, submitted: true });
	});
	it("keeps the code written in each language through switching and a reload, graded in the picked one", () => {
		const py = "def twoSum(nums, target):\n    return [1, 0]\n";
		const js = "function twoSum() { return [0, 1]; }";
		const start = workOf(CODE, undefined, "python");
		// Python written, then JavaScript picked and written too.
		const both = { ...start, language: "javascript" as const, code: { python: py, javascript: js } };
		const saved = answerOf(CODE, both);
		assert.deepEqual(saved, { text: js, language: "javascript", code: { python: py, javascript: js }, seconds: 0, submitted: false });
		const reloaded = workOf(CODE, saved, "python");
		assert.deepEqual(reloaded.code, { python: py, javascript: js }, "a reload shows both");
		assert.equal(reloaded.language, "javascript");
		const back = answerOf(CODE, { ...reloaded, language: "python" });
		assert.equal(back.text, py, "switching back grades Python");
		assert.deepEqual(back.code, { python: py, javascript: js }, "and keeps the JavaScript");
	});
	it("keeps the written language's code while the other one is looked at", () => {
		const js = "function twoSum() { return [0, 1]; }";
		const work = { ...workOf(CODE, undefined, "javascript"), language: "python" as const };
		const looking = answerOf(CODE, { ...work, code: { ...work.code, javascript: js } });
		assert.deepEqual(looking.code, { javascript: js });
		assert.equal(workOf(CODE, looking, "javascript").code.javascript, js, "coming back shows it again");
	});
	it("keeps a written answer as typed", () => {
		const work = workOf(TEXT, { text: "It is a queue.", seconds: 12, submitted: false }, "javascript");
		assert.equal(work.text, "It is a queue.");
		assert.deepEqual(answerOf(TEXT, { ...work, text: "It is a loop." }), { text: "It is a loop.", seconds: 12, submitted: false });
	});
});

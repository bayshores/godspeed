/**
 * A mock's life: the teacher's questions are checked and kept, the clock
 * runs, answers are saved only while it runs, the grades come once it has
 * ended, and its questions count for the prep's topics.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	endMock,
	mockAnswers,
	mockState,
	newMock,
	parseMock,
	questionResult,
	secondsLeft,
	solvedCount,
	startMock,
	starterCode,
	takeQuestions,
	withAnswer,
	withGrades,
	type Mock,
	type MockQuestion,
	type WrittenQuestion,
} from "../../src/shared/core/mock.ts";

const FORMAT = { questions: 3, minutes: 70 };
const TOPICS = new Set(["pt_a", "pt_b"]);

const CODE: WrittenQuestion = {
	title: "Longest run",
	statement: "Return the length of the longest run of 1s.",
	kind: "code",
	topic_id: "pt_a",
	function_name: "longestRun",
	params: ["nums"],
	examples: [
		{ args: "[[1,1,0,1]]", expected: "2" },
		{ args: " [[0]] ", expected: "0" },
	],
};
const TEXT: WrittenQuestion = { title: "Event loop", statement: "Explain the event loop.", kind: "text", topic_id: "pt_gone" };
const WRITTEN = [CODE, TEXT, { ...CODE, title: "Second run", topic_id: "pt_b" }];

function running(): Mock {
	const questions = takeQuestions(WRITTEN, FORMAT, TOPICS) as MockQuestion[];
	return startMock({ ...newMock("mock_0a1b2c3d", 1, FORMAT, "2026-11-11T09:00:00.000Z"), questions }, "2026-11-11T10:00:00.000Z");
}

describe("a mock's questions", () => {
	it("are kept in order, with only topics the prep has", () => {
		const questions = takeQuestions(WRITTEN, FORMAT, TOPICS) as MockQuestion[];
		assert.deepEqual(questions.map((q) => [q.id, q.kind, q.topicId]), [
			["q1", "code", "pt_a"],
			["q2", "text", undefined],
			["q3", "code", "pt_b"],
		]);
		const first = questions[0] as Extract<MockQuestion, { kind: "code" }>;
		assert.deepEqual(first.fn, { name: "longestRun", params: ["nums"] });
		assert.deepEqual(first.examples[1], { args: "[[0]]", expected: "0" }, "trimmed");
	});

	it("are refused with a reason the teacher can act on", () => {
		const bad = (change: Partial<WrittenQuestion>) => takeQuestions([{ ...CODE, ...change }, TEXT, CODE], FORMAT, TOPICS);
		assert.match(takeQuestions([CODE], FORMAT, TOPICS) as string, /exactly 3/);
		assert.match(bad({ title: " " }) as string, /Question 1: title/);
		assert.match(bad({ statement: "" }) as string, /statement/);
		assert.match(bad({ function_name: "longest-run" }) as string, /function_name/);
		for (const name of ["require", "module", "exports", "__import__"]) assert.match(bad({ function_name: name }) as string, /function_name/, name);
		assert.match(bad({ params: ["a", "a"] }) as string, /params/);
		for (const name of ["delete", "class", "lambda", "None"]) assert.match(bad({ function_name: name }) as string, /function_name/, `${name} is a keyword`);
		for (const name of ["from", "in", "new", "default"]) assert.match(bad({ params: ["graph", name] }) as string, /params/, `${name} is a keyword`);
		assert.match(bad({ examples: [CODE.examples![0]!] }) as string, /2 to 6 examples/);
		assert.match(bad({ examples: [{ args: "[1, 2]", expected: "2" }, CODE.examples![0]!] }) as string, /one item per parameter/);
		assert.match(bad({ examples: [{ args: "[[1]", expected: "2" }, CODE.examples![0]!] }) as string, /not JSON/);
		assert.match(bad({ examples: [{ args: "[[1]]", expected: "two" }, CODE.examples![0]!] }) as string, /expected/);
	});

	it("start the editor with the function to write", () => {
		assert.equal(starterCode({ name: "longestRun", params: ["nums", "k"] }, "javascript"), "function longestRun(nums, k) {\n\t\n}\n");
		assert.equal(starterCode({ name: "longestRun", params: ["nums", "k"] }, "python"), "def longestRun(nums, k):\n    pass\n");
	});
});

describe("a mock", () => {
	it("moves from writing to ready, running, grading and graded", () => {
		const fresh = newMock("mock_0a1b2c3d", 1, FORMAT, "2026-11-11T09:00:00.000Z");
		assert.equal(mockState(fresh), "writing");
		assert.equal(startMock(fresh, "x"), fresh, "nothing to start before the questions");
		const ready = { ...fresh, questions: takeQuestions(WRITTEN, FORMAT, TOPICS) as MockQuestion[] };
		assert.equal(mockState(ready), "ready");
		const live = startMock(ready, "2026-11-11T10:00:00.000Z");
		assert.equal(mockState(live), "running");
		const over = endMock(live, "2026-11-11T10:30:00.000Z");
		assert.equal(mockState(over), "grading");
		assert.equal(endMock(over, "later").endedAt, "2026-11-11T10:30:00.000Z", "ends once");
		assert.equal(mockState(withGrades(over, []) as Mock), "graded", "nothing answered, nothing to grade");
	});

	it("counts its clock down from when it started", () => {
		const live = running();
		const t0 = Date.parse("2026-11-11T10:00:00.000Z");
		assert.equal(secondsLeft(live, t0), 70 * 60);
		assert.equal(secondsLeft(live, t0 + 21 * 60_000 + 48_000), 48 * 60 + 12);
		assert.equal(secondsLeft(live, t0 + 71 * 60_000), 0);
		assert.equal(secondsLeft({ format: FORMAT }, t0), 70 * 60, "not started: the whole time");
	});

	it("saves answers only while it runs, and the language and code only on code", () => {
		const live = running();
		const code = { python: "py", javascript: "js" };
		const saved = withAnswer(withAnswer(live, "q1", { text: "ignored", language: "python", code, seconds: 61.4, submitted: true }), "q2", { text: "words", language: "python", code, seconds: 5, submitted: false });
		assert.deepEqual(saved.answers.q1, { text: "py", language: "python", code, seconds: 61, submitted: true }, "the text is the picked language's code");
		assert.deepEqual(
			withAnswer(live, "q1", { text: "x", language: "javascript", code: { python: "py" }, seconds: 1, submitted: false }).answers.q1,
			{ text: "py", language: "python", code: { python: "py" }, seconds: 1, submitted: false },
			"nothing is written in the picked language: the written one is graded",
		);
		assert.equal(withAnswer(live, "q1", { text: "x", language: "javascript", code: {}, seconds: 1, submitted: false }).answers.q1!.text, "", "nothing written at all");
		assert.deepEqual(saved.answers.q2, { text: "words", seconds: 5, submitted: false });
		assert.equal(withAnswer(live, "q9", { text: "x", seconds: 1, submitted: true }), live, "no such question");
		const over = endMock(saved, "2026-11-11T10:30:00.000Z");
		assert.equal(withAnswer(over, "q1", { text: "late", seconds: 1, submitted: true }), over, "the mock is over");
	});

	it("needs a grade for every answered question, and counts for the prep's topics", () => {
		const live = running();
		const answer = (text: string) => ({ text, language: "javascript" as const, code: { javascript: text }, seconds: 30, submitted: true });
		const over = endMock(withAnswer(withAnswer(withAnswer(live, "q1", answer("a")), "q2", answer("b")), "q3", answer("  ")), "2026-11-11T10:30:00.000Z");
		assert.match(withGrades(over, [{ question: "q1", verdict: "right", feedback: "Good." }]) as string, /No grade for q2/);
		assert.match(withGrades(over, [{ question: "q1", verdict: "right", feedback: " " }, { question: "q2", verdict: "partly", feedback: "Half." }]) as string, /feedback for q1/);
		assert.equal(questionResult(over, "q1"), null, "not graded yet");
		const graded = withGrades(over, [{ question: "q1", verdict: "right", feedback: "Good." }, { question: "q2", verdict: "partly", feedback: "Half." }]) as Mock;
		assert.deepEqual(["q1", "q2", "q3"].map((id) => questionResult(graded, id)), ["right", "partly", "blank"]);
		const at = "2026-11-11T10:30:00.000Z";
		assert.deepEqual(mockAnswers(graded), [{ nodeId: "pt_a", outcome: "right", answeredAt: at }, { outcome: "wrong", answeredAt: at }, { nodeId: "pt_b", outcome: "dontKnow", answeredAt: at }], "given when it ended");
		assert.equal(solvedCount(graded), 1);
		assert.deepEqual(mockAnswers(over), [], "an ungraded mock counts for nothing");
	});

	it("reads back the same, and refuses a newer build's record", () => {
		const live = running();
		const over = endMock(withAnswer(live, "q1", { text: "a", language: "javascript", code: { javascript: "a", python: "b" }, seconds: 30, submitted: true }), "2026-11-11T10:30:00.000Z");
		const graded = withGrades(over, [{ question: "q1", verdict: "wrong", feedback: "Off by one." }]) as Mock;
		assert.deepEqual(parseMock(JSON.parse(JSON.stringify({ version: 1, ...graded }))), graded);
		assert.equal(parseMock({ ...graded, version: 99 }), "newer");
		assert.equal(parseMock({ ...graded, id: "nope" }), null);
		assert.equal(parseMock("text"), null);
	});

	it("drops a saved code question whose name could run something else", () => {
		const live = running();
		const code = live.questions.find((q) => q.kind === "code")!;
		const edited = { ...live, questions: [{ ...code, fn: { name: "require('child_process')", params: [] } }] };
		assert.deepEqual((parseMock(JSON.parse(JSON.stringify(edited))) as Mock).questions, []);
	});
});

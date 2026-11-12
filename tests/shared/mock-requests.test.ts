/** What the teacher is asked about a mock: its questions, its grades, and
 *  a session that goes over one question. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { endMock, newMock, startMock, takeQuestions, withAnswer, withGrades, type Mock, type MockQuestion } from "../../src/shared/core/mock.ts";
import { goOverText, gradeRequestText, mockRequestText } from "../../src/shared/core/mock-requests.ts";
import type { PrepTopicProgress } from "../../src/shared/core/prep.ts";

const FORMAT = { questions: 2, minutes: 70 };

function ended(): Mock {
	const questions = takeQuestions(
		[
			{ title: "Longest run", statement: "Return the longest run of 1s.", kind: "code", topic_id: "pt_a", function_name: "longestRun", params: ["nums"], examples: [{ args: "[[1,1,0]]", expected: "2" }, { args: "[[0]]", expected: "0" }] },
			{ title: "Event loop", statement: "Explain the event loop.", kind: "text" },
		],
		FORMAT,
		new Set(["pt_a"]),
	) as MockQuestion[];
	let mock = startMock({ ...newMock("mock_0a1b2c3d", 2, FORMAT, "2026-11-11T09:00:00.000Z"), questions }, "2026-11-11T10:00:00.000Z");
	mock = withAnswer(mock, "q1", { text: "function longestRun(nums) { return 2; }", language: "javascript", seconds: 600, submitted: true });
	return endMock(mock, "2026-11-11T10:30:00.000Z");
}

const topic = (id: string, name: string, status: PrepTopicProgress["status"]): PrepTopicProgress => ({ id, name, status, rate: null, answered: 0 }) as PrepTopicProgress;

describe("the request for a mock's questions", () => {
	it("names the goal, the size, the topics weakest first and what was asked before", () => {
		const text = mockRequestText({
			goal: "Acme online test",
			about: "Four questions.",
			format: { questions: 1, minutes: 45 },
			topics: [topic("pt_a", "Arrays", "strong"), topic("pt_b", "Grids", "weak")],
			asked: ["Longest run"],
		});
		assert.match(text, /^They are preparing for: Acme online test\n\nWhat it is like:\nFour questions\./);
		assert.match(text, /Write a mock of exactly 1 question for 45 minutes\./);
		assert.ok(text.indexOf("- pt_b: Grids (weak)") < text.indexOf("- pt_a: Arrays (strong)"));
		assert.match(text, /Don't ask them again:\n- Longest run$/);
	});
	it("leaves out the topics and earlier questions when there are none", () => {
		const text = mockRequestText({ goal: "g", about: "a", format: FORMAT, topics: [], asked: [] });
		assert.doesNotMatch(text, /topic_id|Earlier mocks/);
		assert.match(text, /exactly 2 questions for 70 minutes\.$/);
	});
});

describe("the request for a mock's grades", () => {
	it("has every question, the answer with its language and time, and how it ran", () => {
		const text = gradeRequestText({
			goal: "Acme online test",
			mock: ended(),
			runs: { q1: { examples: [{ returned: "2", passed: true }, { returned: "2", passed: false }] } },
		});
		assert.match(text, /Mock 2: 2 questions in 70 minutes\. They used 30 of them\./);
		assert.match(text, /## q1: Longest run \(code\)\nReturn the longest run of 1s\.\nFunction: longestRun\(nums\)\./);
		assert.match(text, /- \[\[1,1,0\]\] returns 2/);
		assert.match(text, /Their answer \(JavaScript, 10 min\):\n```javascript\nfunction longestRun/);
		assert.match(text, /Run on the examples here: example 1 passed, example 2 returned 2\./);
		assert.match(text, /## q2: Event loop \(written\)\nExplain the event loop\.\nThey left this blank\. Don't grade it\.$/);
	});
	it("says when the code never ran, threw, or was never submitted", () => {
		const mock = withUnsubmitted();
		const text = gradeRequestText({ goal: "g", mock, runs: { q1: { examples: [], error: "SyntaxError: bad" } } });
		assert.match(text, /10 min, never submitted\)/);
		assert.match(text, /It did not run on the examples here: SyntaxError: bad/);
		const threw = gradeRequestText({ goal: "g", mock, runs: { q1: { examples: [{ error: "TypeError: x", passed: false }, { returned: "1", passed: false }] } } });
		assert.match(threw, /example 1 threw TypeError: x, example 2 returned 1\./);
	});
});

function withUnsubmitted(): Mock {
	const mock = ended();
	return { ...mock, answers: { q1: { ...mock.answers.q1!, submitted: false } } };
}

describe("going over a mock question", () => {
	it("starts from the question, the answer and the grade", () => {
		const graded = withGrades(ended(), [{ question: "q1", verdict: "partly", feedback: "Hard-coded." }]) as Mock;
		const text = goOverText(graded, "q1")!;
		assert.match(text, /^\[Mock question\] The learner wants to go over this question from Mock 2\./);
		assert.match(text, /## q1: Longest run \(code\)/);
		assert.match(text, /Your grade then: partly\. Your feedback then:\nHard-coded\.$/);
	});
	it("says a blank one was left blank, and knows no other question", () => {
		const graded = withGrades(ended(), [{ question: "q1", verdict: "right", feedback: "Good." }]) as Mock;
		const text = goOverText(graded, "q2")!;
		assert.match(text, /They left it blank in the mock\.$/);
		assert.doesNotMatch(text, /Don't grade it/);
		assert.equal(goOverText(graded, "q9"), null);
	});
});

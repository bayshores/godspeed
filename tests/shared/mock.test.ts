/**
 * A mock as the window reads it: where it is (paused included), the time
 * left on a timed one (none without a time limit, standing still while
 * paused), how long it was paused and answered, and how it went.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { minutesUsed, mockState, pauseTotal, questionResult, secondsLeft, solvedCount, starterCode, type Mock } from "../../src/shared/core/mock.ts";

const T0 = Date.parse("2026-11-11T10:00:00.000Z");
const iso = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

const QUESTIONS: Mock["questions"] = [
	{ id: "q1", factIds: ["fct_a"], title: "Longest run", statement: "Return the longest run of 1s.", kind: "code", fn: { name: "longestRun", params: ["nums"] }, examples: [{ args: "[[1,1,0]]", expected: "2" }] },
	{ id: "q2", title: "Event loop", statement: "Explain the event loop.", kind: "text" },
	{ id: "q3", title: "Idempotency", statement: "What makes a retry safe?", kind: "text" },
];

function mock(over: Partial<Mock> = {}): Mock {
	return { id: "mock_0a1b2c3d", deadlineId: "ddl_1", n: 1, format: { questions: 3, minutes: 45 }, createdAt: iso(-5), questions: QUESTIONS, answers: {}, pauses: [], ...over };
}

describe("a mock", () => {
	it("moves from writing to ready, running or paused, grading and graded", () => {
		assert.equal(mockState(mock({ questions: [] })), "writing");
		assert.equal(mockState(mock()), "ready");
		assert.equal(mockState(mock({ startedAt: iso(0), endsAt: iso(45) })), "running");
		assert.equal(mockState(mock({ startedAt: iso(0), paused: { at: iso(10), left: 35 * 60 } })), "paused");
		assert.equal(mockState(mock({ startedAt: iso(0), endedAt: iso(30) })), "grading");
		assert.equal(mockState(mock({ startedAt: iso(0), endedAt: iso(30), grades: {} })), "graded");
	});

	it("counts a timed one down to its end time, and has no clock without a time limit", () => {
		const live = mock({ startedAt: iso(0), endsAt: iso(45) });
		assert.equal(secondsLeft(live, T0), 45 * 60);
		assert.equal(secondsLeft(live, T0 + 13 * 60_000 + 48_000), 31 * 60 + 12);
		assert.equal(secondsLeft(live, T0 + 50 * 60_000), 0);
		assert.equal(secondsLeft(mock(), T0), 45 * 60, "not started: the whole time");
		assert.equal(secondsLeft(mock({ format: { questions: 3 }, startedAt: iso(0) }), T0), null);
	});

	it("stands still while paused, however long ago its end time was", () => {
		const paused = mock({ startedAt: iso(0), endsAt: iso(45), paused: { at: iso(14), left: 31 * 60 + 9 } });
		assert.equal(secondsLeft(paused, T0 + 24 * 3600_000), 31 * 60 + 9);
	});

	it("adds up its pauses and leaves them out of the time it took", () => {
		const ended = mock({ startedAt: iso(0), endedAt: iso(50), pauses: [{ from: iso(10), to: iso(20) }, { from: iso(30), to: iso(34) }] });
		assert.deepEqual(pauseTotal(ended), { times: 2, seconds: 14 * 60 });
		assert.equal(minutesUsed(ended), 36);
		assert.equal(minutesUsed(mock({ startedAt: iso(0), endedAt: iso(47) })), 45, "at most its time limit");
		assert.equal(minutesUsed(mock({ format: { questions: 3 }, startedAt: iso(0), endedAt: iso(70) })), 70, "no time limit, no cap");
		assert.equal(minutesUsed(mock({ startedAt: iso(0), endedAt: new Date(T0 + 20_000).toISOString() })), 1, "at least a minute");
		assert.equal(minutesUsed(mock({ startedAt: iso(0) })), null, "not ended");
	});

	it("says how each question went once graded, a blank one as blank", () => {
		const graded = mock({ startedAt: iso(0), endedAt: iso(30), grades: { q1: { verdict: "right", feedback: "Good." }, q2: { verdict: "partly", feedback: "Half." } } });
		assert.equal(questionResult(mock(), "q1"), null, "not graded yet");
		assert.deepEqual(["q1", "q2", "q3"].map((id) => questionResult(graded, id)), ["right", "partly", "blank"]);
		assert.equal(solvedCount(graded), 1);
	});

	it("starts a code question's editor with the function to write", () => {
		assert.equal(starterCode({ name: "longestRun", params: ["nums", "k"] }, "javascript"), "function longestRun(nums, k) {\n\t\n}\n");
		assert.equal(starterCode({ name: "longestRun", params: ["nums", "k"] }, "python"), "def longestRun(nums, k):\n    pass\n");
	});
});

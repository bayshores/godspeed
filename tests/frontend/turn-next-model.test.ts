/** "Your turn" with nothing to answer: what is next, its key and what the key does, and where the sheet is drawn. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { turnNext, turnPlace } from "../../src/frontend/components/lesson/turn-next-model.ts";
import type { LessonStop } from "../../src/shared/core/index.ts";

const stop: LessonStop = { kind: "topic", at: "2026-11-18T21:48:00.000Z", nodeId: "reg", stopOf: "c1", next: "Cross-validation", activeMinutes: 48, keptGoing: false };
const idle = { stop: null, homework: false, goLabel: "Continue", busy: false, error: false, nothingWritten: false };

describe("turnNext", () => {
	it("at a topic stop: what is next, and the go-ahead's label keeps going, also while the teacher reads ahead or an error shows", () => {
		for (const over of [{}, { busy: true }, { error: true }]) {
			assert.deepEqual(turnNext({ ...idle, ...over, stop }), { line: "Cross-validation is next.", key: { label: "Continue", action: "keep-going" } }, JSON.stringify(over));
		}
	});

	it("at a problem stop: the next step, nothing in practice, and no line for homework, whose key names the problem", () => {
		const problem: LessonStop = { ...stop, kind: "problem" };
		assert.equal(turnNext({ ...idle, stop: problem })?.line, "Next is Cross-validation.");
		assert.deepEqual(turnNext({ ...idle, goLabel: "Next problem", stop: { ...problem, next: null } }), { line: null, key: { label: "Next problem", action: "keep-going" } });
		assert.deepEqual(turnNext({ ...idle, homework: true, goLabel: "Start problem 4", stop: { ...problem, next: "problem 4" } }), { line: null, key: { label: "Start problem 4", action: "keep-going" } });
	});

	it("the last topic ends the day", () => {
		assert.deepEqual(turnNext({ ...idle, stop: { ...stop, kind: "end", next: null } }), { line: "That was the last topic.", key: { label: "Done for today", action: "done-for-today" } });
	});

	it("with no stop: the go-ahead once the teacher is done, none beside an error line, and nothing while the teacher writes", () => {
		assert.deepEqual(turnNext(idle), { line: null, key: { label: "Continue", action: "next" } });
		assert.deepEqual(turnNext({ ...idle, error: true }), { line: null, key: null });
		assert.deepEqual(turnNext({ ...idle, goLabel: null }), { line: null, key: null });
		assert.equal(turnNext({ ...idle, busy: true }), null);
	});

	it("Start again after a first reply stopped with nothing written, unless the go-ahead or an error line is up", () => {
		const stopped = { ...idle, goLabel: null, nothingWritten: true };
		assert.deepEqual(turnNext(stopped), { line: null, key: { label: "Start again", action: "start-again" } });
		assert.equal(turnNext({ ...stopped, goLabel: "Continue" })?.key?.action, "next");
		assert.deepEqual(turnNext({ ...stopped, error: true }), { line: null, key: null });
	});
});

describe("turnPlace", () => {
	it("is nowhere before the lesson starts, then stays beside the text between problems and while the teacher writes", () => {
		assert.equal(turnPlace({ started: false, holds: false }), null);
		assert.equal(turnPlace({ started: true, holds: false }), "beside");
	});

	it("is drawn under the text too while it holds something to answer or press", () => {
		assert.equal(turnPlace({ started: true, holds: true }), "both");
	});
});

/** Home's two blocks across spaces: the newest unfinished lessons, and the topics to work on next. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProgressPayload } from "../../src/shared/core/index.ts";
import { topicsToWorkOn, unfinishedAcross } from "../../src/frontend/components/home-page/home-next-model.ts";

const lesson = (chatId: string, updatedAt: string, over: Record<string, unknown> = {}) => ({ chatId, title: chatId, kind: "study", updatedAt, unfinished: true, step: { done: 1, total: 3 }, ...over });
const item = (topicId: string, status: string) => ({ topicId, name: topicId, status, reason: "" });

/** A payload with only what the two lists read. */
function payload(over: { lessons?: unknown[]; topics?: { id: string; rate: number | null }[]; workOnNext?: unknown[]; deadlines?: unknown[] }): ProgressPayload {
	return {
		lessons: over.lessons ?? [],
		topics: over.topics ?? [],
		deadlines: over.deadlines ?? [],
		overall: { workOnNext: over.workOnNext ?? [] },
	} as unknown as ProgressPayload;
}

const A = { id: "a", color: 1 } as const;
const B = { id: "b", color: 4 } as const;

describe("unfinishedAcross", () => {
	it("merges the spaces and the lessons with no space, newest first, at most three", () => {
		const progress = new Map([
			["a", payload({ lessons: [lesson("a1", "2026-11-01"), lesson("a2", "2026-11-05")] })],
			["b", payload({ lessons: [lesson("b1", "2026-11-03"), lesson("b2", "2026-11-02")] })],
		]);
		const out = unfinishedAcross([A, B], progress, payload({ lessons: [lesson("n1", "2026-11-04")] }));
		assert.deepEqual(out.map((x) => x.lesson.chatId), ["a2", "n1", "b1"]);
		assert.deepEqual(out.map((x) => x.spaceId), ["a", null, "b"]);
		assert.deepEqual(out.map((x) => x.color), [1, undefined, 4]);
	});

	it("skips finished lessons and a space whose progress has not loaded", () => {
		const progress = new Map([["a", payload({ lessons: [lesson("done", "2026-11-05", { unfinished: undefined })] })]]);
		assert.deepEqual(unfinishedAcross([A, B], progress, null), []);
	});

	it("gives a lesson with problems those as blocks and a study lesson its steps", () => {
		const progress = new Map([
			["a", payload({ lessons: [lesson("hw", "2026-11-05", { kind: "homework", deadlineId: "d1", problems: { done: 3, total: 4 } }), lesson("st", "2026-11-04")] })],
		]);
		const out = unfinishedAcross([A], progress, null);
		assert.deepEqual(out.map((x) => x.blocks), [{ done: 3, total: 4 }, { done: 1, total: 3 }]);
	});
});

describe("topicsToWorkOn", () => {
	it("puts weak before shaky before the rest, the lowest rate first, across spaces", () => {
		const progress = new Map([
			["a", payload({ topics: [{ id: "a-shaky", rate: 0.6 }, { id: "a-weak", rate: 0.4 }, { id: "a-new", rate: null }], workOnNext: [item("a-shaky", "shaky"), item("a-weak", "weak"), item("a-new", "untested")] })],
			["b", payload({ topics: [{ id: "b-weak", rate: 0.1 }, { id: "b-shaky", rate: 0.56 }], workOnNext: [item("b-shaky", "shaky"), item("b-weak", "weak")] })],
		]);
		const out = topicsToWorkOn([A, B], progress);
		assert.deepEqual(out.map((t) => t.topicId), ["b-weak", "a-weak", "b-shaky"]);
		assert.deepEqual(out.map((t) => t.spaceId), ["b", "a", "b"]);
		assert.deepEqual(out.map((t) => t.rate), [0.1, 0.4, 0.56]);
	});

	it("counts an untested topic as 0 and keeps the space order on a tie", () => {
		const progress = new Map([
			["a", payload({ topics: [{ id: "a-new", rate: null }], workOnNext: [item("a-new", "untested")] })],
			["b", payload({ topics: [{ id: "b-new", rate: null }], workOnNext: [item("b-new", "untested")] })],
		]);
		assert.deepEqual(topicsToWorkOn([A, B], progress).map((t) => t.topicId), ["a-new", "b-new"]);
	});

	it("is empty with nothing to work on", () => {
		assert.deepEqual(topicsToWorkOn([A, B], new Map([["a", payload({})]])), []);
	});
});

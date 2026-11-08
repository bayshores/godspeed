import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProgressPayload } from "../../src/shared/core/index.ts";
import { UNTESTED_COLOR, rampColor } from "../../src/shared/core/index.ts";
import {
	UNSTUDIED_CELL,
	activityLine,
	classesSettled,
	classSlot,
	factCells,
	factRate,
	foldClassesProgress,
	readyBlocks,
	type ClassesProgress,
} from "../../src/frontend/components/home-page/home-page-model.ts";

const EMPTY: ClassesProgress = { progress: new Map(), errors: new Map() };
const payload = (tag: string) => ({ tag }) as unknown as ProgressPayload;

describe("foldClassesProgress", () => {
	it("records a failed class's error next to the others' payloads", () => {
		const state = foldClassesProgress(EMPTY, ["a", "b"], [
			{ classId: "a", payload: payload("a1") },
			{ classId: "b", error: "HTTP 500" },
		]);
		assert.deepEqual([...state.progress.keys()], ["a"]);
		assert.deepEqual([...state.errors], [["b", "HTTP 500"]]);
	});

	it("keeps a class's earlier payload when a later read fails, and clears the error on success", () => {
		const first = foldClassesProgress(EMPTY, ["a"], [{ classId: "a", payload: payload("a1") }]);
		const failed = foldClassesProgress(first, ["a"], [{ classId: "a", error: "offline" }]);
		assert.equal(failed.progress.get("a"), first.progress.get("a"));
		assert.equal(failed.errors.get("a"), "offline");
		const back = foldClassesProgress(failed, ["a"], [{ classId: "a", payload: payload("a2") }]);
		assert.equal(back.errors.size, 0);
	});

	it("drops classes no longer shown", () => {
		const first = foldClassesProgress(EMPTY, ["a", "b"], [
			{ classId: "a", payload: payload("a1") },
			{ classId: "b", error: "x" },
		]);
		const next = foldClassesProgress(first, ["a"], [{ classId: "a", payload: payload("a1") }]);
		assert.deepEqual([...next.progress.keys()], ["a"]);
		assert.equal(next.errors.size, 0);
	});
});

describe("classesSettled and classSlot", () => {
	const state = foldClassesProgress(EMPTY, ["a", "b"], [
		{ classId: "a", payload: payload("a1") },
		{ classId: "b", error: "HTTP 500" },
	]);

	it("one failed class does not hold the others in loading", () => {
		assert.equal(classesSettled(["a", "b"], state), true);
		assert.equal(classSlot("a", state, true), "block");
		assert.equal(classSlot("b", state, true), "failed");
	});

	it("waits while a class has neither data nor an error", () => {
		assert.equal(classesSettled(["a", "b", "c"], state), false);
		assert.equal(classSlot("c", state, true), "loading");
	});

	it("shows loading boxes until the blocks are ready", () => {
		assert.equal(classSlot("a", state, false), "loading");
		assert.equal(classSlot("b", state, false), "loading");
	});
});

const answers = (...o: ("right" | "wrong" | "dontKnow")[]) => o.map((outcome) => ({ outcome })) as never;

describe("factRate", () => {
	it("is the share of right answers, null before the first", () => {
		assert.equal(factRate({ answers: [] }), null);
		assert.equal(factRate({ answers: answers("right", "wrong", "dontKnow", "right") }), 0.5);
	});
});

describe("factCells", () => {
	it("answered facts first in their ramp color, then studied ones, then the unstudied dim", () => {
		const cells = factCells([
			{ inLessons: false, answers: [] },
			{ inLessons: true, answers: [] },
			{ inLessons: true, answers: answers("right") },
			{ inLessons: true, answers: answers("wrong") },
		]);
		assert.deepEqual(cells, [rampColor(1), rampColor(0), UNTESTED_COLOR, UNSTUDIED_CELL]);
	});
});

describe("readyBlocks", () => {
	it("fills a tenth per block, rounded and kept in 0 to 10", () => {
		assert.deepEqual([0, 0.04, 0.05, 0.58, 1, 1.2].map(readyBlocks), [0, 0, 1, 6, 10, 10]);
	});
});

describe("activityLine", () => {
	const NOW = new Date(2026, 10, 7, 18, 0).getTime();
	it("splits the label into a verb and the rest, today's time as HH:MM", () => {
		const line = activityLine({ at: new Date(2026, 10, 7, 9, 5).toISOString(), label: "Reading Lab 6.pdf", agent: "Claude Code" }, NOW);
		assert.deepEqual(line, { time: "09:05", verb: "reading", rest: "Lab 6.pdf", source: "agent" });
	});
	it("an earlier day shows its date; the app's and the learner's entries say so", () => {
		assert.deepEqual(activityLine({ at: new Date(2026, 10, 5, 9, 5).toISOString(), label: "Synced 2 new files", agent: "godspeed" }, NOW), {
			time: "nov 5",
			verb: "synced",
			rest: "2 new files",
			source: "app",
		});
		assert.equal(activityLine({ at: new Date(NOW).toISOString(), label: "Answered right", agent: "you" }, NOW).source, "you");
	});
});

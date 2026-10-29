import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProgressPayload } from "../src/core/index.ts";
import { classesSettled, classSlot, foldClassesProgress, type ClassesProgress } from "../src/components/home-page/home-page-model.ts";

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

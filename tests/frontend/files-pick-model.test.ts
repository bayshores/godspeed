/**
 * The Files page's picks: a click adds a file at the end or lets it go,
 * never past the lesson's file limit; a file that leaves the list leaves
 * the picks; the bar's line names them in click order.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_LESSON_FILES, keepListed, pickedNames, togglePick } from "../../src/frontend/components/files/files-pick-model.ts";

describe("files pick model", () => {
	it("a click adds a file at the end, and a second click lets it go", () => {
		const two = togglePick(togglePick([], "b"), "a");
		assert.deepEqual(two, ["b", "a"]);
		assert.deepEqual(togglePick(two, "b"), ["a"]);
	});

	it("never picks past the limit, but a picked file can still be let go", () => {
		const full = Array.from({ length: MAX_LESSON_FILES }, (_, i) => `f${i}`);
		assert.ok(togglePick(full, "extra") === full, "the same picks");
		assert.deepEqual(togglePick(full, "f0"), full.slice(1));
	});

	it("drops picks whose files left the list, and keeps the same picks when none did", () => {
		const picked = ["a", "b", "c"];
		assert.deepEqual(keepListed(picked, new Set(["a", "c", "d"])), ["a", "c"]);
		assert.ok(keepListed(picked, new Set(["a", "b", "c"])) === picked);
	});

	it("names the picks in click order", () => {
		const names = new Map([
			["a", "Midterm 2022.pdf"],
			["b", "Midterm 2022 key.pdf"],
		]);
		assert.equal(pickedNames(["b", "a"], names), "Midterm 2022 key.pdf, Midterm 2022.pdf");
	});
});

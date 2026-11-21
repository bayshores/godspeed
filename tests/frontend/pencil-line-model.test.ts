import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inkRows, PENCIL_WORDS, pencilSteps } from "../../src/frontend/components/lesson/pencil-line-model.ts";

/** The pencil's handwriting while the teacher works on a reply. */

describe("inkRows", () => {
	it("draws a word as strokes joined by one pixel, by turns at the foot and at the head", () => {
		assert.deepEqual(inkRows(["nnn"]), [".....", ".....", ".....", "#.###", "#.#.#", "#.#.#", "###.#", ".....", "....."]);
	});

	it("reaches up for a tall letter and down for a deep one", () => {
		const rows = inkRows(["lg"]);
		assert.deepEqual(rows.map((row) => row[0]), ["#", "#", "#", "#", "#", "#", "#", ".", "."]);
		assert.deepEqual(rows.map((row) => row[2]), [".", ".", ".", "#", "#", "#", "#", "#", "#"]);
	});

	it("leaves three empty columns between words", () => {
		assert.equal(inkRows(["n", "n"])[4], "#...#");
	});

	it("makes the app's line nine rows of one width", () => {
		const rows = inkRows(PENCIL_WORDS);
		assert.equal(rows.length, 9);
		assert.ok(rows.every((row) => row.length === rows[0]!.length && row.length > 60));
	});
});

describe("pencilSteps", () => {
	it("takes one step for every three columns, and at least one", () => {
		assert.equal(pencilSteps(99), 33);
		assert.equal(pencilSteps(1), 1);
	});
});

/** The open problem folded in the pinned "Your turn": when it folds, and the height it keeps. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { foldRoom, problemFolded } from "../../src/frontend/components/lesson/turn-fold-model.ts";

describe("problemFolded", () => {
	it("a new problem is whole, and folds once the learner has sent something", () => {
		assert.equal(problemFolded(false, null), false);
		assert.equal(problemFolded(true, null), true);
	});

	it("the learner's own choice for the problem wins either way", () => {
		assert.equal(problemFolded(true, true), false, "asked for whole after sending");
		assert.equal(problemFolded(false, false), true, "asked for less before sending");
	});
});

describe("foldRoom", () => {
	it("leaves the text's window half the room", () => {
		assert.equal(foldRoom(1000, 300), 200);
		assert.equal(foldRoom(901, 300), 150);
	});

	it("never gives the problem under three lines", () => {
		assert.equal(foldRoom(800, 380), 96);
		assert.equal(foldRoom(640, 400), 96);
	});
});

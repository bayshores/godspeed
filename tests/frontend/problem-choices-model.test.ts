import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { choiceLetter, problemMessage } from "../../src/frontend/components/lesson/problem-choices-model.ts";

describe("a problem's choices", () => {
	it("are lettered A, B, C in the order shown", () => {
		assert.deepEqual([0, 1, 2, 7].map(choiceLetter), ["A", "B", "C", "H"]);
	});

	it("make the message: the picked letters as a sentence, then the work after a blank line", () => {
		assert.equal(problemMessage(new Set([0]), ""), "I picked A.");
		assert.equal(problemMessage(new Set([2, 0]), ""), "I picked A and C.", "letters in order, whichever was picked first");
		assert.equal(problemMessage(new Set([0, 1, 3]), "  "), "I picked A, B and D.", "blank work adds nothing");
		assert.equal(problemMessage(new Set([1]), "  because it diverges \n"), "I picked B.\n\nbecause it diverges");
	});

	it("with nothing picked, the message is the work as typed", () => {
		assert.equal(problemMessage(new Set(), "  E[N] = 2 "), "E[N] = 2");
		assert.equal(problemMessage(new Set(), ""), "");
	});
});

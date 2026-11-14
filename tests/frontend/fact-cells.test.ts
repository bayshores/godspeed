import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UNTESTED_COLOR, rampColor } from "../../src/shared/core/index.ts";
import { UNSTUDIED_CELL, factCells, factRate } from "../../src/frontend/components/fact-cells.ts";

const answers = (...o: ("right" | "hinted" | "wrong" | "dontKnow")[]) => o.map((outcome) => ({ outcome })) as never;

describe("factRate", () => {
	it("is the share of right answers, null before the first", () => {
		assert.equal(factRate({ answers: [] }), null);
		assert.equal(factRate({ answers: answers("right", "wrong", "dontKnow", "right") }), 0.5);
		assert.equal(factRate({ answers: answers("hinted") }), 0.6, "solved with hints counts in part");
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

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { linesOf, PRINT_LINE_MS, PRINT_MOST_MS, printSchedule } from "../../src/frontend/components/lesson/print-in-model.ts";

/** A reply that landed prints line by line. */

describe("printSchedule", () => {
	it("gives each line its time and starts a block when the one before it ends", () => {
		assert.deepEqual(printSchedule([3, 1, 2]), [
			{ at: 0, ms: 3 * PRINT_LINE_MS, lines: 3 },
			{ at: 3 * PRINT_LINE_MS, ms: PRINT_LINE_MS, lines: 1 },
			{ at: 4 * PRINT_LINE_MS, ms: 2 * PRINT_LINE_MS, lines: 2 },
		]);
	});

	it("prints a long reply faster, so it never takes longer than the most", () => {
		const steps = printSchedule([20, 20, 20]);
		const last = steps.at(-1)!;
		assert.ok(Math.abs(last.at + last.ms - PRINT_MOST_MS) < 0.001);
		assert.equal(steps[1]!.at, PRINT_MOST_MS / 3);
	});

	it("counts a block with no lines as one", () => {
		assert.deepEqual(printSchedule([0]), [{ at: 0, ms: PRINT_LINE_MS, lines: 1 }]);
		assert.deepEqual(printSchedule([]), []);
	});
});

describe("linesOf", () => {
	it("reads the lines off a block's height", () => {
		assert.equal(linesOf(84, 28), 3);
		assert.equal(linesOf(29, 28), 1);
	});

	it("is one when the height or the line height is not known", () => {
		assert.equal(linesOf(0, 28), 1);
		assert.equal(linesOf(84, Number.NaN), 1);
	});
});

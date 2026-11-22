/** The Graph slip's motion (src/frontend/components/graph/slip-motion-model.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blockDelay, chipSteps, CHIP_GAP_MS, MOON_GAP_MS, rowStart, stepDelay, travelMs } from "../../src/frontend/components/graph/slip-motion-model.ts";

describe("the Graph slip's motion", () => {
	it("travels in in 220 to 320 ms and out in 110 to 160 ms, longer the farther it goes", () => {
		assert.equal(travelMs(0, "in"), 220);
		assert.equal(travelMs(200, "in"), 270);
		assert.equal(travelMs(900, "in"), 320);
		assert.equal(travelMs(0, "out"), 110);
		assert.equal(travelMs(200, "out"), 135);
		assert.equal(travelMs(900, "out"), 160);
	});

	it("steps a row in left to right, the last by 160 ms however long the row", () => {
		assert.deepEqual([0, 1, 2, 3].map((i) => stepDelay(i, CHIP_GAP_MS)), [0, 20, 40, 60]);
		assert.equal(stepDelay(12, CHIP_GAP_MS), 160);
		assert.equal(stepDelay(17, MOON_GAP_MS), 160);
		assert.equal(stepDelay(-1, CHIP_GAP_MS), 0);
	});

	it("steps a panel's blocks in only when it replaced another; its rows start with it as it arrives", () => {
		assert.equal(blockDelay("still", 2), null);
		assert.equal(blockDelay("open", 2), null);
		assert.deepEqual([0, 1, 2, 3].map((b) => blockDelay("swap", b)), [0, 30, 60, 90]);
		assert.equal(rowStart("still", 2), null);
		assert.equal(rowStart("open", 2), 0);
		assert.equal(rowStart("swap", 2), 60);
	});

	it("counts a chip group's steps: its label, the chips shown, and the fold chip", () => {
		assert.equal(chipSteps(0, 0), 0);
		assert.equal(chipSteps(3, 3), 4);
		assert.equal(chipSteps(5, 2), 4);
		assert.equal(chipSteps(5, 0), 2);
	});
});

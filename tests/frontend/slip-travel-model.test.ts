/** A slip's travel, shared by the Graph's panel and Follow's slip (src/frontend/components/slip-travel-model.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { travelMs } from "../../src/frontend/components/slip-travel-model.ts";

describe("a slip's travel", () => {
	it("travels in in 220 to 320 ms and out in 110 to 160 ms, longer the farther it goes", () => {
		assert.equal(travelMs(0, "in"), 220);
		assert.equal(travelMs(200, "in"), 270);
		assert.equal(travelMs(900, "in"), 320);
		assert.equal(travelMs(0, "out"), 110);
		assert.equal(travelMs(200, "out"), 135);
		assert.equal(travelMs(900, "out"), 160);
	});
});

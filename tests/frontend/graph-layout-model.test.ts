/** Where the Graph's open panel goes in the page's room (src/frontend/components/graph/graph-layout-model.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { panelAlone, panelStacked, pictureHeight, slipCap, TAB_H } from "../../src/frontend/components/graph/graph-layout-model.ts";

describe("the Graph panel's room", () => {
	it("a room too narrow or too low for both shows the panel alone", () => {
		assert.equal(panelAlone({ width: 1200, height: 620 }), false);
		assert.equal(panelAlone({ width: 724, height: 620 }), true);
		assert.equal(panelAlone({ width: 1200, height: 440 }), true);
	});

	it("only a narrow room stacks the panel in one column", () => {
		assert.equal(panelStacked({ width: 724 }), true);
		assert.equal(panelStacked({ width: 1036 }), false);
	});

	it("the slip takes at most 45% of the room, and the picture the rest above it and its tab", () => {
		assert.equal(slipCap(600), 270);
		assert.equal(pictureHeight(600, 0), 600);
		assert.equal(pictureHeight(600, 200), 600 - 200 - TAB_H - 12);
		assert.equal(pictureHeight(200, 190), 120, "never under a usable strip");
	});
});

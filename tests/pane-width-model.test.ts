import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampWidth, draggedWidth, storedWidth } from "../src/components/ui/pane-width-model.ts";

const bounds = { initial: 440, min: 340, max: 720 };

describe("a resizable pane's width", () => {
	it("stays inside its range, in whole pixels", () => {
		assert.equal(clampWidth(100, bounds), 340);
		assert.equal(clampWidth(9000, bounds), 720);
		assert.equal(clampWidth(500.6, bounds), 501);
	});

	it("reads a saved width, or falls back to the default", () => {
		assert.equal(storedWidth("512", bounds), 512);
		assert.equal(storedWidth("9000", bounds), 720, "an old width outside the range is pulled back in");
		assert.equal(storedWidth(null, bounds), 440);
		assert.equal(storedWidth("wide", bounds), 440);
		assert.equal(storedWidth("", bounds), 440);
	});

	it("grows toward the pointer on the handle's side", () => {
		assert.equal(draggedWidth(256, 256, 300, "right", { initial: 256, min: 200, max: 360 }), 300, "sidebar: drag right to widen");
		assert.equal(draggedWidth(440, 1000, 900, "left", bounds), 540, "panel: drag left to widen");
		assert.equal(draggedWidth(440, 1000, 1200, "left", bounds), 340, "never below the minimum");
	});
});

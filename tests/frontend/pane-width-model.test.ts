import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampWidth, draggedWidth, keyedWidth, storedWidth } from "../../src/frontend/components/ui/pane-width-model.ts";

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

	it("grows as the pointer moves left", () => {
		assert.equal(draggedWidth(440, 1000, 900, bounds), 540, "drag left to widen");
		assert.equal(draggedWidth(440, 1000, 1200, bounds), 340, "never below the minimum");
	});

	it("moves from the keyboard the way the arrow points", () => {
		assert.equal(keyedWidth(440, "ArrowRight", bounds), 424, "right narrows");
		assert.equal(keyedWidth(440, "ArrowLeft", bounds), 456, "left widens");
		assert.equal(keyedWidth(716, "ArrowLeft", bounds), 720, "never past the maximum");
		assert.equal(keyedWidth(440, "Home", bounds), 340);
		assert.equal(keyedWidth(440, "End", bounds), 720);
		assert.equal(keyedWidth(440, "ArrowUp", bounds), null, "other keys aren't the handle's");
	});
});

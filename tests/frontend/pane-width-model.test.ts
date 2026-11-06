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

	it("grows toward the pointer on the handle's side", () => {
		assert.equal(draggedWidth(256, 256, 300, "right", { initial: 256, min: 200, max: 360 }), 300, "sidebar: drag right to widen");
		assert.equal(draggedWidth(440, 1000, 900, "left", bounds), 540, "panel: drag left to widen");
		assert.equal(draggedWidth(440, 1000, 1200, "left", bounds), 340, "never below the minimum");
	});

	it("moves from the keyboard the way the arrow points", () => {
		assert.equal(keyedWidth(440, "ArrowRight", "right", bounds), 456, "sidebar: right widens");
		assert.equal(keyedWidth(440, "ArrowRight", "left", bounds), 424, "panel: right narrows");
		assert.equal(keyedWidth(440, "ArrowLeft", "left", bounds), 456, "panel: left widens");
		assert.equal(keyedWidth(716, "ArrowLeft", "left", bounds), 720, "never past the maximum");
		assert.equal(keyedWidth(440, "Home", "left", bounds), 340);
		assert.equal(keyedWidth(440, "End", "left", bounds), 720);
		assert.equal(keyedWidth(440, "ArrowUp", "left", bounds), null, "other keys aren't the handle's");
	});
});

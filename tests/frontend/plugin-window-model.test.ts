import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pluginWindowBox, windowEdge } from "../../src/frontend/components/lesson/plugin-window-model.ts";

/** Where a lesson plugin's window hangs and how tall it is. */

describe("a lesson plugin's window", () => {
	it("lines up with the lesson's sheet while Your turn sits beside it, and with its word when they are stacked", () => {
		assert.equal(windowEdge(1224, { right: 904 }, { left: 928 }), 904);
		assert.equal(windowEdge(1224, { right: 540 }, { left: 928 }), 540, "the cheat sheet docked between them");
		assert.equal(windowEdge(700, { right: 784 }, { left: 16 }), 700, "stacked");
		assert.equal(windowEdge(700, undefined, undefined), 700);
	});

	it("is 360 wide with its right edge on the edge it lines up with", () => {
		assert.deepEqual(pluginWindowBox(1224, { width: 1440, height: 900 }, 314), { right: 216, width: 360, height: 314 });
	});

	it("moves left of the word only as far as keeps it 16 from the window's left side", () => {
		assert.equal(pluginWindowBox(300, { width: 800, height: 680 }, 200).right, 800 - 360 - 16);
		assert.equal(pluginWindowBox(300, { width: 320, height: 680 }, 200).width, 288);
	});

	it("starts at 120 before the page says, and follows the page from 48 up to the room under the bar", () => {
		const viewport = { width: 1440, height: 680 };
		assert.equal(pluginWindowBox(1224, viewport, null).height, 120);
		assert.equal(pluginWindowBox(1224, viewport, 10).height, 48);
		assert.equal(pluginWindowBox(1224, viewport, 72.4).height, 73);
		assert.equal(pluginWindowBox(1224, viewport, 5000).height, 680 - 48 - 16);
	});
});

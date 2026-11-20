import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pluginWindowBox } from "../../src/frontend/components/lesson/plugin-window-model.ts";

/** Where a lesson plugin's window hangs and how tall it is. */

describe("a lesson plugin's window", () => {
	it("is 360 wide with its right edge on its word's", () => {
		assert.deepEqual(pluginWindowBox(1224, { width: 1440, height: 900, strip: 0 }, 48, 314), { right: 216, width: 360, height: 314 });
	});

	it("moves left of the word only as far as keeps it 16 from the window's left side", () => {
		assert.equal(pluginWindowBox(300, { width: 800, height: 680, strip: 0 }, 48, 200).right, 800 - 360 - 16);
		assert.equal(pluginWindowBox(300, { width: 320, height: 680, strip: 0 }, 48, 200).width, 288);
	});

	it("starts at 120 before the page says, and follows the page from 48 up to the room under the bar", () => {
		const viewport = { width: 1440, height: 680, strip: 0 };
		assert.equal(pluginWindowBox(1224, viewport, 48, null).height, 120);
		assert.equal(pluginWindowBox(1224, viewport, 48, 10).height, 48);
		assert.equal(pluginWindowBox(1224, viewport, 48, 72.4).height, 73);
		assert.equal(pluginWindowBox(1224, viewport, 48, 5000).height, 680 - 48 - 16);
	});

	it("keeps clear of the strip down the window's right edge", () => {
		assert.equal(pluginWindowBox(1436, { width: 1440, height: 900, strip: 28 }, 48, 200).right, 28);
	});

	it("leaves the room a two-line bar takes", () => {
		assert.equal(pluginWindowBox(1224, { width: 1000, height: 680, strip: 0 }, 96, 5000).height, 680 - 96 - 16);
	});
});

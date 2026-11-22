import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { glideMs, travelGlideMs } from "../../src/frontend/components/sheet-glide-model.ts";

/** The lesson's sheets glide to a new height. */

const box = (height: number, width = 600) => ({ width, height });

describe("glideMs", () => {
	it("takes longer the farther the sheet's edge travels, between a blink and a third of a second", () => {
		assert.equal(glideMs(box(300), box(328), true), 110 + 28 * 0.35);
		assert.equal(glideMs(box(300), box(100), true), 110 + 200 * 0.35);
		assert.equal(glideMs(box(200), box(1400), true), 320);
		assert.equal(travelGlideMs(-200), 110 + 200 * 0.35, "the same time for a sheet that moves its edge that far");
	});

	it("places a sheet at once when nothing changed or it was not drawn before", () => {
		assert.equal(glideMs(box(300), box(300), true), null);
		assert.equal(glideMs(box(300), box(300.4), true), null);
		assert.equal(glideMs(box(0), box(300), true), null);
	});

	it("places a sheet at once when its width or the window changed", () => {
		assert.equal(glideMs(box(300, 600), box(360, 500), true), null);
		assert.equal(glideMs(box(300), box(360), false), null);
	});
});

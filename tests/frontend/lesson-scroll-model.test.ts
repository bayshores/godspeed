import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { restingTop, wholeLineTop } from "../../src/frontend/components/lesson/lesson-scroll-model.ts";

/** Where the lesson page rests: its end, unless that hides the start of the newest thing. */

// The page's padding as its CSS sets it: room above what it rests on and under its last sheet.
const pads = { top: 24, end: 28 };

describe("where the lesson page rests with Your turn under the text", () => {
	const view = 600;
	const under = (top: number, height = 400) => ({ top, height, beside: false });

	it("at its end with nothing waiting", () => {
		assert.equal(restingTop(900, { view, pads, sheet: null, part: null, reply: null }), 900);
	});

	it("with nothing waiting, at the start of a reply that landed longer than the window, and at its end when it fits", () => {
		assert.equal(restingTop(900, { view, pads, sheet: null, part: null, reply: 200 }), 200 - pads.top);
		assert.equal(restingTop(900, { view, pads, sheet: null, part: null, reply: 1000 }), 900);
		assert.equal(restingTop(900, { view, pads, sheet: null, part: null, reply: 0 }), 0, "never above the page's top");
	});

	it("at its end while all of Your turn fits, with the lesson text above it", () => {
		// The sheet starts at 1100 and the page ends at 1500: 400 tall, the window shows 600.
		assert.equal(restingTop(900, { view, pads, sheet: under(1100), part: null, reply: null }), 900);
	});

	it("on the sheet's top when Your turn is taller than the window, so a problem is read from its start", () => {
		assert.equal(restingTop(900, { view, pads, sheet: under(500, 1000), part: null, reply: null }), 500 - pads.top);
	});

	it("on the part the learner is on when it sits deep in a tall sheet, else still on the sheet's top", () => {
		assert.equal(restingTop(1500, { view, pads, sheet: under(500, 1600), part: 500, reply: null }), 1000 - pads.top);
		assert.equal(restingTop(1500, { view, pads, sheet: under(500, 1600), part: 200, reply: null }), 500 - pads.top);
	});

	it("on the learner's last message once the teacher writes back under a tall sheet", () => {
		assert.equal(restingTop(1500, { view, pads, sheet: under(800, 1300), part: 500, reply: 300 }), 300 - pads.top);
	});

	it("never above the page's top", () => {
		assert.equal(restingTop(900, { view, pads, sheet: under(10), part: null, reply: null }), 0);
	});
});

describe("where the lesson page rests with Your turn beside the text", () => {
	it("at its end, since Your turn always fits the window there, whatever part it is on or whether the teacher writes back", () => {
		const sheet = { top: 24, height: 500, beside: true };
		assert.equal(restingTop(2000, { view: 600, pads, sheet, part: null, reply: null }), 2000);
		assert.equal(restingTop(2000, { view: 600, pads, sheet, part: 400, reply: 1800 }), 2000);
	});
});

describe("the top line at rest", () => {
	it("moves up to the line the window's top edge cuts through", () => {
		assert.equal(wholeLineTop(110, [{ top: 100, bottom: 130 }]), 100);
	});

	it("takes the highest of the boxes on a cut line, so tall math shows whole", () => {
		assert.equal(wholeLineTop(110, [{ top: 100, bottom: 130 }, { top: 92, bottom: 136 }]), 92);
	});

	it("stays when the edge falls between lines or deep inside a tall block", () => {
		assert.equal(wholeLineTop(110, []), 110);
		assert.equal(wholeLineTop(400, [{ top: 100, bottom: 600 }]), 400);
	});
});

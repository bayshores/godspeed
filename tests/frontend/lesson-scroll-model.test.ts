import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { REST_PAD, restingTop } from "../../src/frontend/components/lesson/lesson-scroll-model.ts";

/** Where the lesson page rests: its end, unless that hides the start of the newest thing. */

describe("where the lesson page rests", () => {
	const view = 600;

	it("at its end with nothing waiting", () => {
		assert.equal(restingTop(900, { view, sheet: null, part: null, reply: null }), 900);
	});

	it("at its end while all of Your turn fits, with the lesson text above it", () => {
		// The sheet starts at 1100 and the page ends at 1500: 400 tall, the window shows 600.
		assert.equal(restingTop(900, { view, sheet: 1100, part: null, reply: null }), 900);
	});

	it("on the sheet's top when Your turn is taller than the window, so a problem is read from its start", () => {
		assert.equal(restingTop(900, { view, sheet: 500, part: null, reply: null }), 500 - REST_PAD);
	});

	it("on the part the learner is on when it sits deep in a tall sheet, else still on the sheet's top", () => {
		assert.equal(restingTop(1500, { view, sheet: 500, part: 1000, reply: null }), 1000 - REST_PAD);
		assert.equal(restingTop(1500, { view, sheet: 500, part: 700, reply: null }), 500 - REST_PAD);
	});

	it("on the learner's last message once the teacher writes back under a tall sheet", () => {
		assert.equal(restingTop(1500, { view, sheet: 800, part: 1300, reply: 300 }), 300 - REST_PAD);
	});

	it("never above the page's top", () => {
		assert.equal(restingTop(900, { view, sheet: 10, part: null, reply: null }), 0);
	});
});

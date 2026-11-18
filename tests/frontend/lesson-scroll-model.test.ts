import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keepPair, REST_PAD, restingTop, turnStick, wholeLineTop } from "../../src/frontend/components/lesson/lesson-scroll-model.ts";

/** Where the lesson page rests: its end, unless that hides the start of the newest thing. */

describe("where the lesson page rests with Your turn under the text", () => {
	const view = 600;
	const under = (top: number, height = 400) => ({ top, height, beside: false });

	it("at its end with nothing waiting", () => {
		assert.equal(restingTop(900, { view, sheet: null, part: null, reply: null }), 900);
	});

	it("at its end while all of Your turn fits, with the lesson text above it", () => {
		// The sheet starts at 1100 and the page ends at 1500: 400 tall, the window shows 600.
		assert.equal(restingTop(900, { view, sheet: under(1100), part: null, reply: null }), 900);
	});

	it("on the sheet's top when Your turn is taller than the window, so a problem is read from its start", () => {
		assert.equal(restingTop(900, { view, sheet: under(500, 1000), part: null, reply: null }), 500 - REST_PAD);
	});

	it("on the part the learner is on when it sits deep in a tall sheet, else still on the sheet's top", () => {
		assert.equal(restingTop(1500, { view, sheet: under(500, 1600), part: 500, reply: null }), 1000 - REST_PAD);
		assert.equal(restingTop(1500, { view, sheet: under(500, 1600), part: 200, reply: null }), 500 - REST_PAD);
	});

	it("on the learner's last message once the teacher writes back under a tall sheet", () => {
		assert.equal(restingTop(1500, { view, sheet: under(800, 1300), part: 500, reply: 300 }), 300 - REST_PAD);
	});

	it("never above the page's top", () => {
		assert.equal(restingTop(900, { view, sheet: under(10), part: null, reply: null }), 0);
	});
});

describe("where the lesson page rests with Your turn beside the text", () => {
	const view = 600;
	const beside = (height: number) => ({ top: 24, height, beside: true });

	it("at its end while Your turn fits the window, so the newest text shows", () => {
		assert.equal(restingTop(2000, { view, sheet: beside(500), part: null, reply: null }), 2000);
	});

	it("short of its end by as much as a tall sheet overflows, so the sheet shows its top", () => {
		// 700 tall with 24 above and 28 below needs 752; the window shows 600.
		assert.equal(restingTop(2000, { view, sheet: beside(700), part: null, reply: null }), 2000 - 152);
	});

	it("lower by the part's depth when the learner's part sits deep in a tall sheet", () => {
		assert.equal(restingTop(2000, { view, sheet: beside(1200), part: 400, reply: null }), 2000 - 652 + 400);
		assert.equal(restingTop(2000, { view, sheet: beside(700), part: 400, reply: null }), 2000);
	});

	it("at its end once the teacher writes back, since the reply is the text's newest words", () => {
		assert.equal(restingTop(2000, { view, sheet: beside(700), part: null, reply: 1800 }), 2000);
	});
});

describe("how Your turn holds still beside the text", () => {
	it("under the step line while it fits the window", () => {
		assert.deepEqual(turnStick(500, 600), { alignSelf: "start", top: REST_PAD });
	});

	it("taller, at its column's foot with its top held under the step line until the page's end", () => {
		// Its bottom may sit 600 - 24 - 700 below the window's foot, so its top is never below 24.
		assert.deepEqual(turnStick(700, 600), { alignSelf: "end", bottom: -124 });
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

describe("whether the text and Your turn stay a pair", () => {
	it("while something waits, and through the teacher's reply after it", () => {
		assert.equal(keepPair(false, true, false), true);
		assert.equal(keepPair(true, false, true), true);
	});

	it("not once the reply is done with nothing waiting, nor for a reply nothing preceded", () => {
		assert.equal(keepPair(true, false, false), false);
		assert.equal(keepPair(false, false, true), false);
	});
});

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { holdPageHeight } from "../../src/frontend/components/lesson/lesson-scroll-hold.ts";

/** The lesson's page as the browser lays it out: as tall as what it holds, or the height held. */
function fakePage(holds: number) {
	const page = {
		holds,
		style: { minHeight: "" },
		get offsetHeight() {
			return Math.max(page.holds, parseFloat(page.style.minHeight) || 0);
		},
	};
	return page;
}

describe("the lesson page's height while the teacher works", () => {
	let resized: () => void = () => {};
	let watching = 0;
	const real = globalThis.ResizeObserver;
	beforeEach(() => {
		watching = 0;
		globalThis.ResizeObserver = class {
			constructor(onResize: () => void) {
				resized = onResize;
			}
			observe() {
				watching++;
			}
			unobserve() {}
			disconnect() {
				watching = 0;
			}
		} as unknown as typeof ResizeObserver;
	});
	afterEach(() => {
		globalThis.ResizeObserver = real;
	});
	const hold = (page: ReturnType<typeof fakePage>, scroller: { clientWidth: number; clientHeight: number }) => holdPageHeight(page as unknown as HTMLElement, scroller as unknown as HTMLElement);

	it("never gets shorter while one row leaves and the next arrives", () => {
		const page = fakePage(900);
		hold(page, { clientWidth: 1200, clientHeight: 584 });
		resized();
		assert.equal(page.style.minHeight, "900px");
		page.holds = 700;
		resized();
		assert.equal(page.style.minHeight, "900px", "the row that left takes nothing off the page");
		page.holds = 1000;
		resized();
		assert.equal(page.style.minHeight, "1000px");
	});

	it("starts over when the lesson's window changes size, so no empty page is left to scroll into", () => {
		const page = fakePage(900);
		const scroller = { clientWidth: 700, clientHeight: 536 };
		hold(page, scroller);
		resized();
		assert.equal(page.style.minHeight, "900px");
		// Wide again: the two sheets sit side by side and the page is as tall as the window.
		scroller.clientWidth = 1200;
		page.holds = 584;
		resized();
		assert.equal(page.style.minHeight, "584px");
		scroller.clientHeight = 504;
		page.holds = 504;
		resized();
		assert.equal(page.style.minHeight, "504px", "a shorter window too");
		page.holds = 300;
		resized();
		assert.equal(page.style.minHeight, "504px", "and it holds again from there");
	});

	it("watches the page and its window until it is told to stop", () => {
		const stop = hold(fakePage(900), { clientWidth: 1200, clientHeight: 584 });
		assert.equal(watching, 2);
		stop();
		assert.equal(watching, 0);
	});
});

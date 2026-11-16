import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { otherParts } from "../../src/frontend/components/lesson/problem-parts.ts";

/** The statement as the markdown renderer draws it: one wrapper whose children are the blocks. */
function statement(html: string): HTMLElement {
	return parseHTML(`<html><body><div id="root">${html}</div></body></html>`).document.getElementById("root") as unknown as HTMLElement;
}

const text = (els: HTMLElement[]) => els.map((el) => el.textContent);

describe("otherParts", () => {
	it("returns the blocks of the other parts, math between them included, and keeps the shared stem", () => {
		const root = statement(`<div>
			<p>Let X be a random variable with E[X] = 2.</p>
			<p>(a) Find the variance.</p>
			<div class="katex-display">Var(X)</div>
			<p>(b) Find the mean of 3X.</p>
			<p>(c) Is X bounded?</p>
		</div>`);
		assert.deepEqual(text(otherParts(root, "b")), ["(a) Find the variance.", "Var(X)", "(c) Is X bounded?"]);
		assert.deepEqual(text(otherParts(root, "a")), ["(b) Find the mean of 3X.", "(c) Is X bounded?"]);
	});

	it("reads each way a part starts", () => {
		const root = statement(`<div><p>Intro</p><p>a) First</p><p>b. Second</p><p>Part c Third</p></div>`);
		assert.deepEqual(text(otherParts(root, "b")), ["a) First", "Part c Third"]);
	});

	it("reads parts written as list items", () => {
		const root = statement(`<ul><li>(a) First</li><li>(b) Second</li></ul>`);
		assert.deepEqual(text(otherParts(root, "a")), ["(b) Second"]);
	});

	it("does not take a number's decimal point or a sentence's abbreviation for a part", () => {
		const root = statement(`<div><p>(a) It costs 1.5 dollars.</p><p>(b) Compare, i.e. both.</p></div>`);
		assert.deepEqual(text(otherParts(root, "a")), ["(b) Compare, i.e. both."]);
	});

	it("leaves a part's own sub-parts with it", () => {
		const root = statement(`<div><p>(a) Compute:</p><p>(i) the mean</p><p>(ii) the variance</p><p>(b) Explain.</p></div>`);
		assert.deepEqual(text(otherParts(root, "a")), ["(b) Explain."]);
		assert.deepEqual(text(otherParts(root, "b")), ["(a) Compute:", "(i) the mean", "(ii) the variance"]);
	});

	it("returns nothing when the parts are not all siblings", () => {
		const root = statement(`<div><p>(a) First</p><div><p>(b) Second</p></div></div>`);
		assert.deepEqual(otherParts(root, "a"), []);
	});

	it("returns nothing for a part the problem does not have", () => {
		const root = statement(`<div><p>(a) First</p><p>(b) Second</p></div>`);
		assert.deepEqual(otherParts(root, "z"), []);
	});

	it("returns nothing for a problem without parts", () => {
		assert.deepEqual(otherParts(statement(`<div><p>Prove it.</p></div>`), "a"), []);
	});
});

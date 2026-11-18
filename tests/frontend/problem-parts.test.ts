import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseHTML } from "linkedom";
import { otherParts, partMarks, toggled, type Part } from "../../src/frontend/components/lesson/problem-parts.ts";

/** The statement as the markdown renderer draws it: one wrapper whose children are the blocks. */
function statement(html: string): HTMLElement {
	return parseHTML(`<html><body><div id="root">${html}</div></body></html>`).document.getElementById("root") as unknown as HTMLElement;
}

/** Each other part as its label and its blocks' text. */
const text = (parts: Part[]) => parts.map((p) => [p.label, ...p.blocks.map((el) => el.textContent)]);

describe("otherParts", () => {
	it("returns each other part with its blocks, math between them included, and keeps the shared stem", () => {
		const root = statement(`<div>
			<p>Let X be a random variable with E[X] = 2.</p>
			<p>(a) Find the variance.</p>
			<div class="katex-display">Var(X)</div>
			<p>(b) Find the mean of 3X.</p>
			<p>(c) Is X bounded?</p>
		</div>`);
		assert.deepEqual(text(otherParts(root, "b")), [["a", "(a) Find the variance.", "Var(X)"], ["c", "(c) Is X bounded?"]]);
		assert.deepEqual(text(otherParts(root, "a")), [["b", "(b) Find the mean of 3X."], ["c", "(c) Is X bounded?"]]);
	});

	it("reads each way a part starts", () => {
		const root = statement(`<div><p>Intro</p><p>a) First</p><p>b. Second</p><p>Part c Third</p></div>`);
		assert.deepEqual(text(otherParts(root, "b")), [["a", "a) First"], ["c", "Part c Third"]]);
	});

	it("reads parts written as list items", () => {
		const root = statement(`<ul><li>(a) First</li><li>(b) Second</li></ul>`);
		assert.deepEqual(text(otherParts(root, "a")), [["b", "(b) Second"]]);
	});

	it("does not take a number's decimal point or a sentence's abbreviation for a part", () => {
		const root = statement(`<div><p>(a) It costs 1.5 dollars.</p><p>(b) Compare, i.e. both.</p></div>`);
		assert.deepEqual(text(otherParts(root, "a")), [["b", "(b) Compare, i.e. both."]]);
	});

	it("leaves a part's own sub-parts with it", () => {
		const root = statement(`<div><p>(a) Compute:</p><p>(i) the mean</p><p>(ii) the variance</p><p>(b) Explain.</p></div>`);
		assert.deepEqual(text(otherParts(root, "a")), [["b", "(b) Explain."]]);
		assert.deepEqual(text(otherParts(root, "b")), [["a", "(a) Compute:", "(i) the mean", "(ii) the variance"]]);
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

describe("partMarks", () => {
	const root = () =>
		statement(`<div>
			<p>Solve each equation.</p>
			<p>(a) First</p>
			<div class="katex-display">x = 1</div>
			<p>(b) Second</p>
			<p>(c) Third</p>
			<p>Show your work.</p>
		</div>`);
	/** Each marked block's text with its marks. */
	const read = (marks: Map<HTMLElement, Record<string, string>>) => [...marks].map(([el, attrs]) => [el.textContent, attrs]);

	it("marks the current part, makes each other part's first line a folded button and hides the rest of it", () => {
		assert.deepEqual(read(partMarks(root(), "b", [])), [
			["(a) First", { "data-part-head": "a", role: "button", tabindex: "0", "aria-expanded": "false" }],
			["x = 1", { "data-part-fold": "" }],
			["(c) Third", { "data-part-head": "c", role: "button", tabindex: "0", "aria-expanded": "false" }],
			["Show your work.", { "data-part-fold": "" }],
			["(b) Second", { "data-part-current": "" }],
		]);
	});

	it("shows an opened part whole, its first line still the button that folds it", () => {
		assert.deepEqual(read(partMarks(root(), "b", ["a"])).slice(0, 2), [
			["(a) First", { "data-part-head": "a", role: "button", tabindex: "0", "aria-expanded": "true" }],
			["(c) Third", { "data-part-head": "c", role: "button", tabindex: "0", "aria-expanded": "false" }],
		]);
	});

	it("marks only the current part when the others cannot be read", () => {
		assert.deepEqual(read(partMarks(statement(`<div><p>(a) First</p><div><p>(b) Second</p></div></div>`), "a", [])), [["(a) First", { "data-part-current": "" }]]);
	});
});

describe("toggled", () => {
	it("opens a folded part and folds an open one", () => {
		assert.deepEqual(toggled([], "a"), ["a"]);
		assert.deepEqual(toggled(["a", "c"], "a"), ["c"]);
	});
});

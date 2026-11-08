/**
 * The top bar's path segments and clock.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clockText, retypeStep, rootCrumb, slug } from "../../src/frontend/components/app-bar-model.ts";

describe("app bar path", () => {
	it("turns a name into a lowercase slug", () => {
		assert.equal(slug("Review for my exam"), "review-for-my-exam");
		assert.equal(slug("CSE 29"), "cse-29");
		assert.equal(slug("  PS3 (Problem Set 3)  "), "ps3-problem-set-3");
		assert.equal(slug("Café déjà vu"), "café-déjà-vu");
		assert.equal(slug("???"), "untitled");
	});

	it("starts at the class's overview, or at ~ (Home) outside a class", () => {
		assert.deepEqual(rootCrumb({ id: "c1", name: "CSE 21" }), { label: "cse-21", href: "/class", classId: "c1" });
		assert.deepEqual(rootCrumb(null), { label: "~", href: "/" });
	});

	it("shows a 24-hour clock", () => {
		assert.equal(clockText(new Date(2026, 10, 7, 9, 5)), "09:05");
		assert.equal(clockText(new Date(2026, 10, 7, 17, 51)), "17:51");
	});
});

describe("retypeStep", () => {
	const run = (from: string[], to: string[]) => {
		const frames: string[] = [];
		let shown: readonly string[] = from;
		for (let n = 0; n < 50; n++) {
			const next = retypeStep(shown, to);
			if (next === shown) break;
			shown = next;
			frames.push(shown.join(" / "));
		}
		return frames;
	};
	it("erases the old parts letter by letter, then types the new ones", () => {
		assert.deepEqual(run(["~", "home"], ["cse-29", "files"]).slice(0, 6), ["~ / hom", "~ / ho", "~ / h", "~", "", "c"]);
		assert.equal(run(["~", "home"], ["cse-29", "files"]).at(-1), "cse-29 / files");
	});
	it("keeps the shared start and only retypes what changed", () => {
		assert.deepEqual(run(["cse-29", "graph"], ["cse-29", "files"]), ["cse-29 / grap", "cse-29 / gra", "cse-29 / gr", "cse-29 / g", "cse-29", "cse-29 / f", "cse-29 / fi", "cse-29 / fil", "cse-29 / file", "cse-29 / files"]);
	});
	it("returns the same array once done", () => {
		const done = ["~", "home"];
		assert.equal(retypeStep(done, ["~", "home"]), done);
	});
});

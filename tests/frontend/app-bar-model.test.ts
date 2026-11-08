/**
 * The top bar's path segments and clock.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clockText, rootCrumb, slug } from "../../src/frontend/components/app-bar-model.ts";

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

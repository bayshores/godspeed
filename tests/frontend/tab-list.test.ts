import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tabKeyTarget } from "../../src/frontend/components/ui/tab-list.ts";

describe("tabKeyTarget (arrow keys in a row of tabs)", () => {
	it("steps right and left, wrapping at the ends", () => {
		assert.equal(tabKeyTarget(0, 3, "ArrowRight"), 1);
		assert.equal(tabKeyTarget(2, 3, "ArrowRight"), 0);
		assert.equal(tabKeyTarget(0, 3, "ArrowLeft"), 2);
	});
	it("Home and End jump to the ends", () => {
		assert.equal(tabKeyTarget(1, 3, "Home"), 0);
		assert.equal(tabKeyTarget(1, 3, "End"), 2);
	});
	it("leaves other keys alone", () => {
		assert.equal(tabKeyTarget(1, 3, "ArrowDown"), null);
		assert.equal(tabKeyTarget(0, 0, "ArrowRight"), null);
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plural } from "../../src/frontend/lib/plural.ts";

describe("plural", () => {
	it("says one, none and many", () => {
		assert.equal(plural(1, "file"), "1 file");
		assert.equal(plural(0, "file"), "0 files");
		assert.equal(plural(3, "file"), "3 files");
	});

	it("takes an irregular plural", () => {
		assert.equal(plural(1, "fact leaves", "facts leave"), "1 fact leaves");
		assert.equal(plural(2, "fact leaves", "facts leave"), "2 facts leave");
	});
});

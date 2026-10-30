import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { restoreUnsent } from "../src/components/lesson/chat-helpers.ts";

describe("restoreUnsent", () => {
	it("fills an empty composer with the unsent text", () => {
		assert.equal(restoreUnsent("wait, why?", ""), "wait, why?");
		assert.equal(restoreUnsent("wait, why?", "  \n"), "wait, why?");
	});

	it("puts the unsent text and a newline ahead of a new draft", () => {
		assert.equal(restoreUnsent("wait, why?", "and also"), "wait, why?\nand also");
	});
});

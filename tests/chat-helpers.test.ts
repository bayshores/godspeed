import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { restoreUnsentSteer } from "../src/components/lesson/chat-helpers.ts";

describe("restoreUnsentSteer", () => {
	it("fills an empty composer with the unsent text", () => {
		assert.equal(restoreUnsentSteer("wait, why?", ""), "wait, why?");
		assert.equal(restoreUnsentSteer("wait, why?", "  \n"), "wait, why?");
	});

	it("puts the unsent text and a newline ahead of a new draft", () => {
		assert.equal(restoreUnsentSteer("wait, why?", "and also"), "wait, why?\nand also");
	});
});

/**
 * toolActivityLabel: the live tool card names the tool that is actually
 * running, so a long grep never shows "Writing a question…".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolActivityLabel } from "../src/core/pending.ts";

describe("toolActivityLabel (the live tool card label)", () => {
	it("question tools keep their question label", () => {
		assert.equal(toolActivityLabel("quiz"), "Writing a question…");
		assert.equal(toolActivityLabel("ask_user_question"), "Writing a question…");
	});

	it("local tools name their actual activity", () => {
		assert.equal(toolActivityLabel("grep"), "Searching file contents…");
		assert.equal(toolActivityLabel("read"), "Reading a file…");
		assert.equal(toolActivityLabel("find"), "Finding files…");
		assert.equal(toolActivityLabel("ls"), "Listing a directory…");
	});

	it("job dispatch tools get their own labels; unknown tools stay generic", () => {
		assert.equal(toolActivityLabel("pdf"), "Reading a PDF…");
		assert.equal(toolActivityLabel("mystery_tool"), "Working…");
	});
});

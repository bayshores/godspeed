import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askLine, nameSize, noteMark, savedLine, wordsOver, type VaultNote } from "../../src/frontend/components/vault/note-pages-model.ts";

const note = (over: Partial<VaultNote>): VaultNote => ({ topicId: "t1", name: "Stars and bars", recall: null, color: "#888", kind: "godspeed", path: "A/B.md", saving: false, ...over });

describe("a lesson end's saved line", () => {
	it("says saving until every page is written, then saved", () => {
		assert.equal(savedLine([note({}), note({ saving: true })], true), "Saving to Obsidian");
		assert.equal(savedLine([note({}), note({})], true), "Saved to Obsidian");
		assert.equal(savedLine([note({})], false), "Saved to your notes folder");
	});

	it("says nothing with no pages", () => {
		assert.equal(savedLine([], true), null);
	});
});

describe("the ask", () => {
	it("explains the topic in the learner's own words, keeping an acronym's capitals", () => {
		assert.equal(askLine("Stars and bars"), "Explain stars and bars in your own words.");
		assert.equal(askLine("SQL joins"), "Explain SQL joins in your own words.");
	});
});

describe("a page", () => {
	it("shrinks a long name instead of cutting it", () => {
		assert.equal(nameSize("Combinations"), "text-tab");
		assert.equal(nameSize("Counting strings and subsets"), "text-item");
		assert.equal(nameSize("Permutations and combinations with repeats"), "text-ui");
	});

	it("marks only the learner's own notes", () => {
		assert.equal(noteMark(note({ kind: "mine" })), "Yours");
		assert.equal(noteMark(note({ kind: "kept" })), null);
	});
});

describe("the words typed at a lesson end", () => {
	it("says how far over the limit they are", () => {
		assert.equal(wordsOver("  abc  ", 600), -597);
		assert.equal(wordsOver("x".repeat(612), 600), 12);
	});
});

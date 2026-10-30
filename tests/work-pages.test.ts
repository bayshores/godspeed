import assert from "node:assert/strict";
import test from "node:test";
import { splitPages, WORK_PAGE_CHARS } from "../src/core/work-pages.ts";

test("short text is one page", () => {
	assert.deepEqual(splitPages("hello"), ["hello"]);
	assert.deepEqual(splitPages(""), [""]);
	assert.equal(splitPages("x".repeat(WORK_PAGE_CHARS)).length, 1);
});

test("pages join back to the text, and none is over the limit", () => {
	const text = Array.from({ length: 400 }, (_, i) => `line ${i} ${"word ".repeat(i % 17)}`).join("\n");
	const pages = splitPages(text, 500);
	assert.ok(pages.length > 1);
	assert.equal(pages.join(""), text);
	for (const page of pages) assert.ok(page.length <= 500);
});

test("a page ends at a line break in its second half", () => {
	const pages = splitPages(`${"a".repeat(70)}\n${"b".repeat(70)}`, 100);
	assert.deepEqual(pages, [`${"a".repeat(70)}\n`, "b".repeat(70)]);
});

test("a long line with no break in the second half is cut at the limit", () => {
	const pages = splitPages(`ab\n${"c".repeat(250)}`, 100);
	assert.equal(pages[0]!.length, 100);
	assert.equal(pages.join(""), `ab\n${"c".repeat(250)}`);
});

test("a cut never splits an emoji or other surrogate pair", () => {
	const text = `${"a".repeat(99)}😀${"b".repeat(50)}`;
	const pages = splitPages(text, 100);
	assert.equal(pages[0], "a".repeat(99));
	assert.equal(pages.join(""), text);
});

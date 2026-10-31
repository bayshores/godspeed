import assert from "node:assert/strict";
import test from "node:test";
import { pageBlocks, splitPages, WORK_PAGE_BYTES } from "../src/core/work-pages.ts";

const bytes = (page: string[]) => page.reduce((n, block) => n + Buffer.byteLength(block, "utf8"), 0);

test("blocks that fit share one page", () => {
	assert.deepEqual(pageBlocks(["{}", "instructions", "[text 1]\nhello"]), [["{}", "instructions", "[text 1]\nhello"]]);
});

test("a long block fills the rest of a page and goes on on the next ones", () => {
	const long = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n");
	const pages = pageBlocks(["head", long, "tail"], 100);
	assert.ok(pages.length > 2);
	assert.equal(pages[0]![0], "head");
	assert.equal(pages.flat().join(""), `head${long}tail`);
	for (const page of pages) assert.ok(bytes(page) <= 100);
});

test("with less than half a page left, a block that doesn't fit starts a new page", () => {
	const pages = pageBlocks(["a".repeat(60), "b".repeat(70)], 100);
	assert.deepEqual(pages, [["a".repeat(60)], ["b".repeat(70)]]);
});

test("short text is one page", () => {
	assert.deepEqual(splitPages("hello"), ["hello"]);
	assert.deepEqual(splitPages(""), [""]);
	assert.equal(splitPages("x".repeat(WORK_PAGE_BYTES)).length, 1);
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

test("pages are measured in UTF-8 bytes, so Chinese or Japanese text gets shorter pages", () => {
	const text = "日本語の授業ノート".repeat(4000);
	const pages = splitPages(text);
	assert.equal(pages.join(""), text);
	for (const page of pages) assert.ok(Buffer.byteLength(page, "utf8") <= WORK_PAGE_BYTES);
	assert.equal(pages[0]!.length, WORK_PAGE_BYTES / 3);
});

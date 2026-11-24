import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROWS_PER_PAGE, textPages } from "../../src/frontend/components/lesson/page-stage-model.ts";

describe("textPages", () => {
	it("cuts text into numbered pages", () => {
		const text = Array.from({ length: ROWS_PER_PAGE + 2 }, (_, i) => `line ${i + 1}`).join("\n");
		const pages = textPages(text);
		assert.equal(pages.length, 2);
		assert.equal(pages[1]!.start, ROWS_PER_PAGE + 1);
	});

	it("counts a long line as the rows it wraps to", () => {
		const long = "x".repeat(64 * 10);
		const pages = textPages([long, long, long, long, long].join("\n"));
		assert.deepEqual(
			pages.map((p) => p.start),
			[1, 4],
		);
	});
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProgressPayload } from "../../src/shared/core/index.ts";
import { newFilesLine, spaceRow } from "../../src/frontend/components/home-page/space-list-model.ts";

type RowInput = Pick<ProgressPayload, "overall" | "files" | "facts">;
const counts = (strong: number, shaky: number, weak: number, untested: number) => ({ strong, shaky, weak, untested });
const payload = (c = counts(0, 0, 0, 0), files = 1, facts = 1): RowInput => ({
	overall: { topicIds: [], counts: c, workOnNext: [] },
	files: Array.from({ length: files }, () => ({}) as never),
	facts: Array.from({ length: facts }, () => ({}) as never),
});

describe("spaceRow", () => {
	it("the counts in the Progress page's words, zeros left out, strongest first", () => {
		const row = spaceRow(payload(counts(9, 3, 0, 6)), null);
		assert.equal(row.line, "9 strong, 3 shaky and 6 not tested.");
		assert.deepEqual(row.segments.map((s) => [s.key, s.count]), [["strong", 9], ["shaky", 3], ["untested", 6]]);
		assert.equal(spaceRow(payload(counts(0, 0, 2, 0)), null).line, "2 weak.");
	});

	it("keeps the teacher's work line beside the counts", () => {
		assert.deepEqual(spaceRow(payload(counts(1, 0, 0, 0)), "Teacher is reading new files. 2 left.").work, "Teacher is reading new files. 2 left.");
	});

	it("no topics yet: why, in the app's words, or the work line in its place", () => {
		assert.equal(spaceRow(payload(undefined, 0, 0), null).line, "No study files yet.");
		assert.equal(spaceRow(payload(undefined, 3, 0), null).line, "No facts yet. They show up once your agent reads the files.");
		assert.equal(spaceRow(payload(undefined, 3, 40), null).line, "Its facts are not grouped into topics yet.");
		assert.deepEqual(spaceRow(payload(undefined, 3, 0), "Teacher is building this space. 3 left."), { segments: [], line: "Teacher is building this space. 3 left.", work: null });
	});

	it("a space whose progress failed to load says so", () => {
		assert.equal(spaceRow(undefined, null).line, "Couldn't load its progress.");
	});
});

describe("newFilesLine", () => {
	// Fri Nov 13 2026, 10:00 local.
	const NOW = new Date(2026, 10, 13, 10).getTime();
	const found = (day: number, h = 9) => ({ foundByScan: true as const, addedAt: new Date(2026, 10, day, h).toISOString() });

	it("counts files the folder brought lately, from the day the first came", () => {
		assert.equal(newFilesLine([found(11), found(12)], null, NOW), "2 new files since Wednesday");
		assert.equal(newFilesLine([found(12)], null, NOW), "1 new file since yesterday");
		assert.equal(newFilesLine([found(13, 8), found(13, 9)], null, NOW), "2 new files today");
	});

	it("leaves out files added by hand, old ones, and ones already seen on the Files page", () => {
		const byHand = { addedAt: new Date(2026, 10, 12).toISOString() };
		assert.equal(newFilesLine([byHand, found(1)], null, NOW), null);
		assert.equal(newFilesLine([found(11), found(12, 15)], found(12, 9).addedAt, NOW), "1 new file since yesterday");
		assert.equal(newFilesLine([found(11)], found(11).addedAt, NOW), null);
	});
});

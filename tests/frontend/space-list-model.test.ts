import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProgressPayload } from "../../src/shared/core/index.ts";
import { newFilesLine, spaceRow } from "../../src/frontend/components/home-page/space-list-model.ts";

type RowInput = Pick<ProgressPayload, "overall" | "files" | "path">;
const counts = (strong: number, shaky: number, weak: number, untested: number) => ({ strong, shaky, weak, untested });
const payload = (c = counts(0, 0, 0, 0), files = 1): RowInput => ({
	overall: { topicIds: [], counts: c, workOnNext: [] },
	files: Array.from({ length: files }, () => ({}) as never),
});

describe("spaceRow", () => {
	it("the counts in the Graph page's words, zeros left out, strongest first", () => {
		const row = spaceRow(payload(counts(9, 3, 0, 6)), false);
		assert.equal(row.line, "18 topics, 9 strong, 3 shaky, 6 not tested");
		assert.deepEqual(row.segments.map((s) => [s.key, s.count]), [["strong", 9], ["shaky", 3], ["untested", 6]]);
		assert.equal(spaceRow(payload(counts(0, 0, 2, 0)), false).line, "2 topics, 2 weak");
		assert.equal(spaceRow(payload(counts(0, 0, 0, 1)), false).line, "1 topic, 1 not tested");
	});

	it("no topics yet: what to add with no files, nothing while its files are read (the top bar says that)", () => {
		assert.equal(spaceRow(payload(undefined, 0), false).line, "No study files yet.");
		assert.deepEqual(spaceRow(payload(undefined, 3), false), { segments: [], line: "" });
	});

	it("a space with a path and no study files names the topic its Study takes", () => {
		const git = { id: "p1", name: "Git", covers: "c", answered: 0, right: 0, wrong: 0, dontKnow: 0, rate: null, status: "untested" as const, color: "" };
		assert.equal(spaceRow({ ...payload(undefined, 0), path: { goal: "backend developer", topics: [git], nextId: "p1" } }, false).line, "Next up: Git");
	});

	it("a space whose progress failed to load says so; one still loading says nothing", () => {
		assert.equal(spaceRow(undefined, true).line, "Couldn't load its progress.");
		assert.deepEqual(spaceRow(undefined, false), { segments: [], line: "" });
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

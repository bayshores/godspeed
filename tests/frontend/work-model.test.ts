/**
 * Background work on a space, in words (work-model.ts): who does it, the
 * work frame's states and tag, and the lines on Home, the space's tab
 * and the strip's peek.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { files, filesProgress, jobFrame, readNews, spaceFrame, tabWorkTag, workProgress, workerName, workState } from "../../src/frontend/components/work/work-model.ts";
import type { SpaceFile, SpaceSummary, SpaceWork } from "../../src/shared/core/index.ts";

const file = (id: string, status: SpaceFile["status"], extra: Partial<SpaceFile> = {}): SpaceFile => ({
	id,
	origin: "copied",
	name: `${id}.pdf`,
	path: `${id}.pdf`,
	kind: "study",
	contentFp: "",
	status,
	addedAt: "2026-11-01T00:00:00.000Z",
	...extra,
});

const ENDED = new Date(2026, 10, 11, 14, 3);
const NOW = ENDED.getTime() + 60_000;
const base = { grouping: false, working: true };

describe("workerName", () => {
	it("the helper when one is open, else the teacher, else nobody", () => {
		assert.equal(workerName({ teaching: true, helperHere: true }, "Marco"), "Background work");
		assert.equal(workerName({ teaching: false, helperHere: true }, "Marco"), "Background work");
		assert.equal(workerName({ teaching: true, helperHere: false }, "Marco"), "Marco");
		assert.equal(workerName({ teaching: false, helperHere: false }, "Marco"), null);
		assert.equal(workerName(null, "Marco"), "Marco", "before the agent's state is read");
	});
});

describe("the work frame of a space", () => {
	it("no agent: no frame, the strip says that the files wait", () => {
		assert.equal(workState({ ...base, working: false, files: [file("a", "pending"), file("b", "pending")], work: undefined }), null);
	});

	it("reading: how many of the round's files are finished", () => {
		const work = { startedAt: "x", fileIds: ["a"], deadlineIds: [] };
		const state = workState({ ...base, files: [file("old", "ready"), file("a", "ready"), file("b", "extracting"), file("c", "pending")], work });
		assert.deepEqual(state, { kind: "reading", read: 1, total: 3 });
		assert.deepEqual(spaceFrame(state!), { text: "Working on this page", count: "1 of 3 files" });
	});

	it("before a round is recorded, none is read yet", () => {
		assert.deepEqual(workState({ ...base, files: [file("n1", "pending")], work: undefined }), { kind: "reading", read: 0, total: 1 });
	});

	it("grouping the facts into topics", () => {
		const state = workState({ ...base, grouping: true, files: [file("a", "ready")], work: undefined });
		assert.deepEqual(spaceFrame(state!), { text: "Working on this page", count: "grouping facts into topics" });
		assert.equal(workState({ ...base, grouping: true, working: false, files: [file("a", "ready")], work: undefined }), null);
	});

	it("nothing going on: no frame, even right after a round ended", () => {
		assert.equal(workState({ ...base, files: [file("a", "ready")], work: undefined }), null);
		assert.equal(workState({ ...base, files: [file("a", "ready")], work: { startedAt: "x", endedAt: ENDED.toISOString(), fileIds: ["a"], deadlineIds: [] } }), null);
	});
});

describe("what the last round read, for the read notice", () => {
	const round = (ids: string[]): SpaceWork => ({ startedAt: "x", endedAt: ENDED.toISOString(), fileIds: ids, deadlineIds: [] });
	const news = (fs: SpaceFile[], work: SpaceWork | undefined, nowMs = NOW) => readNews({ files: fs, work, nowMs }, "Quigley");

	it("names the teacher, the files read and the ones that could not be, for a day", () => {
		const work = round(["a", "b", "bad", "gone"]);
		const fs = [file("a", "ready"), file("b", "ready"), file("bad", "failed"), file("other", "ready")];
		assert.equal(news(fs, work), "Quigley read 2 files and could not read 1.");
		assert.equal(news([file("a", "ready")], round(["a"])), "Quigley read 1 file.");
		assert.equal(news(fs, work, ENDED.getTime() + 25 * 60 * 60 * 1000), null);
	});

	it("every file failed", () => {
		assert.equal(news([file("a", "failed")], round(["a"])), "Quigley could not read 1 file.");
	});

	it("nothing while files wait, before a round ended, or when the round has no file", () => {
		assert.equal(news([file("a", "ready"), file("n", "pending")], round(["a"])), null);
		assert.equal(news([file("a", "ready")], { startedAt: "x", fileIds: ["a"], deadlineIds: [] }), null);
		assert.equal(news([file("a", "ready")], round(["gone"])), null);
		assert.equal(news([file("a", "ready")], undefined), null);
	});
});

describe("the work frame of a page one job works on", () => {
	it("says what the job does, and nothing while no agent has it", () => {
		assert.deepEqual(jobFrame("Helper", "making your sheet"), { text: "Working on this page", count: "making your sheet" });
		assert.equal(jobFrame(null, "making your sheet"), null);
	});
});

describe("elsewhere", () => {
	const space = (over: Partial<SpaceSummary>): SpaceSummary => ({ id: "spc_ml", name: "Machine Learning", description: "", createdAt: "", updatedAt: "", closed: false, fileCount: 18, color: 1, filesLeft: 0, ...over });

	it("the tab's tag", () => {
		assert.equal(tabWorkTag(space({ filesLeft: 15 })), "15 left");
		assert.equal(tabWorkTag(space({})), null);
	});

	it("files progress adds up the spaces being read and skips closed and finished ones", () => {
		const reading = space({ filesLeft: 11, filesRead: 6 });
		const unread = space({ filesLeft: 2 });
		const progress = filesProgress([reading, unread, space({ filesLeft: 4, closed: true }), space({})]);
		assert.deepEqual(progress, { live: [reading, unread], read: 6, left: 13 });
		assert.deepEqual(filesProgress([]), { live: [], read: 0, left: 0 });
		assert.equal(files(1), "1 file");
		assert.equal(files(19), "19 files");
	});

	it("the strip's peek counts the files of every space being read, else names the work in progress", () => {
		const spaces = [space({ filesLeft: 11, filesRead: 6 }), space({ filesLeft: 2 }), space({ filesLeft: 4, closed: true })];
		const none = { extractions: [], jobs: [], requests: [] };
		const demo = [{ kind: "demo" as const }];
		assert.deepEqual(workProgress({ worker: "Helper", spaces, ...none, jobs: demo }), { doing: "Reading files", count: "6 of 19" });
		assert.deepEqual(workProgress({ worker: "Marco", spaces: [space({})], ...none, jobs: demo }), { doing: "Building a demo", count: null });
		const part = { kind: "notes" as const, phase: "extracting", title: "Slides/06_Counting.pdf (3/12)", part: { i: 3, n: 12 } };
		assert.deepEqual(workProgress({ worker: "Marco", spaces: [space({})], ...none, extractions: [part], jobs: demo }), { doing: "Reading 06_Counting.pdf", count: "3 of 12" }, "a file being read comes before a job");
		assert.equal(workProgress({ worker: "Marco", spaces: [space({})], ...none }), null);
		assert.equal(workProgress({ worker: null, spaces, ...none, jobs: demo }), null, "no agent takes the work");
		const request = "Deadline: Wave Optics Final";
		assert.deepEqual(workProgress({ worker: "Marco", spaces: [space({})], ...none, requests: [request, "Deadlines: 3"] }), { doing: request, count: null }, "a request says its name");
		assert.deepEqual(workProgress({ worker: "Marco", spaces: [space({})], ...none, jobs: demo, requests: [request] }), { doing: "Building a demo", count: null });
	});
});

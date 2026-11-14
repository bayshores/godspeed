/**
 * Background work on a space, in words (work-model.ts): who does it, the
 * work frame's states and tag, and the lines on Today, the space's tab,
 * the top bar chip and Talk.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { files, filesProgress, jobFrame, spaceFrame, tabWorkTag, talkWorkLine, todayWorkLine, workChip, workerName, workState } from "../../src/frontend/components/work/work-model.ts";
import type { AgentAction, SpaceFile, SpaceFileStatus, SpaceSummary } from "../../src/shared/core/index.ts";

const file = (id: string, status: SpaceFileStatus, extra: Partial<SpaceFile> = {}): SpaceFile => ({
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
const base = { grouping: false, working: true, nowMs: NOW };

describe("workerName", () => {
	it("the helper when one is open, else the teacher, else nobody", () => {
		assert.equal(workerName({ teaching: true, helperHere: true }, "Marco"), "Helper");
		assert.equal(workerName({ teaching: false, helperHere: true }, "Marco"), "Helper");
		assert.equal(workerName({ teaching: true, helperHere: false }, "Marco"), "Marco");
		assert.equal(workerName({ teaching: false, helperHere: false }, "Marco"), null);
		assert.equal(workerName(null, "Marco"), "Marco", "before the agent's state is read");
	});
});

describe("the work frame of a space", () => {
	it("no agent: the files wait", () => {
		const state = workState({ ...base, working: false, files: [file("a", "pending"), file("b", "pending")], work: undefined });
		assert.deepEqual(state, { kind: "waiting", left: 2 });
		assert.deepEqual(spaceFrame(state!, "Teacher"), { state: "waiting", text: "2 files are waiting. Open your agent to read them.", count: null });
		assert.equal(spaceFrame({ kind: "waiting", left: 1 }, "Teacher").text, "1 file is waiting. Open your agent to read it.");
	});

	it("reading: how many of the round's files are finished", () => {
		const work = { startedAt: "x", fileIds: ["a"], deadlineIds: [] };
		const state = workState({ ...base, files: [file("old", "ready"), file("a", "ready"), file("b", "extracting"), file("c", "pending")], work });
		assert.deepEqual(state, { kind: "reading", read: 1, total: 3 });
		assert.deepEqual(spaceFrame(state!, "Helper"), { state: "working", text: "Helper is working on this page", count: "1 of 3 files" });
	});

	it("before a round is recorded, none is read yet", () => {
		assert.deepEqual(workState({ ...base, files: [file("n1", "pending")], work: undefined }), { kind: "reading", read: 0, total: 1 });
	});

	it("grouping the facts into topics", () => {
		const state = workState({ ...base, grouping: true, files: [file("a", "ready")], work: undefined });
		assert.deepEqual(spaceFrame(state!, "Marco"), { state: "working", text: "Marco is working on this page", count: "grouping facts into topics" });
		assert.equal(workState({ ...base, grouping: true, working: false, files: [file("a", "ready")], work: undefined }), null);
	});

	it("done: what the round read, for a day", () => {
		const work = { startedAt: "x", endedAt: ENDED.toISOString(), fileIds: ["a", "b", "bad", "gone"], deadlineIds: [] };
		const input = { ...base, files: [file("a", "ready"), file("b", "ready"), file("bad", "failed"), file("other", "ready")], work };
		const state = workState(input);
		assert.deepEqual(state, { kind: "done", read: 2, failed: 1 });
		assert.deepEqual(spaceFrame(state!, "Helper"), { state: "done", text: "Your agent read 2 files.", count: "1 could not be read" });
		assert.equal(workState({ ...input, nowMs: ENDED.getTime() + 25 * 60 * 60 * 1000 }), null);
	});

	it("every file failed", () => {
		const work = { startedAt: "x", endedAt: ENDED.toISOString(), fileIds: ["a"], deadlineIds: [] };
		const state = workState({ ...base, files: [file("a", "failed")], work });
		assert.deepEqual(spaceFrame(state!, "Teacher"), { state: "done", text: "Your agent could not read 1 file.", count: null });
	});

	it("nothing going on and nothing finished: no frame", () => {
		assert.equal(workState({ ...base, files: [file("a", "ready")], work: undefined }), null);
	});
});

describe("the work frame of a page one job works on", () => {
	it("says who and what, or that it waits", () => {
		assert.deepEqual(jobFrame("Helper", "making your sheet"), { state: "working", text: "Helper is working on this page", count: "making your sheet" });
		assert.deepEqual(jobFrame(null, "making your sheet"), { state: "waiting", text: "This page is waiting. Open your agent to carry on.", count: null });
	});
});

describe("elsewhere", () => {
	const space = (over: Partial<SpaceSummary>): SpaceSummary => ({ id: "spc_ml", name: "Machine Learning", description: "", createdAt: "", updatedAt: "", archived: false, fileCount: 18, color: 1, filesLeft: 0, ...over });

	it("Today names the space and how many files are left", () => {
		assert.equal(todayWorkLine(space({ filesLeft: 15, building: true }), "Helper"), "Helper is building it, 15 left");
		assert.equal(todayWorkLine(space({ filesLeft: 2 }), "Teacher"), "Teacher is reading new files, 2 left");
		assert.equal(todayWorkLine(space({ filesLeft: 18, building: true }), null), "18 files are waiting for your agent");
		assert.equal(todayWorkLine(space({ filesLeft: 1 }), null), "1 file is waiting for your agent");
		assert.equal(todayWorkLine(space({}), "Teacher"), null);
	});

	it("the tab's tag", () => {
		assert.equal(tabWorkTag(space({ filesLeft: 15 })), "15 left");
		assert.equal(tabWorkTag(space({})), null);
	});

	it("files progress adds up the spaces being read and skips archived and finished ones", () => {
		const reading = space({ filesLeft: 11, filesRead: 6 });
		const unread = space({ filesLeft: 2 });
		const progress = filesProgress([reading, unread, space({ filesLeft: 4, archived: true }), space({})]);
		assert.deepEqual(progress, { live: [reading, unread], read: 6, left: 13 });
		assert.deepEqual(filesProgress([]), { live: [], read: 0, left: 0 });
		assert.equal(files(1), "1 file");
		assert.equal(files(19), "19 files");
	});

	it("the top bar chip counts the files of every space being read, else the jobs", () => {
		const spaces = [space({ filesLeft: 11, filesRead: 6 }), space({ filesLeft: 2 }), space({ filesLeft: 4, archived: true })];
		assert.equal(workChip({ worker: "Helper", spaces, jobs: 3 }), "Helper, 6 of 19 files");
		assert.equal(workChip({ worker: "Marco", spaces: [space({})], jobs: 1 }), "Marco, 1 job");
		assert.equal(workChip({ worker: "Marco", spaces: [space({})], jobs: 2 }), "Marco, 2 jobs");
		assert.equal(workChip({ worker: "Marco", spaces: [space({})], jobs: 0 }), null);
		assert.equal(workChip({ worker: null, spaces, jobs: 3 }), null, "no agent takes the work");
	});

	it("Talk's line under the row that created the space", () => {
		const action = (over: Partial<AgentAction>): AgentAction => ({ id: "a1", at: "", agent: "Claude Code", label: "Creating Machine Learning", spaceId: "spc_ml", target: { kind: "space", id: "spc_ml" }, page: "/space", ...over });
		const spaces = [space({ filesLeft: 15 })];
		assert.equal(talkWorkLine(action({}), spaces, true), "Reading its files, 15 left");
		assert.equal(talkWorkLine(action({}), spaces, false), "15 files are waiting for your agent");
		assert.equal(talkWorkLine(action({ label: "Renaming Machine Learning" }), spaces, true), null);
		assert.equal(talkWorkLine(action({}), [space({})], true), null);
		assert.equal(talkWorkLine(null, spaces, true), null);
	});
});

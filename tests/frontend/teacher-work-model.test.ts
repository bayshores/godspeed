/**
 * The teacher's work on a space, in words (teacher-work-model.ts): the
 * strip's states, its two lines, the files and deadlines it lists, and the
 * lines on Today, the space's tab and Talk.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasWork, tabWorkTag, talkWorkLine, todayWorkLine, workDeadlines, workDetail, workFiles, workState, workTitle } from "../../src/frontend/components/teacher-work/teacher-work-model.ts";
import type { AgentAction, FileCoverage, SpaceDeadline, SpaceFile, SpaceFileStatus, SpaceSummary } from "../../src/shared/core/index.ts";

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
const cover = (fileId: string, facts: number): FileCoverage => ({ fileId, name: `${fileId}.pdf`, facts, inLessons: 0, share: facts ? 0 : null });
const deadline = (id: string, name: string): SpaceDeadline => ({ id, kind: "exam", name, date: "2026-12-01", fileIds: [], done: false });

const ENDED = new Date(2026, 10, 11, 14, 3);
const NOW = ENDED.getTime() + 60_000;
const base = { deadlines: [] as SpaceDeadline[], coverage: [] as FileCoverage[], grouping: false, teaching: true, nowMs: NOW };

describe("workState", () => {
	it("no agent: the files wait", () => {
		const state = workState({ ...base, teaching: false, files: [file("a", "pending"), file("b", "pending")], work: undefined });
		assert.deepEqual(state, { kind: "waiting", left: 2 });
		assert.equal(workTitle(state!, "Teacher"), "2 files are waiting for your agent");
		assert.equal(workDetail(state!), null);
		assert.equal(workTitle({ kind: "waiting", left: 1 }, "Teacher"), "1 file is waiting for your agent");
	});

	it("a new space is being built: the file read now and how many are left", () => {
		const work = { startedAt: "x", fileIds: ["a"], deadlineIds: [] };
		const state = workState({ ...base, files: [file("a", "ready"), file("week1-notes", "extracting"), file("c", "pending"), file("d", "pending")], work });
		assert.deepEqual(state, { kind: "reading", building: true, current: "week1-notes.pdf", left: 2 });
		assert.equal(workTitle(state!, "Marco"), "Marco is building this space");
		assert.equal(workDetail(state!), "Reading week1-notes.pdf now. 2 left.");
	});

	it("new files in a space with read files", () => {
		const state = workState({ ...base, files: [file("old", "ready"), file("new", "extracting")], work: { startedAt: "x", fileIds: [], deadlineIds: [] } });
		assert.deepEqual(state, { kind: "reading", building: false, current: "new.pdf", left: 0 });
		assert.equal(workTitle(state!, "Teacher"), "Teacher is reading new files");
		assert.equal(workDetail(state!), "Reading new.pdf now. It is the last file.");
	});

	it("before the agent picks a file up, only the count", () => {
		const state = workState({ ...base, files: [file("old", "ready"), file("n1", "pending"), file("n2", "pending")], work: undefined });
		assert.equal(workDetail(state!), "2 files left.");
	});

	it("done: what the round read and made, for a day", () => {
		const work = { startedAt: "x", endedAt: ENDED.toISOString(), fileIds: ["a", "b", "bad", "gone"], deadlineIds: ["ddl_1", "ddl_gone"] };
		const files = [file("a", "ready"), file("b", "ready"), file("bad", "failed"), file("other", "ready")];
		const input = { ...base, files, work, deadlines: [deadline("ddl_1", "Midterm")], coverage: [cover("a", 6), cover("b", 3), cover("other", 40)] };
		const state = workState(input);
		assert.deepEqual(state, { kind: "done", read: 2, failed: 1, facts: 9, deadlines: 1, endedAt: work.endedAt });
		assert.equal(workTitle(state!, "Teacher"), "Teacher read 2 files");
		assert.equal(workDetail(state!), "9 facts and 1 deadline added. 1 file could not be read. Finished at 14:03.");
		assert.equal(hasWork(input), true);
		const dayLater = { ...input, nowMs: ENDED.getTime() + 25 * 60 * 60 * 1000 };
		assert.equal(workState(dayLater), null);
		assert.equal(hasWork(dayLater), false);
	});

	it("done with nothing counted yet says only when", () => {
		const work = { startedAt: "x", endedAt: ENDED.toISOString(), fileIds: ["a"], deadlineIds: [] };
		const state = workState({ ...base, files: [file("a", "ready")], work });
		assert.equal(workTitle(state!, "Teacher"), "Teacher read 1 file");
		assert.equal(workDetail(state!), "Finished at 14:03.");
	});

	it("every file failed", () => {
		const work = { startedAt: "x", endedAt: ENDED.toISOString(), fileIds: ["a"], deadlineIds: [] };
		const state = workState({ ...base, files: [file("a", "failed")], work });
		assert.equal(workTitle(state!, "Teacher"), "Teacher could not read 1 file");
	});

	it("grouping after a round", () => {
		const work = { startedAt: "x", endedAt: ENDED.toISOString(), fileIds: ["a"], deadlineIds: [] };
		const state = workState({ ...base, grouping: true, files: [file("a", "ready")], work });
		assert.equal(workTitle(state!, "Teacher"), "Teacher is grouping the facts into topics");
		assert.equal(workState({ ...base, grouping: true, files: [file("a", "ready")], work: undefined }), null, "grouping alone shows nothing");
	});

	it("nothing going on and nothing finished: nothing", () => {
		assert.equal(workState({ ...base, files: [file("a", "ready")], work: undefined }), null);
		assert.equal(hasWork({ files: [file("a", "ready")], work: undefined, nowMs: NOW }), false);
	});
});

describe("workFiles", () => {
	it("the file read now, then the finished ones newest first, then the waiting ones", () => {
		const files = [
			file("a", "ready"),
			file("b", "ready", { kind: "info", sortedAsInfo: true }),
			file("c", "failed"),
			file("d", "extracting"),
			file("e", "pending"),
			file("old", "ready"),
		];
		const work = { startedAt: "x", fileIds: ["a", "b", "c"], deadlineIds: [] };
		assert.deepEqual(workFiles(files, work, [cover("a", 1)]), {
			rows: [
				{ id: "d", name: "d.pdf", note: "reading now" },
				{ id: "c", name: "c.pdf", note: "could not be read" },
				{ id: "b", name: "b.pdf", note: "space info" },
				{ id: "a", name: "a.pdf", note: "1 fact" },
				{ id: "e", name: "e.pdf", note: "waiting" },
			],
			more: 0,
		});
	});

	it("lists six and counts the rest", () => {
		const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
		const made = workFiles(ids.map((id) => file(id, "ready")), { startedAt: "x", fileIds: ids, deadlineIds: [] }, []);
		assert.equal(made.rows.length, 6);
		assert.equal(made.rows[0]?.note, "read");
		assert.equal(made.more, 2);
	});
});

describe("workDeadlines", () => {
	it("the round's deadlines that are still there", () => {
		const all = [deadline("ddl_1", "Midterm"), deadline("ddl_2", "Final")];
		assert.deepEqual(workDeadlines(all, { startedAt: "x", fileIds: [], deadlineIds: ["ddl_2", "ddl_gone"] }).map((d) => d.name), ["Final"]);
		assert.deepEqual(workDeadlines(all, undefined), []);
	});
});

describe("elsewhere", () => {
	const space = (over: Partial<SpaceSummary>): SpaceSummary => ({ id: "spc_ml", name: "Machine Learning", description: "", createdAt: "", updatedAt: "", archived: false, fileCount: 18, color: 1, filesLeft: 0, ...over });

	it("Today names the space and how many files are left", () => {
		assert.equal(todayWorkLine(space({ filesLeft: 15, building: true }), "Teacher", true), "Teacher is building Machine Learning. 15 left.");
		assert.equal(todayWorkLine(space({ filesLeft: 2 }), "Teacher", true), "Teacher is reading new files in Machine Learning. 2 left.");
		assert.equal(todayWorkLine(space({ filesLeft: 18, building: true }), "Teacher", false), "18 files in Machine Learning are waiting for your agent");
		assert.equal(todayWorkLine(space({}), "Teacher", true), null);
	});

	it("the tab's tag", () => {
		assert.equal(tabWorkTag(space({ filesLeft: 15 })), "15 left");
		assert.equal(tabWorkTag(space({})), null);
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

/**
 * SPACE WORK (core/space-work.ts): a round of the teacher reading a space's
 * files opens, collects what finished, notes deadlines and ends.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isWaitingFile, workAfterDeadline, workAfterFiles } from "../../src/shared/core/space-work.ts";
import type { SpaceFile, SpaceFileStatus } from "../../src/shared/core/contracts.ts";

const file = (id: string, status: SpaceFileStatus, kind: "study" | "info" = "study"): SpaceFile => ({
	id,
	origin: "copied",
	name: `${id}.pdf`,
	path: `${id}.pdf`,
	kind,
	contentFp: "",
	status,
	addedAt: "2026-11-01T00:00:00.000Z",
});

const T1 = "2026-11-11T10:00:00.000Z";
const T2 = "2026-11-11T10:05:00.000Z";

describe("isWaitingFile", () => {
	it("is a study file that is pending or being read", () => {
		assert.equal(isWaitingFile(file("a", "pending")), true);
		assert.equal(isWaitingFile(file("a", "extracting")), true);
		assert.equal(isWaitingFile(file("a", "ready")), false);
		assert.equal(isWaitingFile(file("a", "failed")), false);
		assert.equal(isWaitingFile(file("a", "pending", "info")), false);
	});
});

describe("workAfterFiles", () => {
	it("opens a round when a study file starts waiting", () => {
		assert.deepEqual(workAfterFiles(undefined, [], [file("a", "pending")], T1), { startedAt: T1, fileIds: [], deadlineIds: [] });
	});

	it("opens nothing for space info files or files that are ready", () => {
		assert.equal(workAfterFiles(undefined, [], [file("a", "ready"), file("b", "pending", "info")], T1), undefined);
	});

	it("collects each file that stops waiting, read or failed, once", () => {
		const open = { startedAt: T1, fileIds: [], deadlineIds: [] };
		const before = [file("a", "extracting"), file("b", "pending"), file("c", "pending")];
		const one = workAfterFiles(open, before, [file("a", "ready"), file("b", "extracting"), file("c", "pending")], T2);
		assert.deepEqual(one, { startedAt: T1, fileIds: ["a"], deadlineIds: [] });
		const two = workAfterFiles(one, [file("a", "ready"), file("b", "extracting"), file("c", "pending")], [file("a", "ready"), file("b", "failed"), file("c", "extracting")], T2);
		assert.deepEqual(two?.fileIds, ["a", "b"]);
		assert.equal(two?.endedAt, undefined);
	});

	it("ends when no file waits", () => {
		const open = { startedAt: T1, fileIds: ["a"], deadlineIds: [] };
		assert.deepEqual(workAfterFiles(open, [file("a", "ready"), file("b", "extracting")], [file("a", "ready"), file("b", "ready")], T2), {
			startedAt: T1,
			endedAt: T2,
			fileIds: ["a", "b"],
			deadlineIds: [],
		});
	});

	it("leaves no trace when the round made nothing (the waiting file was removed)", () => {
		const open = { startedAt: T1, fileIds: [], deadlineIds: [] };
		assert.equal(workAfterFiles(open, [file("a", "pending")], [], T2), undefined);
	});

	it("keeps an ended round until new files wait, then starts over", () => {
		const ended = { startedAt: T1, endedAt: T1, fileIds: ["a"], deadlineIds: ["ddl_1"] };
		assert.equal(workAfterFiles(ended, [file("a", "ready")], [file("a", "ready")], T2), ended);
		assert.deepEqual(workAfterFiles(ended, [file("a", "ready")], [file("a", "ready"), file("b", "pending")], T2), { startedAt: T2, fileIds: [], deadlineIds: [] });
	});
});

describe("workAfterDeadline", () => {
	it("notes a deadline added while a round is open, and only then", () => {
		const open = { startedAt: T1, fileIds: [], deadlineIds: [] };
		assert.deepEqual(workAfterDeadline(open, "ddl_1")?.deadlineIds, ["ddl_1"]);
		const ended = { ...open, endedAt: T2 };
		assert.equal(workAfterDeadline(ended, "ddl_1"), ended);
		assert.equal(workAfterDeadline(undefined, "ddl_1"), undefined);
	});
});

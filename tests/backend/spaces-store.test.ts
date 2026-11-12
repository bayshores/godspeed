/**
 * SPACES PINS — storage:
 *  - the SpaceStore record lifecycle (create, list, update, files, delete)
 *  - honest refusal of a newer-stamped space record
 *  - one graph family PER SPACE: a space graph never sees the "No space"
 *    graph's lines and vice versa (a separate graph per space)
 *  - lessons carry an optional spaceId (absent = "No space")
 *  - deleteSourceTraces: a space file's facts die, shared facts survive
 * Runs under an isolated LH_DATA_DIR (set before any config-loading import).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-spaces-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { spaceStore } = await import("../../src/backend/store/spaces.ts");
const { chatStore } = await import("../../src/backend/store/chats.ts");
const { graphStoreFor, graphStoreForChat, allGraphScopes } = await import("../../src/backend/server/stores.ts");
const { deleteSourceTraces } = await import("../../src/shared/core/graph-deletion.ts");
const { getGraph } = await import("../../src/shared/core/graph.ts");
const { parseSpaceScope, isSupportedSpaceFile, extensionOf, isCalendarDate, isClockTime, SpaceDeadlineError, deadlineDueAt, compareDeadlines, cleanSignature, isSpaceColor, nextSpaceColor } = await import("../../src/shared/core/contracts.ts");

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const node = (id: string, chatId: string, extra: Partial<{ aliases: string[] }> = {}) => ({
	id,
	name: id,
	statement: `${id} holds`,
	aliases: extra.aliases ?? [],
	createdAt: "2026-10-26T00:00:00.000Z",
	provenance: [{ chatId, messageId: "" }],
});

describe("SpaceStore", () => {
	it("creates a space with a clean name, empty files, not archived", () => {
		const space = spaceStore.createSpace({ name: "  MATH   20C ", description: " Calc III " });
		assert.match(space.id, /^spc_/);
		assert.equal(space.name, "MATH 20C");
		assert.equal(space.description, "Calc III");
		assert.equal(space.archived, false);
		assert.deepEqual(space.files, []);
		assert.ok(fs.existsSync(path.join(TMP_DATA, "spaces", space.id, "space.json")));
	});

	it("lists, updates (bumps updatedAt), links and unlinks a folder", async () => {
		const space = spaceStore.createSpace({ name: "CSE 100" });
		await new Promise((r) => setTimeout(r, 5));
		const updated = spaceStore.updateSpace(space.id, { description: "Data structures", archived: true, linkedFolder: "/tmp/cse100" });
		assert.equal(updated.archived, true);
		assert.equal(updated.linkedFolder, "/tmp/cse100");
		assert.ok(updated.updatedAt > space.updatedAt);
		const listed = spaceStore.listSpaces().find((c) => c.id === space.id);
		assert.equal(listed?.description, "Data structures");
		assert.equal(listed?.fileCount, 0);
		assert.equal(spaceStore.updateSpace(space.id, { linkedFolder: null }).linkedFolder, undefined);
	});

	it("listSpaceRecords gives the full records in listSpaces order", () => {
		const space = spaceStore.createSpace({ name: "CSE 12" });
		spaceStore.addDeadline(space.id, { kind: "exam", name: "Midterm", date: "2026-11-05" });
		const records = spaceStore.listSpaceRecords();
		assert.deepEqual(records.map((r) => r.id), spaceStore.listSpaces().map((c) => c.id));
		assert.equal(records.find((r) => r.id === space.id)?.deadlines?.[0]?.name, "Midterm");
	});

	it("a prep is a space with a prep sheet: saved, listed with its day, replaced by a patch", () => {
		const prep = { goal: "Phone screen", date: "2026-11-20", about: "", sources: [], topics: [] };
		const space = spaceStore.createSpace({ name: "Phone screen", prep });
		assert.deepEqual(spaceStore.getSpace(space.id)?.prep, prep);
		assert.deepEqual(spaceStore.listSpaces().find((c) => c.id === space.id)?.prep, { date: "2026-11-20" });
		const written = { goal: "Phone screen", about: "Four questions.", sources: [], topics: [{ id: "pt_0a1b2c3d", name: "Arrays" }], mock: { questions: 4, minutes: 70 } };
		assert.deepEqual(spaceStore.updateSpace(space.id, { prep: written }).prep, written);
		assert.deepEqual(spaceStore.listSpaces().find((c) => c.id === space.id)?.prep, {}, "no day");
		const plain = spaceStore.createSpace({ name: "Plain space" });
		assert.equal("prep" in plain, false);
		assert.equal("prep" in spaceStore.listSpaces().find((c) => c.id === plain.id)!, false);
	});

	it("space rules are cleaned on save, and an empty list removes them", () => {
		const space = spaceStore.createSpace({ name: "CSE 30" });
		assert.equal("rules" in space, false, "no rules, no field");
		const updated = spaceStore.updateSpace(space.id, { rules: [" Use the textbook's notation ", "", "Use the textbook's notation"] });
		assert.deepEqual(updated.rules, ["Use the textbook's notation"]);
		assert.deepEqual(spaceStore.getSpace(space.id)?.rules, ["Use the textbook's notation"]);
		assert.equal("rules" in spaceStore.updateSpace(space.id, { rules: [] }), false);
	});

	it("saveFiles replaces the file list without bumping updatedAt", () => {
		const space = spaceStore.createSpace({ name: "PHYS 2B" });
		const file = {
			id: "f_000000000001",
			origin: "copied" as const,
			name: "syllabus.pdf",
			path: "syllabus.pdf",
			kind: "info" as const,
			contentFp: "abc",
			status: "ready" as const,
			addedAt: "2026-10-26T00:00:00.000Z",
		};
		const saved = spaceStore.saveFiles(space.id, [file]);
		assert.equal(saved.updatedAt, space.updatedAt);
		assert.deepEqual(spaceStore.getSpace(space.id)?.files, [file]);
	});

	it("saveFiles adds removed files, and ones older than 14 days drop out on read", () => {
		const space = spaceStore.createSpace({ name: "PHYS 2C" });
		const old = { id: "f_000000000002", name: "old.pdf", at: new Date(Date.now() - 15 * 86_400_000).toISOString() };
		const fresh = { id: "f_000000000003", name: "fresh.pdf", at: new Date().toISOString() };
		spaceStore.saveFiles(space.id, [], [old]);
		spaceStore.saveFiles(space.id, [], [fresh]);
		assert.deepEqual(spaceStore.getSpace(space.id)?.removedFiles, [fresh]);
	});

	it("remembers a round of the teacher's work: its files, its deadlines, and Close", () => {
		const space = spaceStore.createSpace({ name: "BIO 1" });
		const study = (id: string, status: "pending" | "extracting" | "ready") => ({
			id,
			origin: "copied" as const,
			name: `${id}.pdf`,
			path: `${id}.pdf`,
			kind: "study" as const,
			contentFp: "",
			status,
			addedAt: "2026-10-26T00:00:00.000Z",
		});
		spaceStore.saveFiles(space.id, [study("f_a", "pending"), study("f_b", "pending")]);
		const summary = () => spaceStore.listSpaces().find((s) => s.id === space.id);
		assert.equal(summary()?.filesLeft, 2);
		assert.equal(summary()?.building, true);
		assert.equal(spaceStore.closeWork(space.id), false, "an open round stays");

		const deadline = spaceStore.addDeadline(space.id, { kind: "exam", name: "Midterm", date: "2026-12-01" });
		spaceStore.saveFiles(space.id, [study("f_a", "ready"), study("f_b", "extracting")]);
		assert.equal(summary()?.filesLeft, 1);
		const done = spaceStore.saveFiles(space.id, [study("f_a", "ready"), study("f_b", "ready")]);
		assert.deepEqual(done.lastWork?.fileIds, ["f_a", "f_b"]);
		assert.deepEqual(done.lastWork?.deadlineIds, [deadline.id]);
		assert.ok(done.lastWork?.endedAt);
		assert.deepEqual(spaceStore.getSpace(space.id)?.lastWork, done.lastWork, "read back from disk");
		assert.equal(summary()?.filesLeft, 0);
		assert.equal(summary()?.building, undefined);

		// New files in a space that has read ones: not building.
		spaceStore.saveFiles(space.id, [study("f_a", "ready"), study("f_b", "ready"), study("f_c", "pending")]);
		assert.equal(summary()?.building, undefined);
		spaceStore.saveFiles(space.id, [study("f_a", "ready"), study("f_b", "ready"), study("f_c", "ready")]);
		assert.deepEqual(spaceStore.getSpace(space.id)?.lastWork?.fileIds, ["f_c"]);

		assert.equal(spaceStore.closeWork(space.id), true);
		assert.equal(spaceStore.getSpace(space.id)?.lastWork, undefined);
		assert.equal(spaceStore.closeWork(space.id), false);
	});

	it("refuses a record stamped newer than this build", () => {
		const space = spaceStore.createSpace({ name: "Future" });
		const file = path.join(TMP_DATA, "spaces", space.id, "space.json");
		const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
		fs.writeFileSync(file, JSON.stringify({ ...raw, version: 99 }));
		assert.equal(spaceStore.getSpace(space.id), null);
	});

	it("rejects path-unsafe ids and deletes the whole space folder", () => {
		assert.equal(spaceStore.getSpace("../etc"), null, "a path-unsafe id never reaches the fs");
		assert.throws(() => spaceStore.updateSpace("../etc", { name: "x" }));
		const space = spaceStore.createSpace({ name: "Doomed" });
		assert.equal(spaceStore.deleteSpace(space.id), true);
		assert.equal(fs.existsSync(path.join(TMP_DATA, "spaces", space.id)), false);
		assert.equal(spaceStore.deleteSpace(space.id), false);
	});
});

describe("deadlines", () => {
	const studyFile = (id: string) => ({
		id,
		origin: "copied" as const,
		name: `${id}.md`,
		path: `${id}/${id}.md`,
		kind: "study" as const,
		contentFp: "",
		status: "ready" as const,
		addedAt: "2026-10-26T00:00:00.000Z",
	});
	const spaceFile = (id: string) => path.join(TMP_DATA, "spaces", id, "space.json");

	it("adds, updates, sorts and removes deadlines; stamps version 10", () => {
		const space = spaceStore.createSpace({ name: "CSE 21" });
		assert.equal(space.version, 10);
		spaceStore.saveFiles(space.id, [studyFile("f_aaaaaaaaaaaa"), studyFile("f_bbbbbbbbbbbb")]);
		const finalExam = spaceStore.addDeadline(space.id, {
			kind: "exam",
			name: "  Final  ",
			date: "2026-12-10",
			time: "08:00",
			fileIds: ["f_aaaaaaaaaaaa", "f_bbbbbbbbbbbb"],
		});
		assert.match(finalExam.id, /^ddl_[0-9a-f]{12}$/);
		assert.equal(finalExam.name, "Final", "names are trimmed");
		assert.equal(finalExam.time, "08:00");
		assert.equal(finalExam.done, false);
		const midterm = spaceStore.addDeadline(space.id, { kind: "exam", name: "Midterm 1", date: "2026-11-05" });
		assert.deepEqual(midterm.fileIds, []);
		assert.equal("time" in midterm, false, "no time, no field");
		assert.deepEqual(spaceStore.getSpace(space.id)?.deadlines?.map((d) => d.name), ["Midterm 1", "Final"], "soonest first");

		const moved = spaceStore.updateDeadline(space.id, midterm.id, { kind: "quiz", date: "2026-12-20", fileIds: ["f_aaaaaaaaaaaa"] });
		assert.equal(moved.name, "Midterm 1");
		assert.equal(moved.kind, "quiz");
		assert.deepEqual(moved.fileIds, ["f_aaaaaaaaaaaa"]);
		assert.deepEqual(spaceStore.getSpace(space.id)?.deadlines?.map((d) => d.name), ["Final", "Midterm 1"]);

		const onDisk = JSON.parse(fs.readFileSync(spaceFile(space.id), "utf-8"));
		assert.equal(onDisk.version, 10);
		assert.equal(onDisk.deadlines.length, 2);
		assert.equal(onDisk.exams, undefined);

		assert.equal(spaceStore.removeDeadline(space.id, midterm.id), true);
		assert.equal(spaceStore.removeDeadline(space.id, midterm.id), false);
		assert.deepEqual(spaceStore.getSpace(space.id)?.deadlines?.map((d) => d.id), [finalExam.id]);
	});

	it("keeps left-out files and the source; a file is never both covered and left out", () => {
		const space = spaceStore.createSpace({ name: "CSE 21" });
		spaceStore.saveFiles(space.id, [studyFile("f_aaaaaaaaaaaa"), studyFile("f_bbbbbbbbbbbb"), studyFile("f_cccccccccccc")]);
		const mid = spaceStore.addDeadline(space.id, { kind: "exam", name: "Midterm", date: "2026-11-04", fileIds: ["f_aaaaaaaaaaaa"], leftOutIds: ["f_bbbbbbbbbbbb"], source: "  practice   exam.pdf " });
		assert.deepEqual([mid.fileIds, mid.leftOutIds, mid.source], [["f_aaaaaaaaaaaa"], ["f_bbbbbbbbbbbb"], "practice exam.pdf"]);
		const added = spaceStore.updateDeadline(space.id, mid.id, { fileIds: ["f_aaaaaaaaaaaa", "f_bbbbbbbbbbbb"] });
		assert.deepEqual([added.fileIds, "leftOutIds" in added], [["f_aaaaaaaaaaaa", "f_bbbbbbbbbbbb"], false], "adding a left-out file takes it off the left-out list");
		const out = spaceStore.updateDeadline(space.id, mid.id, { leftOutIds: ["f_bbbbbbbbbbbb", "f_cccccccccccc"] });
		assert.deepEqual([out.fileIds, out.leftOutIds], [["f_aaaaaaaaaaaa"], ["f_bbbbbbbbbbbb", "f_cccccccccccc"]], "leaving out a covered file uncovers it");
		const cleared = spaceStore.updateDeadline(space.id, mid.id, { source: null });
		assert.equal("source" in cleared, false);
		spaceStore.saveFiles(space.id, [studyFile("f_aaaaaaaaaaaa"), studyFile("f_bbbbbbbbbbbb")]);
		assert.deepEqual(spaceStore.getSpace(space.id)?.deadlines?.[0]?.leftOutIds, ["f_bbbbbbbbbbbb"], "a removed file drops off the left-out list");
		assert.throws(() => spaceStore.updateDeadline(space.id, mid.id, { leftOutIds: ["f_nope00000000"] }), /Not files of this space/);
	});

	it("sorts by date, then time (none = 23:59), then name", () => {
		const space = spaceStore.createSpace({ name: "Sorting" });
		spaceStore.addDeadline(space.id, { kind: "homework", name: "B no time", date: "2026-11-01" });
		spaceStore.addDeadline(space.id, { kind: "homework", name: "A no time", date: "2026-11-01" });
		spaceStore.addDeadline(space.id, { kind: "quiz", name: "Z morning", date: "2026-11-01", time: "09:00" });
		spaceStore.addDeadline(space.id, { kind: "quiz", name: "Late", date: "2026-11-01", time: "23:59" });
		spaceStore.addDeadline(space.id, { kind: "exam", name: "Earlier day", date: "2026-10-31", time: "23:00" });
		assert.deepEqual(
			spaceStore.getSpace(space.id)?.deadlines?.map((d) => d.name),
			["Earlier day", "Z morning", "A no time", "B no time", "Late"],
		);
		assert.deepEqual(deadlineDueAt({ date: "2026-11-01" }), { date: "2026-11-01", time: "23:59" });
		assert.deepEqual(deadlineDueAt({ date: "2026-11-01", time: "07:30" }), { date: "2026-11-01", time: "07:30" });
		assert.ok(compareDeadlines({ date: "2026-11-01", name: "a" }, { date: "2026-11-01", time: "12:00", name: "b" }) > 0);
	});

	it("done stamps doneAt, undone removes it, time null clears the time", () => {
		const space = spaceStore.createSpace({ name: "Done" });
		const hw = spaceStore.addDeadline(space.id, { kind: "homework", name: "HW 1", date: "2026-11-01", time: "17:00" });
		const done = spaceStore.updateDeadline(space.id, hw.id, { done: true });
		assert.equal(done.done, true);
		assert.ok(done.doneAt && !Number.isNaN(Date.parse(done.doneAt)), "doneAt is an ISO time");
		const renamed = spaceStore.updateDeadline(space.id, hw.id, { name: "HW 1a" });
		assert.equal(renamed.doneAt, done.doneAt, "other edits keep doneAt");
		const again = spaceStore.updateDeadline(space.id, hw.id, { done: true });
		assert.equal(again.doneAt, done.doneAt, "ticking a done one again keeps its time");
		const undone = spaceStore.updateDeadline(space.id, hw.id, { done: false });
		assert.equal(undone.done, false);
		assert.equal("doneAt" in undone, false);
		const cleared = spaceStore.updateDeadline(space.id, hw.id, { time: null });
		assert.equal("time" in cleared, false);
		const onDisk = JSON.parse(fs.readFileSync(spaceFile(space.id), "utf-8"));
		assert.equal(onDisk.deadlines[0].time, undefined);
		assert.equal(onDisk.deadlines[0].doneAt, undefined);
	});

	it("validates kind, name, date, time and files", () => {
		const space = spaceStore.createSpace({ name: "MATH 20C" });
		spaceStore.saveFiles(space.id, [studyFile("f_cccccccccccc")]);
		const refused = (fn: () => unknown, code: string) =>
			assert.throws(fn, (err: unknown) => err instanceof SpaceDeadlineError && err.code === code);
		refused(() => spaceStore.addDeadline(space.id, { kind: "exam", name: " ", date: "2026-11-05" }), "bad_name");
		refused(() => spaceStore.addDeadline(space.id, { kind: "essay" as never, name: "Quiz", date: "2026-11-05" }), "bad_kind");
		refused(() => spaceStore.addDeadline(space.id, { kind: "quiz", name: "Quiz", date: "11/05/2026" }), "bad_date");
		refused(() => spaceStore.addDeadline(space.id, { kind: "quiz", name: "Quiz", date: "2026-02-30" }), "bad_date");
		refused(() => spaceStore.addDeadline(space.id, { kind: "quiz", name: "Quiz", date: "2026-11-05", time: "24:00" }), "bad_time");
		refused(() => spaceStore.addDeadline(space.id, { kind: "quiz", name: "Quiz", date: "2026-11-05", time: "9:00" }), "bad_time");
		refused(() => spaceStore.addDeadline(space.id, { kind: "quiz", name: "Quiz", date: "2026-11-05", fileIds: ["f_notmine00000"] }), "unknown_file");
		refused(() => spaceStore.updateDeadline(space.id, "ddl_missing", { name: "x" }), "deadline_not_found");
		assert.throws(() => spaceStore.addDeadline("cls_nope_1", { kind: "quiz", name: "Quiz", date: "2026-11-05" }), /Space not found/);
		assert.equal(spaceStore.getSpace(space.id)?.deadlines, undefined, "nothing was written");
		const ok = spaceStore.addDeadline(space.id, { kind: "quiz", name: "Quiz", date: "2026-11-05" });
		refused(() => spaceStore.updateDeadline(space.id, ok.id, { time: "12:60" }), "bad_time");
		refused(() => spaceStore.updateDeadline(space.id, ok.id, { kind: "lab" as never }), "bad_kind");
	});

	it("drops a removed file from the deadlines that covered it", () => {
		const space = spaceStore.createSpace({ name: "PHYS 2B" });
		spaceStore.saveFiles(space.id, [studyFile("f_dddddddddddd"), studyFile("f_eeeeeeeeeeee")]);
		spaceStore.addDeadline(space.id, { kind: "exam", name: "Midterm", date: "2026-11-01", fileIds: ["f_dddddddddddd", "f_eeeeeeeeeeee"] });
		spaceStore.saveFiles(space.id, [studyFile("f_eeeeeeeeeeee")]);
		assert.deepEqual(spaceStore.getSpace(space.id)?.deadlines?.[0]?.fileIds, ["f_eeeeeeeeeeee"]);
	});

	it("reads a version-2 record's exams as deadlines, and writes them back as v10", () => {
		const space = spaceStore.createSpace({ name: "Upgraded" });
		spaceStore.saveFiles(space.id, [studyFile("f_ffffffffffff")]);
		const raw = JSON.parse(fs.readFileSync(spaceFile(space.id), "utf-8"));
		fs.writeFileSync(
			spaceFile(space.id),
			JSON.stringify({
				...raw,
				version: 2,
				exams: [
					{ id: "exm_222222222222", name: "Final", date: "2026-12-10", fileIds: ["f_ffffffffffff", "f_gone00000000"] },
					{ id: "exm_111111111111", name: "Midterm 1", date: "2026-11-05", fileIds: [] },
				],
			}),
		);
		const read = spaceStore.getSpace(space.id);
		assert.ok(read);
		assert.equal(read.version, 2);
		assert.deepEqual(read.deadlines, [
			{ id: "exm_111111111111", kind: "exam", name: "Midterm 1", date: "2026-11-05", fileIds: [], done: false },
			{ id: "exm_222222222222", kind: "exam", name: "Final", date: "2026-12-10", fileIds: ["f_ffffffffffff"], done: false },
		]);
		spaceStore.updateDeadline(space.id, "exm_111111111111", { done: true });
		const onDisk = JSON.parse(fs.readFileSync(spaceFile(space.id), "utf-8"));
		assert.equal(onDisk.version, 10);
		assert.equal(onDisk.exams, undefined, "the old field is gone");
		assert.deepEqual(
			onDisk.deadlines.map((d: { id: string; kind: string; done: boolean }) => [d.id, d.kind, d.done]),
			[
				["exm_111111111111", "exam", true],
				["exm_222222222222", "exam", false],
			],
		);
	});

	it("reads a version-1 record without deadlines", () => {
		const space = spaceStore.createSpace({ name: "Legacy" });
		const raw = JSON.parse(fs.readFileSync(spaceFile(space.id), "utf-8"));
		fs.writeFileSync(spaceFile(space.id), JSON.stringify({ ...raw, version: 1 }));
		const read = spaceStore.getSpace(space.id);
		assert.ok(read);
		assert.equal(read.deadlines, undefined);
		assert.equal(read.version, 1);
	});

	it("keeps a signature and a note; null clears the signature; a bad one on disk reads as none", () => {
		const space = spaceStore.createSpace({ name: "CSE 29", signature: { kind: "code", value: "int *p = &x;" } });
		assert.deepEqual(space.signature, { kind: "code", value: "int *p = &x;" });
		const noted = spaceStore.updateSpace(space.id, { note: { text: "Pointers are clicking.", at: "2026-10-28T10:00:00.000Z" } });
		assert.equal(noted.updatedAt, space.updatedAt, "a new note alone doesn't reorder the space list");
		const read = spaceStore.getSpace(space.id);
		assert.deepEqual(read?.note, { text: "Pointers are clicking.", at: "2026-10-28T10:00:00.000Z" });
		const listed = spaceStore.listSpaces().find((c) => c.id === space.id);
		assert.deepEqual(listed?.signature, { kind: "code", value: "int *p = &x;" });
		assert.equal(listed?.note?.text, "Pointers are clicking.");
		assert.equal(spaceStore.updateSpace(space.id, { signature: null }).signature, undefined);
		const raw = JSON.parse(fs.readFileSync(spaceFile(space.id), "utf-8"));
		fs.writeFileSync(spaceFile(space.id), JSON.stringify({ ...raw, signature: { kind: "poem", value: "x" } }));
		assert.equal(spaceStore.getSpace(space.id)?.signature, undefined);
	});

	it("keeps a subject icon; an unknown one on disk reads as none", () => {
		const space = spaceStore.createSpace({ name: "BILD 1", icon: "dna" });
		assert.equal(space.icon, "dna");
		assert.equal(spaceStore.listSpaces().find((c) => c.id === space.id)?.icon, "dna");
		assert.equal(spaceStore.updateSpace(space.id, { icon: "brain" }).icon, "brain");
		const raw = JSON.parse(fs.readFileSync(spaceFile(space.id), "utf-8"));
		fs.writeFileSync(spaceFile(space.id), JSON.stringify({ ...raw, icon: "rocket" }));
		assert.equal(spaceStore.getSpace(space.id)?.icon, undefined);
	});

	it("gives each new space the color the fewest spaces wear, and keeps a picked one", () => {
		// Every record on disk counts, also one this build can't read.
		const dir = path.join(TMP_DATA, "spaces");
		const before = fs.readdirSync(dir).map((id) => JSON.parse(fs.readFileSync(spaceFile(id), "utf-8")).color);
		const space = spaceStore.createSpace({ name: "PHYS 2A" });
		assert.equal(space.color, nextSpaceColor(before));
		assert.equal(spaceStore.listSpaces().find((c) => c.id === space.id)?.color, space.color);
		assert.equal(spaceStore.updateSpace(space.id, { color: 8 }).color, 8);
		assert.equal(spaceStore.getSpace(space.id)?.color, 8);
	});

	it("a space saved before colors takes one on its first read and keeps it", () => {
		const space = spaceStore.createSpace({ name: "Old" });
		const { color: _color, ...raw } = JSON.parse(fs.readFileSync(spaceFile(space.id), "utf-8"));
		fs.writeFileSync(spaceFile(space.id), JSON.stringify({ ...raw, version: 7 }));
		const read = spaceStore.getSpace(space.id);
		assert.ok(read && isSpaceColor(read.color));
		assert.equal(read.version, 10);
		const onDisk = JSON.parse(fs.readFileSync(spaceFile(space.id), "utf-8"));
		assert.equal(onDisk.color, read.color);
		assert.equal(onDisk.version, 10);
		spaceStore.createSpace({ name: "Newer" });
		assert.equal(spaceStore.getSpace(space.id)?.color, read.color);
	});

	it("picks the least used space color, lowest number first", () => {
		assert.equal(nextSpaceColor([]), 1);
		assert.equal(nextSpaceColor([1, 2, 4]), 3);
		assert.equal(nextSpaceColor([1, 2, 3, 4, 5, 6, 7, 8, 1, 2]), 3);
		assert.equal(isSpaceColor(0), false);
		assert.equal(isSpaceColor(9), false);
		assert.equal(isSpaceColor(2.5), false);
		assert.equal(isSpaceColor("3"), false);
	});

	it("cleans a signature: one line, trimmed, a known kind, at most 60 characters", () => {
		assert.deepEqual(cleanSignature({ kind: "math", value: "  e^{i\\pi}\n+ 1 = 0 " }), { kind: "math", value: "e^{i\\pi} + 1 = 0" });
		assert.equal(cleanSignature({ kind: "poem", value: "x" }), null);
		assert.equal(cleanSignature({ kind: "text", value: "   " }), null);
		assert.equal(cleanSignature({ kind: "text", value: "x".repeat(61) }), null);
		assert.equal(cleanSignature({ kind: "text" }), null);
	});

	it("knows a calendar date and a clock time", () => {
		assert.equal(isCalendarDate("2028-02-29"), true);
		assert.equal(isCalendarDate("2027-02-29"), false);
		assert.equal(isCalendarDate("2026-1-05"), false);
		assert.equal(isCalendarDate(20261105), false);
		assert.equal(isClockTime("00:00"), true);
		assert.equal(isClockTime("23:59"), true);
		assert.equal(isClockTime("24:00"), false);
		assert.equal(isClockTime("12:60"), false);
		assert.equal(isClockTime("7:05"), false);
		assert.equal(isClockTime("07:05:00"), false);
		assert.equal(isClockTime(705), false);
	});
});

describe("one graph per space", () => {
	it("keeps space graphs and the No-space graph apart", () => {
		const a = spaceStore.createSpace({ name: "A" });
		const b = spaceStore.createSpace({ name: "B" });
		graphStoreFor(a.id).appendNode(node("n_a", "chat_a"));
		graphStoreFor(b.id).appendNode(node("n_b", "chat_b"));
		graphStoreFor(null).appendNode(node("n_none", "chat_none"));
		assert.deepEqual(graphStoreFor(a.id).readNodes().map((n) => n.id), ["n_a"]);
		assert.deepEqual(graphStoreFor(b.id).readNodes().map((n) => n.id), ["n_b"]);
		assert.deepEqual(graphStoreFor(null).readNodes().map((n) => n.id), ["n_none"]);
		assert.ok(fs.existsSync(path.join(TMP_DATA, "spaces", a.id, "graph", "format.json")), "each space graph carries its own format stamp");
	});

	it("routes a lesson to its space graph; absent spaceId = No space", () => {
		const space = spaceStore.createSpace({ name: "C" });
		const inSpace = chatStore.createChat("lesson", undefined, space.id);
		const loose = chatStore.createChat("loose lesson");
		assert.equal(inSpace.spaceId, space.id);
		assert.equal("spaceId" in loose, false);
		assert.equal(graphStoreForChat(inSpace.id), graphStoreFor(space.id));
		assert.equal(graphStoreForChat(loose.id), graphStoreFor(null));
		assert.equal(chatStore.listChats().find((c) => c.id === inSpace.id)?.spaceId, space.id);
		const moved = chatStore.setChatSpace(inSpace.id, null);
		assert.equal("spaceId" in moved, false);
		assert.equal(moved.updatedAt, inSpace.updatedAt, "a space move is not conversation activity");
	});

	it("lists every scope: No space first, then the spaces", () => {
		const scopes = allGraphScopes();
		assert.deepEqual(scopes[0], { scope: null, name: "No space" });
		assert.ok(scopes.length > 1);
	});
});

describe("deleteSourceTraces", () => {
	it("removes one source's facts and record; shared facts survive with identity", () => {
		const space = spaceStore.createSpace({ name: "D" });
		const store = graphStoreFor(space.id);
		store.upsertSource({ id: "src_file1", filePath: "notes.md", importedAt: "2026-10-26T00:00:00.000Z" });
		store.appendNode(node("n_only", "src_file1"));
		store.appendNode(node("n_shared", "src_file1", { aliases: ["file phrasing"] }));
		store.appendNode({ ...node("n_shared", "chat_lesson"), aliases: ["lesson phrasing"] });
		store.appendChain({
			id: "arg_x",
			premises: ["n_only"],
			conclusion: "n_shared",
			provenance: [{ chatId: "src_file1", messageId: "" }],
			createdAt: "2026-10-26T00:00:00.000Z",
		});
		const stats = deleteSourceTraces(store, "src_file1");
		assert.equal(stats.nodesRemoved, 1);
		assert.equal(stats.chainsRemoved, 1);
		const graph = getGraph(store);
		assert.deepEqual(graph.nodes.map((n) => n.id), ["n_shared"]);
		assert.ok(graph.nodes[0]!.aliases.includes("lesson phrasing"));
		assert.ok(!graph.nodes[0]!.aliases.includes("file phrasing"), "the file's phrasings die with it");
		assert.deepEqual(store.readSources(), []);
		assert.deepEqual(deleteSourceTraces(store, "src_file1"), { nodesRemoved: 0, chainsRemoved: 0, coverageRemoved: 0, checkpointsRemoved: 0 });
	});

	it("refuses a non-source id", () => {
		assert.throws(() => deleteSourceTraces(graphStoreFor(null), "chat_x"));
	});
});

describe("space contract helpers", () => {
	it("parses wire space scopes", () => {
		assert.equal(parseSpaceScope(undefined), null);
		assert.equal(parseSpaceScope("none"), null);
		assert.equal(parseSpaceScope("cls_abc_123"), "cls_abc_123");
		assert.equal(parseSpaceScope("../x"), undefined);
	});

	it("knows the supported file types", () => {
		assert.equal(extensionOf("Lecture 3.PDF"), ".pdf");
		assert.equal(extensionOf("dir.v2/README"), "");
		assert.equal(extensionOf("SUMMARY - cse29.site, Piazza feed (captured 2026-10-31)"), "", "a dot inside a name is no extension");
		assert.equal(isSupportedSpaceFile("week1.vtt"), true);
		assert.equal(isSupportedSpaceFile("talk.m4a"), true);
		assert.equal(isSupportedSpaceFile("shell.c"), true);
		assert.equal(isSupportedSpaceFile("Week 3.DOCX"), true);
		assert.equal(isSupportedSpaceFile("Lecture 9.pptx"), true);
		assert.equal(isSupportedSpaceFile("photo.png"), false);
		assert.equal(isSupportedSpaceFile("Plan.gdoc"), false);
	});
});

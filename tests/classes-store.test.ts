/**
 * CLASSES WAVE PINS (owner-approved 2026-10-26), Phase 1 — storage:
 *  - the ClassStore record lifecycle (create, list, update, files, delete)
 *  - honest refusal of a newer-stamped class record
 *  - one graph family PER CLASS: a class graph never sees the "No class"
 *    graph's lines and vice versa (owner ruling: separate graph per class)
 *  - lessons carry an optional classId (absent = "No class")
 *  - deleteSourceTraces: a class file's facts die, shared facts survive
 * Runs under an isolated LH_DATA_DIR (set before any config-loading import).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { classStore } = await import("../src/store/classes.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { graphStoreFor, graphStoreForChat, allGraphScopes } = await import("../src/server/stores.ts");
const { deleteSourceTraces } = await import("../src/core/graph-deletion.ts");
const { getGraph } = await import("../src/core/graph.ts");
const { parseClassScope, isSupportedClassFile, extensionOf, isCalendarDate, isClockTime, ClassDeadlineError, deadlineDueAt, compareDeadlines, cleanSignature } = await import("../src/core/contracts.ts");

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

describe("ClassStore", () => {
	it("creates a class with a clean name, empty files, not archived", () => {
		const cls = classStore.createClass({ name: "  MATH   20C ", description: " Calc III " });
		assert.match(cls.id, /^cls_/);
		assert.equal(cls.name, "MATH 20C");
		assert.equal(cls.description, "Calc III");
		assert.equal(cls.archived, false);
		assert.deepEqual(cls.files, []);
		assert.ok(fs.existsSync(path.join(TMP_DATA, "classes", cls.id, "class.json")));
	});

	it("lists, updates (bumps updatedAt), links and unlinks a folder", async () => {
		const cls = classStore.createClass({ name: "CSE 100" });
		await new Promise((r) => setTimeout(r, 5));
		const updated = classStore.updateClass(cls.id, { description: "Data structures", archived: true, linkedFolder: "/tmp/cse100" });
		assert.equal(updated.archived, true);
		assert.equal(updated.linkedFolder, "/tmp/cse100");
		assert.ok(updated.updatedAt > cls.updatedAt);
		const listed = classStore.listClasses().find((c) => c.id === cls.id);
		assert.equal(listed?.description, "Data structures");
		assert.equal(listed?.fileCount, 0);
		assert.equal(classStore.updateClass(cls.id, { linkedFolder: null }).linkedFolder, undefined);
	});

	it("listClassRecords gives the full records in listClasses order", () => {
		const cls = classStore.createClass({ name: "CSE 12" });
		classStore.addDeadline(cls.id, { kind: "exam", name: "Midterm", date: "2026-11-05" });
		const records = classStore.listClassRecords();
		assert.deepEqual(records.map((r) => r.id), classStore.listClasses().map((c) => c.id));
		assert.equal(records.find((r) => r.id === cls.id)?.deadlines?.[0]?.name, "Midterm");
	});

	it("class rules are cleaned on save, and an empty list removes them", () => {
		const cls = classStore.createClass({ name: "CSE 30" });
		assert.equal("rules" in cls, false, "no rules, no field");
		const updated = classStore.updateClass(cls.id, { rules: [" Use the textbook's notation ", "", "Use the textbook's notation"] });
		assert.deepEqual(updated.rules, ["Use the textbook's notation"]);
		assert.deepEqual(classStore.getClass(cls.id)?.rules, ["Use the textbook's notation"]);
		assert.equal("rules" in classStore.updateClass(cls.id, { rules: [] }), false);
	});

	it("saveFiles replaces the file list without bumping updatedAt", () => {
		const cls = classStore.createClass({ name: "PHYS 2B" });
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
		const saved = classStore.saveFiles(cls.id, [file]);
		assert.equal(saved.updatedAt, cls.updatedAt);
		assert.deepEqual(classStore.getClass(cls.id)?.files, [file]);
	});

	it("refuses a record stamped newer than this build", () => {
		const cls = classStore.createClass({ name: "Future" });
		const file = path.join(TMP_DATA, "classes", cls.id, "class.json");
		const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
		fs.writeFileSync(file, JSON.stringify({ ...raw, version: 99 }));
		assert.equal(classStore.getClass(cls.id), null);
	});

	it("rejects path-unsafe ids and deletes the whole class folder", () => {
		assert.equal(classStore.getClass("../etc"), null, "a path-unsafe id never reaches the fs");
		assert.throws(() => classStore.updateClass("../etc", { name: "x" }));
		const cls = classStore.createClass({ name: "Doomed" });
		assert.equal(classStore.deleteClass(cls.id), true);
		assert.equal(fs.existsSync(path.join(TMP_DATA, "classes", cls.id)), false);
		assert.equal(classStore.deleteClass(cls.id), false);
	});
});

describe("deadlines (plan 2026-10-28; exams before that)", () => {
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
	const classFile = (id: string) => path.join(TMP_DATA, "classes", id, "class.json");

	it("adds, updates, sorts and removes deadlines; stamps version 5", () => {
		const cls = classStore.createClass({ name: "CSE 21" });
		assert.equal(cls.version, 5);
		classStore.saveFiles(cls.id, [studyFile("f_aaaaaaaaaaaa"), studyFile("f_bbbbbbbbbbbb")]);
		const finalExam = classStore.addDeadline(cls.id, {
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
		const midterm = classStore.addDeadline(cls.id, { kind: "exam", name: "Midterm 1", date: "2026-11-05" });
		assert.deepEqual(midterm.fileIds, []);
		assert.equal("time" in midterm, false, "no time, no field");
		assert.deepEqual(classStore.getClass(cls.id)?.deadlines?.map((d) => d.name), ["Midterm 1", "Final"], "soonest first");

		const moved = classStore.updateDeadline(cls.id, midterm.id, { kind: "quiz", date: "2026-12-20", fileIds: ["f_aaaaaaaaaaaa"] });
		assert.equal(moved.name, "Midterm 1");
		assert.equal(moved.kind, "quiz");
		assert.deepEqual(moved.fileIds, ["f_aaaaaaaaaaaa"]);
		assert.deepEqual(classStore.getClass(cls.id)?.deadlines?.map((d) => d.name), ["Final", "Midterm 1"]);

		const onDisk = JSON.parse(fs.readFileSync(classFile(cls.id), "utf-8"));
		assert.equal(onDisk.version, 5);
		assert.equal(onDisk.deadlines.length, 2);
		assert.equal(onDisk.exams, undefined);

		assert.equal(classStore.removeDeadline(cls.id, midterm.id), true);
		assert.equal(classStore.removeDeadline(cls.id, midterm.id), false);
		assert.deepEqual(classStore.getClass(cls.id)?.deadlines?.map((d) => d.id), [finalExam.id]);
	});

	it("sorts by date, then time (none = 23:59), then name", () => {
		const cls = classStore.createClass({ name: "Sorting" });
		classStore.addDeadline(cls.id, { kind: "homework", name: "B no time", date: "2026-11-01" });
		classStore.addDeadline(cls.id, { kind: "homework", name: "A no time", date: "2026-11-01" });
		classStore.addDeadline(cls.id, { kind: "quiz", name: "Z morning", date: "2026-11-01", time: "09:00" });
		classStore.addDeadline(cls.id, { kind: "quiz", name: "Late", date: "2026-11-01", time: "23:59" });
		classStore.addDeadline(cls.id, { kind: "exam", name: "Earlier day", date: "2026-10-31", time: "23:00" });
		assert.deepEqual(
			classStore.getClass(cls.id)?.deadlines?.map((d) => d.name),
			["Earlier day", "Z morning", "A no time", "B no time", "Late"],
		);
		assert.deepEqual(deadlineDueAt({ date: "2026-11-01" }), { date: "2026-11-01", time: "23:59" });
		assert.deepEqual(deadlineDueAt({ date: "2026-11-01", time: "07:30" }), { date: "2026-11-01", time: "07:30" });
		assert.ok(compareDeadlines({ date: "2026-11-01", name: "a" }, { date: "2026-11-01", time: "12:00", name: "b" }) > 0);
	});

	it("done stamps doneAt, undone removes it, time null clears the time", () => {
		const cls = classStore.createClass({ name: "Done" });
		const hw = classStore.addDeadline(cls.id, { kind: "homework", name: "HW 1", date: "2026-11-01", time: "17:00" });
		const done = classStore.updateDeadline(cls.id, hw.id, { done: true });
		assert.equal(done.done, true);
		assert.ok(done.doneAt && !Number.isNaN(Date.parse(done.doneAt)), "doneAt is an ISO time");
		const renamed = classStore.updateDeadline(cls.id, hw.id, { name: "HW 1a" });
		assert.equal(renamed.doneAt, done.doneAt, "other edits keep doneAt");
		const again = classStore.updateDeadline(cls.id, hw.id, { done: true });
		assert.equal(again.doneAt, done.doneAt, "ticking a done one again keeps its time");
		const undone = classStore.updateDeadline(cls.id, hw.id, { done: false });
		assert.equal(undone.done, false);
		assert.equal("doneAt" in undone, false);
		const cleared = classStore.updateDeadline(cls.id, hw.id, { time: null });
		assert.equal("time" in cleared, false);
		const onDisk = JSON.parse(fs.readFileSync(classFile(cls.id), "utf-8"));
		assert.equal(onDisk.deadlines[0].time, undefined);
		assert.equal(onDisk.deadlines[0].doneAt, undefined);
	});

	it("validates kind, name, date, time and files", () => {
		const cls = classStore.createClass({ name: "MATH 20C" });
		classStore.saveFiles(cls.id, [studyFile("f_cccccccccccc")]);
		const refused = (fn: () => unknown, code: string) =>
			assert.throws(fn, (err: unknown) => err instanceof ClassDeadlineError && err.code === code);
		refused(() => classStore.addDeadline(cls.id, { kind: "exam", name: " ", date: "2026-11-05" }), "bad_name");
		refused(() => classStore.addDeadline(cls.id, { kind: "essay" as never, name: "Quiz", date: "2026-11-05" }), "bad_kind");
		refused(() => classStore.addDeadline(cls.id, { kind: "quiz", name: "Quiz", date: "11/05/2026" }), "bad_date");
		refused(() => classStore.addDeadline(cls.id, { kind: "quiz", name: "Quiz", date: "2026-02-30" }), "bad_date");
		refused(() => classStore.addDeadline(cls.id, { kind: "quiz", name: "Quiz", date: "2026-11-05", time: "24:00" }), "bad_time");
		refused(() => classStore.addDeadline(cls.id, { kind: "quiz", name: "Quiz", date: "2026-11-05", time: "9:00" }), "bad_time");
		refused(() => classStore.addDeadline(cls.id, { kind: "quiz", name: "Quiz", date: "2026-11-05", fileIds: ["f_notmine00000"] }), "unknown_file");
		refused(() => classStore.updateDeadline(cls.id, "ddl_missing", { name: "x" }), "deadline_not_found");
		assert.throws(() => classStore.addDeadline("cls_nope_1", { kind: "quiz", name: "Quiz", date: "2026-11-05" }), /Class not found/);
		assert.equal(classStore.getClass(cls.id)?.deadlines, undefined, "nothing was written");
		const ok = classStore.addDeadline(cls.id, { kind: "quiz", name: "Quiz", date: "2026-11-05" });
		refused(() => classStore.updateDeadline(cls.id, ok.id, { time: "12:60" }), "bad_time");
		refused(() => classStore.updateDeadline(cls.id, ok.id, { kind: "lab" as never }), "bad_kind");
	});

	it("drops a removed file from the deadlines that covered it", () => {
		const cls = classStore.createClass({ name: "PHYS 2B" });
		classStore.saveFiles(cls.id, [studyFile("f_dddddddddddd"), studyFile("f_eeeeeeeeeeee")]);
		classStore.addDeadline(cls.id, { kind: "exam", name: "Midterm", date: "2026-11-01", fileIds: ["f_dddddddddddd", "f_eeeeeeeeeeee"] });
		classStore.saveFiles(cls.id, [studyFile("f_eeeeeeeeeeee")]);
		assert.deepEqual(classStore.getClass(cls.id)?.deadlines?.[0]?.fileIds, ["f_eeeeeeeeeeee"]);
	});

	it("reads a version-2 record's exams as deadlines, and writes them back as v5", () => {
		const cls = classStore.createClass({ name: "Upgraded" });
		classStore.saveFiles(cls.id, [studyFile("f_ffffffffffff")]);
		const raw = JSON.parse(fs.readFileSync(classFile(cls.id), "utf-8"));
		fs.writeFileSync(
			classFile(cls.id),
			JSON.stringify({
				...raw,
				version: 2,
				exams: [
					{ id: "exm_222222222222", name: "Final", date: "2026-12-10", fileIds: ["f_ffffffffffff", "f_gone00000000"] },
					{ id: "exm_111111111111", name: "Midterm 1", date: "2026-11-05", fileIds: [] },
				],
			}),
		);
		const read = classStore.getClass(cls.id);
		assert.ok(read);
		assert.equal(read.version, 2);
		assert.deepEqual(read.deadlines, [
			{ id: "exm_111111111111", kind: "exam", name: "Midterm 1", date: "2026-11-05", fileIds: [], done: false },
			{ id: "exm_222222222222", kind: "exam", name: "Final", date: "2026-12-10", fileIds: ["f_ffffffffffff"], done: false },
		]);
		classStore.updateDeadline(cls.id, "exm_111111111111", { done: true });
		const onDisk = JSON.parse(fs.readFileSync(classFile(cls.id), "utf-8"));
		assert.equal(onDisk.version, 5);
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
		const cls = classStore.createClass({ name: "Legacy" });
		const raw = JSON.parse(fs.readFileSync(classFile(cls.id), "utf-8"));
		fs.writeFileSync(classFile(cls.id), JSON.stringify({ ...raw, version: 1 }));
		const read = classStore.getClass(cls.id);
		assert.ok(read);
		assert.equal(read.deadlines, undefined);
		assert.equal(read.version, 1);
	});

	it("keeps a signature and a note; null clears the signature; a bad one on disk reads as none", () => {
		const cls = classStore.createClass({ name: "CSE 29", signature: { kind: "code", value: "int *p = &x;" } });
		assert.deepEqual(cls.signature, { kind: "code", value: "int *p = &x;" });
		const noted = classStore.updateClass(cls.id, { note: { text: "Pointers are clicking.", at: "2026-10-28T10:00:00.000Z" } });
		assert.equal(noted.updatedAt, cls.updatedAt, "a new note alone doesn't reorder the class list");
		const read = classStore.getClass(cls.id);
		assert.deepEqual(read?.note, { text: "Pointers are clicking.", at: "2026-10-28T10:00:00.000Z" });
		const listed = classStore.listClasses().find((c) => c.id === cls.id);
		assert.deepEqual(listed?.signature, { kind: "code", value: "int *p = &x;" });
		assert.equal(listed?.note?.text, "Pointers are clicking.");
		assert.equal(classStore.updateClass(cls.id, { signature: null }).signature, undefined);
		const raw = JSON.parse(fs.readFileSync(classFile(cls.id), "utf-8"));
		fs.writeFileSync(classFile(cls.id), JSON.stringify({ ...raw, signature: { kind: "poem", value: "x" } }));
		assert.equal(classStore.getClass(cls.id)?.signature, undefined);
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

describe("one graph per class", () => {
	it("keeps class graphs and the No-class graph apart", () => {
		const a = classStore.createClass({ name: "A" });
		const b = classStore.createClass({ name: "B" });
		graphStoreFor(a.id).appendNode(node("n_a", "chat_a"));
		graphStoreFor(b.id).appendNode(node("n_b", "chat_b"));
		graphStoreFor(null).appendNode(node("n_none", "chat_none"));
		assert.deepEqual(graphStoreFor(a.id).readNodes().map((n) => n.id), ["n_a"]);
		assert.deepEqual(graphStoreFor(b.id).readNodes().map((n) => n.id), ["n_b"]);
		assert.deepEqual(graphStoreFor(null).readNodes().map((n) => n.id), ["n_none"]);
		assert.ok(fs.existsSync(path.join(TMP_DATA, "classes", a.id, "graph", "format.json")), "each class graph carries its own format stamp");
	});

	it("routes a lesson to its class graph; absent classId = No class", () => {
		const cls = classStore.createClass({ name: "C" });
		const inClass = chatStore.createChat("lesson", undefined, cls.id);
		const loose = chatStore.createChat("loose lesson");
		assert.equal(inClass.classId, cls.id);
		assert.equal("classId" in loose, false);
		assert.equal(graphStoreForChat(inClass.id), graphStoreFor(cls.id));
		assert.equal(graphStoreForChat(loose.id), graphStoreFor(null));
		assert.equal(chatStore.listChats().find((c) => c.id === inClass.id)?.classId, cls.id);
		const moved = chatStore.setChatClass(inClass.id, null);
		assert.equal("classId" in moved, false);
		assert.equal(moved.updatedAt, inClass.updatedAt, "a class move is not conversation activity");
	});

	it("lists every scope: No class first, then the classes", () => {
		const scopes = allGraphScopes();
		assert.deepEqual(scopes[0], { scope: null, name: "No class" });
		assert.ok(scopes.length > 1);
	});
});

describe("deleteSourceTraces", () => {
	it("removes one source's facts and record; shared facts survive with identity", () => {
		const cls = classStore.createClass({ name: "D" });
		const store = graphStoreFor(cls.id);
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

describe("class contract helpers", () => {
	it("parses wire class scopes", () => {
		assert.equal(parseClassScope(undefined), null);
		assert.equal(parseClassScope("none"), null);
		assert.equal(parseClassScope("cls_abc_123"), "cls_abc_123");
		assert.equal(parseClassScope("../x"), undefined);
	});

	it("knows the supported file types", () => {
		assert.equal(extensionOf("Lecture 3.PDF"), ".pdf");
		assert.equal(extensionOf("dir.v2/README"), "");
		assert.equal(isSupportedClassFile("week1.vtt"), true);
		assert.equal(isSupportedClassFile("talk.m4a"), true);
		assert.equal(isSupportedClassFile("photo.png"), false);
	});
});

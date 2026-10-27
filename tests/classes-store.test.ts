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
const { parseClassScope, isSupportedClassFile, extensionOf, isExamDate, ClassExamError } = await import("../src/core/contracts.ts");

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

describe("exams (redesign plan, 2026-10-27)", () => {
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

	it("adds, updates, sorts and removes exams; stamps version 2", () => {
		const cls = classStore.createClass({ name: "CSE 21" });
		assert.equal(cls.version, 2);
		classStore.saveFiles(cls.id, [studyFile("f_aaaaaaaaaaaa"), studyFile("f_bbbbbbbbbbbb")]);
		const finalExam = classStore.addExam(cls.id, { name: "  Final  ", date: "2026-12-10", fileIds: ["f_aaaaaaaaaaaa", "f_bbbbbbbbbbbb"] });
		assert.match(finalExam.id, /^exm_[0-9a-f]{12}$/);
		assert.equal(finalExam.name, "Final", "names are trimmed");
		const midterm = classStore.addExam(cls.id, { name: "Midterm 1", date: "2026-11-05" });
		assert.deepEqual(midterm.fileIds, []);
		assert.deepEqual(classStore.getClass(cls.id)?.exams?.map((e) => e.name), ["Midterm 1", "Final"], "soonest first");

		const moved = classStore.updateExam(cls.id, midterm.id, { date: "2026-12-20", fileIds: ["f_aaaaaaaaaaaa"] });
		assert.equal(moved.name, "Midterm 1");
		assert.deepEqual(moved.fileIds, ["f_aaaaaaaaaaaa"]);
		assert.deepEqual(classStore.getClass(cls.id)?.exams?.map((e) => e.name), ["Final", "Midterm 1"]);

		const onDisk = JSON.parse(fs.readFileSync(path.join(TMP_DATA, "classes", cls.id, "class.json"), "utf-8"));
		assert.equal(onDisk.version, 2);
		assert.equal(onDisk.exams.length, 2);

		assert.equal(classStore.removeExam(cls.id, midterm.id), true);
		assert.equal(classStore.removeExam(cls.id, midterm.id), false);
		assert.deepEqual(classStore.getClass(cls.id)?.exams?.map((e) => e.id), [finalExam.id]);
	});

	it("validates name, date and files", () => {
		const cls = classStore.createClass({ name: "MATH 20C" });
		classStore.saveFiles(cls.id, [studyFile("f_cccccccccccc")]);
		const refused = (fn: () => unknown, code: string) =>
			assert.throws(fn, (err: unknown) => err instanceof ClassExamError && err.code === code);
		refused(() => classStore.addExam(cls.id, { name: " ", date: "2026-11-05" }), "bad_name");
		refused(() => classStore.addExam(cls.id, { name: "Quiz", date: "11/05/2026" }), "bad_date");
		refused(() => classStore.addExam(cls.id, { name: "Quiz", date: "2026-02-30" }), "bad_date");
		refused(() => classStore.addExam(cls.id, { name: "Quiz", date: "2026-11-05", fileIds: ["f_notmine00000"] }), "unknown_file");
		refused(() => classStore.updateExam(cls.id, "exm_missing", { name: "x" }), "exam_not_found");
		assert.throws(() => classStore.addExam("cls_nope_1", { name: "Quiz", date: "2026-11-05" }), /Class not found/);
		assert.equal(classStore.getClass(cls.id)?.exams, undefined, "nothing was written");
	});

	it("drops a removed file from the exams that covered it", () => {
		const cls = classStore.createClass({ name: "PHYS 2B" });
		classStore.saveFiles(cls.id, [studyFile("f_dddddddddddd"), studyFile("f_eeeeeeeeeeee")]);
		classStore.addExam(cls.id, { name: "Midterm", date: "2026-11-01", fileIds: ["f_dddddddddddd", "f_eeeeeeeeeeee"] });
		classStore.saveFiles(cls.id, [studyFile("f_eeeeeeeeeeee")]);
		assert.deepEqual(classStore.getClass(cls.id)?.exams?.[0]?.fileIds, ["f_eeeeeeeeeeee"]);
	});

	it("reads a version-1 record without exams", () => {
		const cls = classStore.createClass({ name: "Legacy" });
		const file = path.join(TMP_DATA, "classes", cls.id, "class.json");
		const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
		fs.writeFileSync(file, JSON.stringify({ ...raw, version: 1 }));
		const read = classStore.getClass(cls.id);
		assert.ok(read);
		assert.equal(read.exams, undefined);
		assert.equal(read.version, 1);
	});

	it("knows a calendar date", () => {
		assert.equal(isExamDate("2028-02-29"), true);
		assert.equal(isExamDate("2027-02-29"), false);
		assert.equal(isExamDate("2026-1-05"), false);
		assert.equal(isExamDate(20261105), false);
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

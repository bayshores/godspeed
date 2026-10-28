/**
 * CLASSES WAVE PINS (owner-approved 2026-10-26), Phase 2-3 — the routes and
 * the file pipeline, end to end against a real temp data dir:
 *  - create / list / edit / archive / delete classes
 *  - course-info files never reach the graph; study files import into the
 *    CLASS'S OWN graph under a class-unique source id
 *  - an edited linked file rebuilds its facts; a removed one loses them
 *  - lessons are created in a class with the class card first; ?class=
 *    narrows the lesson list
 *  - moving a lesson takes its facts out of the old class graph
 *  - deleting a class removes its lessons and folder, never a linked folder
 * The extraction pipeline is stubbed at its importNotes seam (no models).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-routes-"));
const LINKED = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-linked-"));
process.env.LH_DATA_DIR = TMP_DATA;

const server = await import("../src/server/index.ts");
const classesRoute = await import("../src/app/api/classes/route.ts");
const classRoute = await import("../src/app/api/classes/[id]/route.ts");
const filesRoute = await import("../src/app/api/classes/[id]/files/route.ts");
const fileRoute = await import("../src/app/api/classes/[id]/files/[fileId]/route.ts");
const folderRoute = await import("../src/app/api/classes/[id]/folder/route.ts");
const deadlinesRoute = await import("../src/app/api/classes/[id]/deadlines/route.ts");
const deadlineRoute = await import("../src/app/api/classes/[id]/deadlines/[deadlineId]/route.ts");
const openDeadlinesRoute = await import("../src/app/api/deadlines/route.ts");
const chatsRoute = await import("../src/app/api/chats/route.ts");
const moveRoute = await import("../src/app/api/chats/[id]/class/route.ts");
const graphRoute = await import("../src/app/api/graph/route.ts");

const { extraction, stores, graphStoreFor, classIdle } = server;

// The importNotes stub: one node per import, born under the given source.
const imports: { filePath: string; text: string; sourceId?: string }[] = [];
const original = extraction.importNotes;
extraction.importNotes = async (input) => {
	imports.push({ filePath: input.filePath, text: input.text, sourceId: input.sourceId });
	const store = input.graphStore ?? stores.graphStore;
	const id = input.sourceId!;
	store.upsertSource({ id, filePath: input.filePath, importedAt: new Date().toISOString() });
	store.appendNode({
		id: `n_${id.slice(4)}${imports.length}`,
		name: input.text.trim(),
		statement: `${input.text.trim()} holds`,
		aliases: [],
		createdAt: new Date().toISOString(),
		provenance: [{ chatId: id, messageId: "" }],
	});
	return { nodes: 1, chains: 0 };
};

after(() => {
	extraction.importNotes = original;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
	fs.rmSync(LINKED, { recursive: true, force: true });
});

const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const json = (url: string, method: string, body?: unknown) =>
	new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function makeClass(name: string): Promise<string> {
	const res = await classesRoute.POST(json("/api/classes", "POST", { name, description: "Vectors and gradients" }));
	assert.equal(res.status, 201);
	return (await res.json()).class.id;
}

async function upload(classId: string, kind: string, files: [string, string][]) {
	const form = new FormData();
	form.append("kind", kind);
	for (const [name, text] of files) form.append("files", new File([text], name));
	return filesRoute.POST(new Request(`http://localhost/api/classes/${classId}/files`, { method: "POST", body: form }), ctx({ id: classId }));
}

describe("class routes", () => {
	it("creates, lists, edits and archives a class; rejects a nameless one", async () => {
		const id = await makeClass("MATH 20C");
		const bad = await classesRoute.POST(json("/api/classes", "POST", { name: "  " }));
		assert.equal(bad.status, 400);
		const list = await (await classesRoute.GET()).json();
		assert.ok(list.classes.some((c: { id: string }) => c.id === id));
		const put = await classRoute.PUT(json(`/api/classes/${id}`, "PUT", { archived: true, description: "new" }), ctx({ id }));
		const updated = (await put.json()).class;
		assert.equal(updated.archived, true);
		assert.equal(updated.description, "new");
		const missing = await classRoute.GET(json("/api/classes/cls_nope", "GET"), ctx({ id: "cls_nope" }));
		assert.equal(missing.status, 404);
	});
});

describe("deadline routes (plan 2026-10-28; exams before that)", () => {
	it("lists, adds, edits and removes deadlines; refuses bad input", async () => {
		const id = await makeClass("CSE 21");
		const up = await (await upload(id, "study", [["lecture1.md", "Counting"]])).json();
		await classIdle(id);
		const fileId = up.results[0].file.id as string;

		const empty = await (await deadlinesRoute.GET(json(`/api/classes/${id}/deadlines`, "GET"), ctx({ id }))).json();
		assert.deepEqual(empty.deadlines, []);

		const added = await deadlinesRoute.POST(
			json("/x", "POST", { kind: "exam", name: "Midterm 1", date: "2026-11-05", time: "19:00", fileIds: [fileId] }),
			ctx({ id }),
		);
		assert.equal(added.status, 201);
		const deadline = (await added.json()).deadline;
		assert.deepEqual(deadline.fileIds, [fileId]);
		assert.equal(deadline.time, "19:00");
		assert.equal(deadline.done, false);
		assert.match(deadline.id, /^ddl_/);

		const refused = async (body: unknown, code: string) => {
			const res = await deadlinesRoute.POST(json("/x", "POST", body), ctx({ id }));
			assert.equal(res.status, 400);
			assert.equal((await res.json()).code, code);
		};
		await refused({ kind: "exam", name: "Final", date: "Dec 10" }, "bad_date");
		await refused({ kind: "exam", name: "Final", date: "2026-12-10", time: "7pm" }, "bad_time");
		await refused({ kind: "essay", name: "Final", date: "2026-12-10" }, "bad_kind");
		await refused({ name: "Final", date: "2026-12-10" }, "bad_kind");
		await refused({ kind: "exam", name: "Final", date: "2026-12-10", fileIds: ["f_other"] }, "unknown_file");
		await refused({ kind: "exam", date: "2026-12-10" }, "bad_name");

		const put = await deadlineRoute.PUT(json("/x", "PUT", { name: "Midterm", kind: "quiz" }), ctx({ id, deadlineId: deadline.id }));
		const renamed = (await put.json()).deadline;
		assert.equal(renamed.name, "Midterm");
		assert.equal(renamed.kind, "quiz");
		const done = (await (await deadlineRoute.PUT(json("/x", "PUT", { done: true, time: null }), ctx({ id, deadlineId: deadline.id }))).json()).deadline;
		assert.equal(done.done, true);
		assert.equal(typeof done.doneAt, "string");
		assert.equal(done.time, undefined, "time: null clears it");
		const badDone = await deadlineRoute.PUT(json("/x", "PUT", { done: "yes" }), ctx({ id, deadlineId: deadline.id }));
		assert.equal(badDone.status, 400);
		const missing = await deadlineRoute.PUT(json("/x", "PUT", { name: "x" }), ctx({ id, deadlineId: "ddl_nope" }));
		assert.equal(missing.status, 404);
		assert.equal((await missing.json()).code, "deadline_not_found");

		const listed = await (await deadlinesRoute.GET(json("/x", "GET"), ctx({ id }))).json();
		assert.equal(listed.deadlines.length, 1);
		const read = await (await classRoute.GET(json(`/api/classes/${id}`, "GET"), ctx({ id }))).json();
		assert.equal(read.class.deadlines[0].name, "Midterm", "the class record carries its deadlines");

		assert.equal((await deadlineRoute.DELETE(json("/x", "DELETE"), ctx({ id, deadlineId: deadline.id }))).status, 200);
		assert.equal((await deadlineRoute.DELETE(json("/x", "DELETE"), ctx({ id, deadlineId: deadline.id }))).status, 404);
		assert.equal((await deadlinesRoute.GET(json("/x", "GET"), ctx({ id: "cls_nope_x" }))).status, 404);
		assert.equal((await deadlinesRoute.POST(json("/x", "POST", { kind: "exam", name: "x", date: "2026-12-10" }), ctx({ id: "cls_nope_x" }))).status, 404);
	});

	it("GET /api/deadlines: open deadlines of classes not archived, soonest due first", async () => {
		const a = await makeClass("Open A");
		const b = await makeClass("Open B");
		const archived = await makeClass("Archived C");
		const add = async (id: string, body: Record<string, unknown>) =>
			(await (await deadlinesRoute.POST(json("/x", "POST", body), ctx({ id }))).json()).deadline as { id: string };
		await add(a, { kind: "homework", name: "HW 2", date: "2026-11-03" });
		await add(b, { kind: "quiz", name: "Quiz 1", date: "2026-11-03", time: "09:00" });
		await add(a, { kind: "exam", name: "Midterm", date: "2026-11-01", time: "19:00" });
		const done = await add(b, { kind: "project", name: "Done one", date: "2026-10-30" });
		await deadlineRoute.PUT(json("/x", "PUT", { done: true }), ctx({ id: b, deadlineId: done.id }));
		await add(archived, { kind: "exam", name: "Hidden", date: "2026-10-29" });
		await classRoute.PUT(json("/x", "PUT", { archived: true }), ctx({ id: archived }));

		const res = await openDeadlinesRoute.GET();
		assert.equal(res.status, 200);
		const mine = ((await res.json()).deadlines as { classId: string; className: string; name: string; done: boolean }[]).filter((d) =>
			[a, b, archived].includes(d.classId),
		);
		assert.deepEqual(
			mine.map((d) => [d.name, d.className]),
			[
				["Midterm", "Open A"],
				["Quiz 1", "Open B"],
				["HW 2", "Open A"],
			],
		);
		assert.ok(mine.every((d) => d.done === false));
	});
});

describe("the class file pipeline", () => {
	it("course info never becomes facts; study material imports into the class graph", async () => {
		const id = await makeClass("PHYS 2B");
		const before = imports.length;
		const info = await (await upload(id, "info", [["syllabus.md", "Exam 1 is on Nov 3"]])).json();
		assert.equal(info.results[0].ok, true);
		await classIdle(id);
		assert.equal(imports.length, before, "course info is never extracted");
		const study = await (await upload(id, "study", [["coulomb.md", "Coulomb's law"]])).json();
		await classIdle(id);
		assert.equal(imports.length, before + 1);
		const record = stores.classStore.getClass(id)!;
		const studyFile = record.files.find((f) => f.id === study.results[0].file.id)!;
		assert.equal(studyFile.status, "ready");
		assert.match(studyFile.sourceId!, /^src_/);
		assert.equal(record.files.find((f) => f.name === "syllabus.md")!.status, "ready");
		assert.deepEqual(graphStoreFor(id).readNodes().map((n) => n.name), ["Coulomb's law"]);
		assert.equal(graphStoreFor(null).readNodes().length, 0, "the No-class graph is untouched");
		const graph = await (await graphRoute.GET(json(`/api/graph?class=${id}`, "GET"))).json();
		assert.equal(graph.propositions?.length ?? graph.nodes.filter((n: { kind?: string }) => n.kind !== "implication").length, 1);
	});

	it("switching study → info removes the file's facts; unsupported types are refused", async () => {
		const id = await makeClass("CHEM 6A");
		const res = await (await upload(id, "study", [["atoms.md", "Atoms"], ["photo.png", "x"]])).json();
		assert.equal(res.results[1].ok, false);
		await classIdle(id);
		assert.equal(graphStoreFor(id).readNodes().length, 1);
		const fileId = res.results[0].file.id;
		await fileRoute.PUT(json("/x", "PUT", { kind: "info" }), ctx({ id, fileId }));
		await classIdle(id);
		assert.equal(graphStoreFor(id).readNodes().length, 0);
		assert.equal(stores.classStore.getClass(id)!.files[0]!.sourceId, undefined);
		const del = await fileRoute.DELETE(json("/x", "DELETE"), ctx({ id, fileId }));
		assert.equal(del.status, 200);
		assert.equal(stores.classStore.getClass(id)!.files.length, 0);
	});

	it("a linked folder: new files auto-add as study material, edits rebuild, deletions remove facts", async () => {
		const id = await makeClass("CSE 100");
		fs.writeFileSync(path.join(LINKED, "week1.md"), "Binary trees");
		fs.mkdirSync(path.join(LINKED, "node_modules"));
		fs.writeFileSync(path.join(LINKED, "node_modules", "junk.md"), "junk");
		const linked = await folderRoute.PUT(json("/x", "PUT", { path: LINKED }), ctx({ id }));
		assert.equal(linked.status, 200);
		await classIdle(id);
		let record = stores.classStore.getClass(id)!;
		assert.deepEqual(record.files.map((f) => [f.name, f.kind, f.origin, f.status]), [["week1.md", "study", "linked", "ready"]]);
		assert.deepEqual(graphStoreFor(id).readNodes().map((n) => n.name), ["Binary trees"]);

		fs.writeFileSync(path.join(LINKED, "week1.md"), "AVL trees");
		const future = new Date(Date.now() + 5000);
		fs.utimesSync(path.join(LINKED, "week1.md"), future, future);
		server.scanLinkedFolder(id);
		await classIdle(id);
		assert.deepEqual(getNames(id), ["AVL trees"], "the edit rebuilt the file's facts");

		fs.rmSync(path.join(LINKED, "week1.md"));
		server.scanLinkedFolder(id);
		await classIdle(id);
		record = stores.classStore.getClass(id)!;
		assert.equal(record.files.length, 0);
		assert.deepEqual(getNames(id), []);

		const unlinked = await folderRoute.DELETE(json("/x", "DELETE"), ctx({ id }));
		assert.equal((await unlinked.json()).class.linkedFolder, undefined);
		assert.ok(fs.existsSync(LINKED), "the learner's folder is never touched");
	});
});

function getNames(classId: string): string[] {
	return graphStoreFor(classId).readNodes().map((n) => n.name);
}

describe("lessons in classes", () => {
	it("a lesson created in a class opens with the class card; ?class= narrows the list", async () => {
		const id = await makeClass("MATH 18");
		await upload(id, "info", [["syllabus.md", "Grading: 3 exams"]]);
		await classIdle(id);
		const created = await (await chatsRoute.POST(json("/api/chats", "POST", { title: "Eigenvalues", classId: id }))).json();
		const record = stores.chatStore.getChat(created.id)!;
		assert.equal(record.classId, id);
		const card = record.messages[0] as { customType?: string; content: string };
		assert.equal(card.customType, "class-context");
		assert.match(card.content, /^\[Class context\]/);
		assert.match(card.content, /Class: MATH 18/);
		assert.match(card.content, /\[course info\] syllabus\.md — \//);
		const loose = await (await chatsRoute.POST(json("/api/chats", "POST", { title: "Loose" }))).json();
		assert.equal(stores.chatStore.getChat(loose.id)!.messages.length, 0, "No-class lessons carry no card");
		const inClass = await (await chatsRoute.GET(json(`/api/chats?class=${id}`, "GET"))).json();
		assert.deepEqual(inClass.chats.map((c: { id: string }) => c.id), [created.id]);
		const none = await (await chatsRoute.GET(json("/api/chats?class=none", "GET"))).json();
		assert.ok(none.chats.some((c: { id: string }) => c.id === loose.id));
		assert.ok(!none.chats.some((c: { id: string }) => c.id === created.id));
		const bad = await chatsRoute.POST(json("/api/chats", "POST", { title: "x", classId: "cls_missing" }));
		assert.equal(bad.status, 404);
	});

	it("moving a lesson removes its facts from the old graph and swaps the card", async () => {
		const a = await makeClass("A");
		const b = await makeClass("B");
		const created = await (await chatsRoute.POST(json("/api/chats", "POST", { title: "Moving", classId: a }))).json();
		graphStoreFor(a).appendNode({ id: "n_moving", name: "moved fact", statement: "s", aliases: [], createdAt: "2026-10-26T00:00:00.000Z", provenance: [{ chatId: created.id, messageId: "" }] });
		const res = await moveRoute.PUT(json("/x", "PUT", { classId: b }), ctx({ id: created.id }));
		assert.equal(res.status, 200);
		assert.equal(graphStoreFor(a).readNodes().length, 0);
		const record = stores.chatStore.getChat(created.id)!;
		assert.equal(record.classId, b);
		assert.match((record.messages[0] as { content: string }).content, /Class: B/);
		await moveRoute.PUT(json("/x", "PUT", { classId: "none" }), ctx({ id: created.id }));
		const loose = stores.chatStore.getChat(created.id)!;
		assert.equal(loose.classId, undefined);
		assert.equal(loose.messages.some((m) => (m as { customType?: string }).customType === "class-context"), false);
	});

	it("deleting a class removes its lessons and folder", async () => {
		const id = await makeClass("Doomed");
		const lesson = await (await chatsRoute.POST(json("/api/chats", "POST", { title: "Gone", classId: id }))).json();
		const res = await classRoute.DELETE(json("/x", "DELETE"), ctx({ id }));
		assert.equal(res.status, 200);
		assert.equal((await res.json()).lessonsRemoved, 1);
		assert.equal(stores.chatStore.getChat(lesson.id), null);
		assert.equal(fs.existsSync(path.join(TMP_DATA, "classes", id)), false);
	});
});

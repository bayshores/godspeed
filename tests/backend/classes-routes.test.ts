/**
 * CLASSES PINS — the routes and
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
import { syncBuiltinESMExports } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it, mock } from "node:test";
import { FILE_NOT_FOUND, MAX_LINKED_FILES } from "../../src/shared/core/contracts.ts";
import { subscribe } from "../../src/shared/core/events.ts";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-routes-"));
const LINKED = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-linked-"));
process.env.LH_DATA_DIR = TMP_DATA;

const server = await import("../../src/backend/server/index.ts");
const classesRoute = await import("../../src/app/api/classes/route.ts");
const classRoute = await import("../../src/app/api/classes/[id]/route.ts");
const filesRoute = await import("../../src/app/api/classes/[id]/files/route.ts");
const fileRoute = await import("../../src/app/api/classes/[id]/files/[fileId]/route.ts");
const folderRoute = await import("../../src/app/api/classes/[id]/folder/route.ts");
const deadlinesRoute = await import("../../src/app/api/classes/[id]/deadlines/route.ts");
const deadlineRoute = await import("../../src/app/api/classes/[id]/deadlines/[deadlineId]/route.ts");
const openDeadlinesRoute = await import("../../src/app/api/deadlines/route.ts");
const chatsRoute = await import("../../src/app/api/chats/route.ts");
const moveRoute = await import("../../src/app/api/chats/[id]/class/route.ts");
const graphRoute = await import("../../src/app/api/graph/route.ts");
const settingsRoute = await import("../../src/app/api/settings/[section]/route.ts");
const mcp = await import("../../src/backend/server/mcp.ts");
const { ensureMcpToken } = await import("../../src/backend/store/mcp-token.ts");

const { extraction, stores, graphStoreFor, classIdle } = server;

// The importNotes stub: one node per import, born under the given source.
// Text starting "Announcement" reads as course info when sorting is allowed.
// `duringRead` runs once inside the next read (the learner acting meanwhile).
const imports: { filePath: string; text: string; sourceId?: string; mayBeCourseInfo?: boolean }[] = [];
let duringRead: (() => Promise<unknown>) | undefined;
const original = extraction.importNotes;
extraction.importNotes = async (input) => {
	imports.push({ filePath: input.filePath, text: input.text, sourceId: input.sourceId, mayBeCourseInfo: input.mayBeCourseInfo });
	const meanwhile = duringRead;
	duringRead = undefined;
	await meanwhile?.();
	const store = input.graphStore ?? stores.graphStore;
	const id = input.sourceId!;
	store.upsertSource({ id, filePath: input.filePath, importedAt: new Date().toISOString() });
	if (input.mayBeCourseInfo && input.text.startsWith("Announcement")) return { nodes: 0, chains: 0, courseInfo: true };
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

	it("sets, refuses and clears a signature", async () => {
		const id = await makeClass("CSE 21");
		const set = await classRoute.PUT(json(`/api/classes/${id}`, "PUT", { signature: { kind: "math", value: " \\binom{n}{k} " } }), ctx({ id }));
		assert.deepEqual((await set.json()).class.signature, { kind: "math", value: "\\binom{n}{k}" });
		const bad = await classRoute.PUT(json(`/api/classes/${id}`, "PUT", { signature: { kind: "poem", value: "x" } }), ctx({ id }));
		assert.equal(bad.status, 400);
		const cleared = await classRoute.PUT(json(`/api/classes/${id}`, "PUT", { signature: null }), ctx({ id }));
		assert.equal((await cleared.json()).class.signature, undefined);
	});
});

describe("class icon route", () => {
	it("sets a known icon and refuses an unknown one", async () => {
		const id = await makeClass("CSE 29");
		const set = await classRoute.PUT(json(`/api/classes/${id}`, "PUT", { icon: "cpu" }), ctx({ id }));
		assert.equal((await set.json()).class.icon, "cpu");
		const bad = await classRoute.PUT(json(`/api/classes/${id}`, "PUT", { icon: "rocket" }), ctx({ id }));
		assert.equal(bad.status, 400);
	});
});

describe("deadline routes", () => {
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

	it("a study file saved while the graph is off is built once the graph is turned back on", async () => {
		const id = await makeClass("PHYS 2C");
		const put = (enabled: boolean) => settingsRoute.PUT(json("/api/settings/graph", "PUT", { enabled }), ctx({ section: "graph" }));
		try {
			assert.equal((await put(false)).status, 200);
			const up = await (await upload(id, "study", [["optics.md", "Snell's law"]])).json();
			await classIdle(id);
			const fileId = up.results[0].file.id as string;
			assert.equal(stores.classStore.getClass(id)!.files.find((f) => f.id === fileId)!.status, "pending");
			assert.equal((await put(true)).status, 200);
			await classIdle(id);
			assert.equal(stores.classStore.getClass(id)!.files.find((f) => f.id === fileId)!.status, "ready");
			assert.deepEqual(getNames(id), ["Snell's law"]);
		} finally {
			await put(true);
		}
	});

	it("a body that is not a form is a 400", async () => {
		const id = await makeClass("PHYS 2A");
		const res = await filesRoute.POST(json(`/api/classes/${id}/files`, "POST", { kind: "study" }), ctx({ id }));
		assert.equal(res.status, 400);
	});

	it("switching study → info removes the file's facts; unsupported types are refused", async () => {
		const id = await makeClass("CHEM 6A");
		const res = await (await upload(id, "study", [["atoms.md", "Atoms"], ["photo.png", "x"]])).json();
		assert.equal(res.results[1].ok, false);
		await classIdle(id);
		assert.equal(graphStoreFor(id).readNodes().length, 1);
		const fileId = res.results[0].file.id;
		const switched = await fileRoute.PUT(json("/x", "PUT", { kind: "info" }), ctx({ id, fileId }));
		const { file: switchedFile } = await switched.json();
		assert.deepEqual([switchedFile.kind, switchedFile.status, switchedFile.contentFp], ["info", "pending", ""], "the reply shows the file as stored");
		await classIdle(id);
		assert.equal(graphStoreFor(id).readNodes().length, 0);
		assert.equal(stores.classStore.getClass(id)!.files[0]!.sourceId, undefined);
		const del = await fileRoute.DELETE(json("/x", "DELETE"), ctx({ id, fileId }));
		assert.equal(del.status, 200);
		assert.equal(stores.classStore.getClass(id)!.files.length, 0);
	});

	it("text with no extension can be added; a binary file with none can't", async () => {
		const id = await makeClass("CSE 29");
		const res = await (await upload(id, "info", [["SUMMARY - cse29.site, Piazza feed (captured 2026-10-31)", "Test 2 moved"], ["blob", "a\u0000b"]])).json();
		assert.deepEqual(res.results.map((r: { ok: boolean }) => r.ok), [true, false]);
		await classIdle(id);
		assert.deepEqual(stores.classStore.getClass(id)!.files.map((f) => [f.name, f.status]), [["SUMMARY - cse29.site, Piazza feed (captured 2026-10-31)", "ready"]]);
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
		assert.deepEqual(getNames(id), ["Binary trees"], "an edit waits until it holds still");
		await scanSettled(id);
		await classIdle(id);
		assert.deepEqual(getNames(id), ["AVL trees"], "the edit rebuilt the file's facts");

		fs.rmSync(path.join(LINKED, "week1.md"));
		fs.writeFileSync(path.join(LINKED, "keep.md"), "Heaps");
		await scanSettled(id);
		await classIdle(id);
		fs.rmSync(path.join(LINKED, "keep.md"));
		record = stores.classStore.getClass(id)!;
		assert.deepEqual(record.files.map((f) => f.name), ["keep.md"]);
		assert.deepEqual(getNames(id), ["Heaps"]);

		const unlinked = await folderRoute.DELETE(json("/x", "DELETE"), ctx({ id }));
		assert.equal((await unlinked.json()).class.linkedFolder, undefined);
		assert.ok(fs.existsSync(LINKED), "the learner's folder is never touched");
	});

	it("a file removed during its first import leaves no facts behind", async () => {
		const id = await makeClass("CSE 110");
		const stub = extraction.importNotes;
		let entered!: () => void;
		let release!: () => void;
		const started = new Promise<void>((r) => (entered = r));
		const gate = new Promise<void>((r) => (release = r));
		extraction.importNotes = async (input) => {
			entered();
			await gate;
			return stub(input);
		};
		try {
			const up = await (await upload(id, "study", [["draft.md", "Sorting"]])).json();
			await started;
			const del = await fileRoute.DELETE(json("/x", "DELETE"), ctx({ id, fileId: up.results[0].file.id }));
			assert.equal(del.status, 200);
			release();
			await classIdle(id);
		} finally {
			extraction.importNotes = stub;
		}
		assert.equal(stores.classStore.getClass(id)!.files.length, 0);
		assert.deepEqual(getNames(id), [], "the facts it merged went with it");
	});

	it("a linked folder past the file cap keeps the files the walk no longer reaches", async () => {
		const id = await makeClass("CSE 120");
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-capped-"));
		try {
			for (let i = 1; i <= MAX_LINKED_FILES; i++) fs.writeFileSync(path.join(dir, `${String(i).padStart(3, "0")}.md`), `Topic ${i}`);
			await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
			await classIdle(id);
			fs.writeFileSync(path.join(dir, "000.md"), "Syllabus");
			server.scanLinkedFolder(id);
			await classIdle(id);
			const last = `${MAX_LINKED_FILES}.md`;
			assert.ok(stores.classStore.getClass(id)!.files.some((f) => f.path === last), "the file past the cap stays");
			assert.ok(getNames(id).includes(`Topic ${MAX_LINKED_FILES}`), "and so do its facts");
			fs.rmSync(path.join(dir, last));
			await scanSettled(id);
			await classIdle(id);
			assert.ok(!getNames(id).includes(`Topic ${MAX_LINKED_FILES}`), "a file really deleted still loses its facts");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("unlinking a class with no folder is refused and changes nothing", async () => {
		const id = await makeClass("CSE 30");
		const before = stores.classStore.getClass(id)!.updatedAt;
		const res = await folderRoute.DELETE(json("/x", "DELETE"), ctx({ id }));
		assert.equal(res.status, 400);
		assert.equal((await res.json()).code, "no_folder");
		assert.equal(stores.classStore.getClass(id)!.updatedAt, before);
	});

	it("linking a folder to an archived class is refused and changes nothing", async () => {
		const id = await makeClass("CSE 31");
		await classRoute.PUT(json("/x", "PUT", { archived: true }), ctx({ id }));
		const before = stores.classStore.getClass(id)!.updatedAt;
		const res = await folderRoute.PUT(json("/x", "PUT", { path: LINKED }), ctx({ id }));
		assert.equal(res.status, 409);
		assert.equal((await res.json()).error, "This class is archived. Unarchive it first, then link the folder.");
		const record = stores.classStore.getClass(id)!;
		assert.equal(record.linkedFolder, undefined);
		assert.equal(record.updatedAt, before);
	});

	it("import_notes under the same name keeps the file id, its deadlines and one copy, and rebuilds its facts", async () => {
		const id = await makeClass("CSE 12");
		const importNotes = async (name: string, text: string) => {
			const req = new Request("http://127.0.0.1:3000/api/mcp", {
				method: "POST",
				headers: { host: "127.0.0.1:3000", "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${ensureMcpToken()}` },
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "import_notes", arguments: { name, text, class_id: id } } }),
			});
			const body = await (await mcp.handleMcpRequest(req)).json();
			return JSON.parse(body.result.content[0].text).fileId as string;
		};
		const fileId = await importNotes("week1/notes.md", "Stacks");
		await classIdle(id);
		await deadlinesRoute.POST(json("/x", "POST", { kind: "exam", name: "Midterm 1", date: "2026-11-10", fileIds: [fileId] }), ctx({ id }));
		assert.equal(await importNotes(" notes.md", "Queues"), fileId);
		await classIdle(id);
		const record = stores.classStore.getClass(id)!;
		assert.deepEqual(record.files.map((f) => [f.id, f.name, f.status]), [[fileId, "notes.md", "ready"]]);
		assert.deepEqual(record.deadlines?.[0]?.fileIds, [fileId]);
		assert.deepEqual(getNames(id), ["Queues"]);
	});

	it("a missing folder keeps its files and facts; picking the moved folder again keeps matching facts", async () => {
		const id = await makeClass("CSE 21");
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-moved-"));
		const oldDir = path.join(root, "old");
		const newDir = path.join(root, "new");
		try {
			fs.mkdirSync(oldDir);
			fs.writeFileSync(path.join(oldDir, "a.md"), "Graphs");
			fs.writeFileSync(path.join(oldDir, "b.md"), "Trees");
			await folderRoute.PUT(json("/x", "PUT", { path: oldDir }), ctx({ id }));
			await classIdle(id);
			assert.deepEqual(getNames(id).sort(), ["Graphs", "Trees"]);
			const problemOf = async () => (await (await classRoute.GET(json(`/api/classes/${id}?scan=1`, "GET"), ctx({ id }))).json()).folder.problem;
			assert.equal(await problemOf(), null);

			fs.renameSync(oldDir, newDir);
			assert.equal(await problemOf(), "missing");
			assert.equal(stores.classStore.getClass(id)!.files.length, 2, "a missing folder's files stay");
			assert.deepEqual(getNames(id).sort(), ["Graphs", "Trees"], "and so do their facts");

			fs.rmSync(path.join(newDir, "b.md"));
			fs.writeFileSync(path.join(newDir, "c.md"), "Recursion");
			const importsBefore = imports.length;
			const relinked = await folderRoute.PUT(json("/x", "PUT", { path: newDir }), ctx({ id }));
			assert.equal(relinked.status, 200);
			await classIdle(id);
			assert.equal(imports.length, importsBefore + 1, "only the new file is built");
			assert.deepEqual(getNames(id).sort(), ["Graphs", "Recursion"], "a file the new folder lacks loses its facts");
			assert.equal(await problemOf(), null);

			const file = stores.classStore.getClass(id)!.files.find((f) => f.name === "a.md")!;
			const shown = await fileRoute.GET(json("/x", "GET"), ctx({ id, fileId: file.id }));
			assert.equal((await shown.json()).path, path.join(newDir, "a.md"));
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("a linked file not found while its folder was away is built again once the folder is back", async () => {
		const id = await makeClass("CSE 140");
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-unplugged-"));
		const dir = path.join(root, "drive");
		const away = path.join(root, "away");
		try {
			fs.mkdirSync(dir);
			fs.writeFileSync(path.join(dir, "a.md"), "Logic gates");
			await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
			await classIdle(id);
			const fileId = stores.classStore.getClass(id)!.files[0]!.id;
			fs.renameSync(dir, away);
			server.enqueueFile(id, fileId);
			await classIdle(id);
			assert.equal(stores.classStore.getClass(id)!.files[0]!.status, "failed");
			fs.renameSync(away, dir);
			server.scanLinkedFolder(id);
			await classIdle(id);
			assert.equal(stores.classStore.getClass(id)!.files[0]!.status, "ready");
		} finally {
			fs.rmSync(root, { recursive: true, force: true });
		}
	});

	it("a recording processed again with the same bytes is not transcribed again", { skip: process.platform === "win32" }, async () => {
		const id = await makeClass("ECE 35");
		const bin = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-fake-whisper-"));
		const runs = path.join(bin, "runs.txt");
		const oldPath = process.env.PATH;
		fs.writeFileSync(path.join(bin, "ffmpeg"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		fs.writeFileSync(
			path.join(bin, "whisper-cli"),
			`#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "-of" ]; then out="$2"; fi; shift; done\necho run >> "${runs}"\nprintf "Ohm's law" > "$out.txt"\n`,
			{ mode: 0o755 },
		);
		fs.mkdirSync(path.join(TMP_DATA, "models"), { recursive: true });
		fs.writeFileSync(path.join(TMP_DATA, "models", "ggml-base.en.bin"), "model");
		process.env.PATH = `${bin}${path.delimiter}${oldPath ?? ""}`;
		try {
			const up = await (await upload(id, "study", [["lecture.m4a", "audio bytes"]])).json();
			await classIdle(id);
			const fileId = up.results[0].file.id as string;
			assert.equal(stores.classStore.getClass(id)!.files[0]!.status, "ready");
			const retried = await fileRoute.PUT(json("/x", "PUT", { retry: true }), ctx({ id, fileId }));
			assert.equal(retried.status, 200);
			await classIdle(id);
			assert.equal(stores.classStore.getClass(id)!.files[0]!.status, "ready");
			assert.equal(fs.readFileSync(runs, "utf-8").trim().split("\n").length, 1, "whisper ran once");
			assert.deepEqual(getNames(id), ["Ohm's law"]);
		} finally {
			process.env.PATH = oldPath;
			fs.rmSync(bin, { recursive: true, force: true });
		}
	});

	// Root reads any file, and Windows ignores the mode bits.
	const cannotLock = process.platform === "win32" || process.getuid?.() === 0;

	it("an unreadable linked folder keeps its files and facts", { skip: cannotLock }, async () => {
		const id = await makeClass("CSE 101");
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-locked-"));
		try {
			fs.writeFileSync(path.join(dir, "a.md"), "Heaps");
			await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
			await classIdle(id);
			const fileId = stores.classStore.getClass(id)!.files[0]!.id;
			fs.chmodSync(dir, 0o000);
			const res = await classRoute.GET(json(`/api/classes/${id}?scan=1`, "GET"), ctx({ id }));
			assert.equal((await res.json()).folder.problem, "missing");
			await classIdle(id);
			assert.deepEqual(stores.classStore.getClass(id)!.files.map((f) => f.id), [fileId], "the file and its id stay");
			assert.deepEqual(getNames(id), ["Heaps"], "and so do its facts");
		} finally {
			fs.chmodSync(dir, 0o755);
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("an unreadable subfolder keeps its files and facts", { skip: cannotLock }, async () => {
		const id = await makeClass("CSE 103");
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-locked-sub-"));
		const sub = path.join(dir, "week1");
		try {
			fs.mkdirSync(sub);
			fs.writeFileSync(path.join(sub, "a.md"), "Graphs");
			await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
			await classIdle(id);
			const fileId = stores.classStore.getClass(id)!.files[0]!.id;
			fs.chmodSync(sub, 0o000);
			server.scanLinkedFolder(id);
			await classIdle(id);
			assert.deepEqual(stores.classStore.getClass(id)!.files.map((f) => f.id), [fileId], "the file and its id stay");
			assert.deepEqual(getNames(id), ["Graphs"], "and so do its facts");
		} finally {
			fs.chmodSync(sub, 0o755);
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("an unreadable file shows as failed and is not re-queued by the scan", { skip: cannotLock }, async () => {
		const id = await makeClass("CSE 105");
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-unreadable-"));
		const file = path.join(dir, "a.md");
		try {
			fs.writeFileSync(file, "Automata");
			fs.chmodSync(file, 0o000);
			await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
			await classIdle(id);
			const failed = stores.classStore.getClass(id)!.files[0]!;
			assert.equal(failed.status, "failed");
			assert.ok(failed.error, "the error is shown");
			assert.ok(failed.statSig, "the scan can tell the file has not changed");
			let changes = 0;
			const stop = subscribe((e) => {
				if (e.type === "classes-changed") changes++;
			});
			try {
				server.scanLinkedFolder(id);
				await classIdle(id);
			} finally {
				stop();
			}
			assert.equal(changes, 0, "nothing new was queued");
		} finally {
			fs.chmodSync(file, 0o644);
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

let skew = 0;
/** Two scans a minute apart (on a test clock), each waited out: a folder
 *  change counts once it holds still. */
async function scanSettled(classId: string): Promise<void> {
	for (let i = 0; i < 2; i++) {
		skew += 60_000;
		mock.timers.enable({ apis: ["Date"], now: Date.now() + skew });
		try {
			server.scanLinkedFolder(classId);
		} finally {
			mock.timers.reset();
		}
		await classIdle(classId);
	}
}

function getNames(classId: string): string[] {
	return graphStoreFor(classId).readNodes().map((n) => n.name);
}

describe("a linked folder over time (a synced Drive folder)", () => {
	/** A fresh folder for one test, removed after it. */
	const folder = (t: { after: (fn: () => void) => void }) => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-drive-"));
		t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
		return dir;
	};
	const announced = (t: { after: (fn: () => void) => void }) => {
		const events: { classId: string; files: { name: string; kind: string }[] }[] = [];
		t.after(subscribe((e) => {
			if (e.type === "files-added") events.push({ classId: e.classId, files: e.files.map((f) => ({ name: f.name, kind: f.kind })) });
		}));
		return events;
	};

	it("a folder file with a copied file's contents takes its place: id, facts and deadlines kept, the copy deleted", async (t) => {
		const id = await makeClass("CSE 150");
		const dir = folder(t);
		const up = await (await upload(id, "study", [["notes.md", "Stacks"]])).json();
		await classIdle(id);
		const fileId = up.results[0].file.id as string;
		const copied = stores.classStore.getClass(id)!.files[0]!;
		await deadlinesRoute.POST(json("/x", "POST", { kind: "exam", name: "Midterm 1", date: "2026-11-10", fileIds: [fileId] }), ctx({ id }));
		const copyDir = path.join(stores.classStore.filesDir(id), fileId);
		for (const name of fs.readdirSync(copyDir)) fs.chmodSync(path.join(copyDir, name), 0o444);
		fs.mkdirSync(path.join(dir, "week1"));
		fs.writeFileSync(path.join(dir, "week1", "notes final.md"), "Stacks");
		fs.writeFileSync(path.join(dir, "notes again.md"), "Stacks");
		const importsBefore = imports.length;
		await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
		await classIdle(id);
		const record = stores.classStore.getClass(id)!;
		const kept = record.files.find((f) => f.id === fileId)!;
		assert.deepEqual([kept.origin, kept.kind, kept.sourceId, kept.contentFp], ["linked", "study", copied.sourceId, copied.contentFp]);
		assert.equal(kept.path, "notes again.md", "the first folder file with its contents");
		assert.ok(!fs.existsSync(copyDir), "the read-only copy is deleted");
		assert.deepEqual(record.deadlines?.[0]?.fileIds, [fileId]);
		assert.equal(record.files.length, 2, "one copy takes the place of one folder file; the other is its own file");
		assert.equal(imports.length, importsBefore + 1, "only the other one is read");
		assert.equal(record.files.find((f) => f.id !== fileId)!.path, "week1/notes final.md");
	});

	it("new files wait until they hold still, take their series' kind and come in one notice; lock and hidden files are skipped", async (t) => {
		const id = await makeClass("CSE 151");
		const dir = folder(t);
		await upload(id, "info", [["HW1.md", "Homework one"], ["HW2.md", "Homework two"]]);
		fs.writeFileSync(path.join(dir, "Lecture1.md"), "Sets");
		await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
		await classIdle(id);
		const events = announced(t);
		for (const name of ["HW3.md", "Lecture2.md", "Lecture3.md", "~$HW3.md", ".HW4.md"]) fs.writeFileSync(path.join(dir, name), name);

		server.scanLinkedFolder(id);
		await classIdle(id);
		assert.equal(stores.classStore.getClass(id)!.files.length, 3, "a file still being written is not added yet");
		assert.equal(server.folderStatusOf(id).settling, 3, "and is counted as still downloading");
		await scanSettled(id);
		await scanSettled(id);
		const kinds = Object.fromEntries(stores.classStore.getClass(id)!.files.map((f) => [f.name, f.kind]));
		assert.deepEqual(kinds, { "HW1.md": "info", "HW2.md": "info", "Lecture1.md": "study", "HW3.md": "info", "Lecture2.md": "study", "Lecture3.md": "study" });
		assert.deepEqual(events, [{ classId: id, files: [{ name: "HW3.md", kind: "info" }, { name: "Lecture2.md", kind: "study" }, { name: "Lecture3.md", kind: "study" }] }], "one notice, nothing for the first link");
		const record = stores.classStore.getClass(id)!;
		assert.deepEqual(record.files.filter((f) => f.foundByScan).map((f) => f.name), ["HW3.md", "Lecture2.md", "Lecture3.md"], "only files a later scan found count as new");
		assert.equal(stores.classStore.listClasses().find((c) => c.id === id)!.lastFoundAt, record.files.find((f) => f.name === "HW3.md")!.addedAt);
		const status = server.folderStatusOf(id);
		assert.deepEqual([status.problem, status.settling, typeof status.checkedAt], [null, 0, "string"]);
		const activity = (await import("../../src/backend/server/agent-actions.ts")).recentAgentActions().find((a) => a.classId === id)!;
		assert.deepEqual([activity.agent, activity.label, activity.page, activity.target], ["godspeed", `Added 3 files from ${path.basename(dir)}`, "/class/files", null]);
	});

	it("a file renamed or moved to another subfolder keeps its id and facts", async (t) => {
		const id = await makeClass("CSE 152");
		const dir = folder(t);
		fs.mkdirSync(path.join(dir, "week1"));
		fs.mkdirSync(path.join(dir, "week2"));
		fs.writeFileSync(path.join(dir, "week1", "a.md"), "Graphs");
		fs.writeFileSync(path.join(dir, "b.md"), "Trees");
		await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
		await classIdle(id);
		const before = stores.classStore.getClass(id)!.files.find((f) => f.name === "a.md")!;
		const events = announced(t);
		const importsBefore = imports.length;
		fs.renameSync(path.join(dir, "week1", "a.md"), path.join(dir, "week2", "graphs.md"));
		await scanSettled(id);
		const after = stores.classStore.getClass(id)!.files.find((f) => f.id === before.id)!;
		assert.deepEqual([after.path, after.name, after.sourceId], ["week2/graphs.md", "graphs.md", before.sourceId]);
		assert.equal(stores.classStore.getClass(id)!.files.length, 2);
		assert.equal(imports.length, importsBefore, "nothing is read again");
		assert.deepEqual(getNames(id).sort(), ["Graphs", "Trees"]);
		assert.deepEqual(events, [], "a moved file is not new");
	});

	it("the read sorts linked logistics into course info; kinds picked by hand are never sorted again", async (t) => {
		const id = await makeClass("CSE 153");
		const dir = folder(t);
		await upload(id, "study", [["copied.md", "Announcement: copied by hand"]]);
		await classIdle(id);
		fs.writeFileSync(path.join(dir, "digest.md"), "Announcement: office hours moved");
		fs.writeFileSync(path.join(dir, "lecture.md"), "Recursion");
		const importsBefore = imports.length;
		await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
		await classIdle(id);
		const byName = () => Object.fromEntries(stores.classStore.getClass(id)!.files.map((f) => [f.name, f]));
		let files = byName();
		assert.deepEqual([files["digest.md"]!.kind, files["digest.md"]!.sortedAsInfo, files["digest.md"]!.status], ["info", true, "ready"]);
		assert.equal(files["digest.md"]!.sourceId, undefined);
		assert.deepEqual([files["lecture.md"]!.kind, files["lecture.md"]!.sortedAsInfo], ["study", undefined]);
		assert.deepEqual(getNames(id), ["Announcement: copied by hand", "Recursion"], "the digest left no facts; a file added by hand is never sorted");
		assert.deepEqual(imports.slice(importsBefore).map((i) => i.mayBeCourseInfo), [true, true]);
		assert.equal(files["copied.md"]!.kind, "study");

		const back = await fileRoute.PUT(json("/x", "PUT", { kind: "study" }), ctx({ id, fileId: files["digest.md"]!.id }));
		assert.equal(back.status, 200);
		await classIdle(id);
		files = byName();
		assert.deepEqual([files["digest.md"]!.kind, files["digest.md"]!.kindChosen, files["digest.md"]!.sortedAsInfo], ["study", true, undefined]);
		assert.equal(imports.at(-1)!.mayBeCourseInfo, false, "picked by hand: read as study material");
		assert.ok(getNames(id).includes("Announcement: office hours moved"));
	});

	it("a kind picked during the read wins over the sort, and only a first read of notes is sorted", async (t) => {
		const id = await makeClass("CSE 155");
		const dir = folder(t);
		fs.writeFileSync(path.join(dir, "digest.md"), "Announcement: quiz moved");
		fs.writeFileSync(path.join(dir, "Lecture01_2026-09-25.srt"), "1\n00:00:00,000 --> 00:00:02,000\nAnnouncement: no class Friday\n");
		fs.writeFileSync(path.join(dir, "lecture.md"), "Recursion");
		const fileId = (name: string) => stores.classStore.getClass(id)!.files.find((f) => f.name === name)!.id;
		const before = imports.length;
		let picked = false;
		duringRead = async () => {
			// The first read is digest.md (name order): the learner keeps it as study material meanwhile.
			await fileRoute.PUT(json("/x", "PUT", { kind: "study" }), ctx({ id, fileId: fileId("digest.md") }));
			picked = true;
		};
		await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
		await classIdle(id);
		assert.ok(picked);
		const byName = () => Object.fromEntries(stores.classStore.getClass(id)!.files.map((f) => [f.name, f]));
		let files = byName();
		assert.deepEqual([files["digest.md"]!.kind, files["digest.md"]!.kindChosen, files["digest.md"]!.sortedAsInfo, files["digest.md"]!.status], ["study", true, undefined, "ready"]);
		assert.ok(getNames(id).includes("Announcement: quiz moved"), "read again as study material");
		const reads = imports.slice(before).map((i) => [i.filePath, i.mayBeCourseInfo]);
		assert.deepEqual(reads.filter(([name]) => name === "digest.md"), [["digest.md", true], ["digest.md", false]]);
		assert.deepEqual(reads.find(([name]) => name === "Lecture01_2026-09-25.srt"), ["Lecture01_2026-09-25.srt", false], "a transcript is never sorted");
		assert.equal(files["Lecture01_2026-09-25.srt"]!.kind, "study");

		// A changed file is read again, never sorted again.
		fs.writeFileSync(path.join(dir, "lecture.md"), "Announcement: lecture notes rewritten");
		await scanSettled(id);
		files = byName();
		assert.equal(imports.at(-1)!.mayBeCourseInfo, false);
		assert.equal(files["lecture.md"]!.kind, "study");
	});

	it("a recording that is gone never loops, with or without its transcript", async () => {
		const id = await makeClass("CSE 21 gone video");
		// Added as course info, so nothing transcribes it before it goes.
		const up = await (await upload(id, "info", [["CSE21_Lecture_02_2026-09-28.mp4", "video bytes"]])).json();
		await classIdle(id);
		const video = up.results[0].file.id as string;
		const videoFile = () => stores.classStore.getClass(id)!.files.find((f) => f.id === video)!;
		fs.rmSync(path.join(stores.classStore.filesDir(id), video), { recursive: true, force: true });
		server.setFileKind(id, video, "study");
		await classIdle(id);
		assert.deepEqual([videoFile().status, videoFile().error], ["failed", FILE_NOT_FOUND]);
		// A transcript arriving doesn't queue a gone recording (the scan or the learner settles it).
		await upload(id, "study", [["Lecture02_2026-09-28.srt", "1\n00:00:00,000 --> 00:00:02,000\nPermutations\n"]]);
		await classIdle(id);
		assert.deepEqual([videoFile().status, videoFile().error], ["failed", FILE_NOT_FOUND]);
		// Retried, the covered recording needs no file at all.
		server.retryFile(id, video);
		await classIdle(id);
		assert.equal(videoFile().status, "ready");
		assert.ok(videoFile().transcriptId);
	});

	it("a covered recording moved to course info no longer says it uses a transcript", async () => {
		const id = await makeClass("CSE 21 info video");
		const up = await (
			await upload(id, "study", [
				["Lecture03_2026-09-30.srt", "1\n00:00:00,000 --> 00:00:02,000\nCombinations\n"],
				["CSE21_Lecture_03_2026-09-30.mp4", "video bytes"],
			])
		).json();
		await classIdle(id);
		const video = up.results[1].file.id as string;
		assert.ok(stores.classStore.getClass(id)!.files.find((f) => f.id === video)!.transcriptId);
		await fileRoute.PUT(json("/x", "PUT", { kind: "info" }), ctx({ id, fileId: video }));
		await classIdle(id);
		const after = stores.classStore.getClass(id)!.files.find((f) => f.id === video)!;
		assert.deepEqual([after.kind, after.transcriptId], ["info", undefined]);
	});

	it("a folder that turns up empty (Drive starting or signed out) keeps its files and facts", async (t) => {
		const id = await makeClass("CSE 153");
		const dir = folder(t);
		fs.writeFileSync(path.join(dir, "a.md"), "Logic");
		await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
		await classIdle(id);
		fs.renameSync(path.join(dir, "a.md"), path.join(dir, ".a.md"));
		await scanSettled(id);
		assert.equal(stores.classStore.getClass(id)!.files.length, 1);
		assert.deepEqual(getNames(id), ["Logic"]);
		assert.equal(server.folderStatusOf(id).problem, "empty");
		fs.renameSync(path.join(dir, ".a.md"), path.join(dir, "a.md"));
		await scanSettled(id);
		assert.equal(server.folderStatusOf(id).problem, null);
		assert.equal(stores.classStore.getClass(id)!.files[0]!.status, "ready");
	});

	it("a folder that stops answering (Drive paused) keeps its files and facts and says so", async (t) => {
		const id = await makeClass("CSE 154");
		const dir = folder(t);
		fs.writeFileSync(path.join(dir, "a.md"), "Sets");
		await folderRoute.PUT(json("/x", "PUT", { path: dir }), ctx({ id }));
		await classIdle(id);
		const readdir = fs.readdirSync;
		const timedOut = mock.method(fs, "readdirSync", ((p: fs.PathLike, ...rest: unknown[]) => {
			if (String(p) === dir) throw Object.assign(new Error("Operation timed out"), { code: "ETIMEDOUT" });
			return (readdir as (...a: unknown[]) => unknown)(p, ...rest);
		}) as typeof fs.readdirSync);
		syncBuiltinESMExports();
		try {
			await scanSettled(id);
			assert.equal(server.folderStatusOf(id).problem, "not-responding");
			assert.equal(stores.classStore.getClass(id)!.files.length, 1);
			assert.deepEqual(getNames(id), ["Sets"]);
		} finally {
			timedOut.mock.restore();
			syncBuiltinESMExports();
		}
		await scanSettled(id);
		assert.equal(server.folderStatusOf(id).problem, null);
	});

	it("a lecture video whose transcript is there is not transcribed; it is once the transcript goes", async () => {
		const id = await makeClass("CSE 21 videos");
		const up = await (
			await upload(id, "study", [
				["CSE21_Lecture_01_2026-09-25.mp4", "video bytes"],
				["Lecture01_2026-09-25.srt", "1\n00:00:00,000 --> 00:00:02,000\nCounting\n"],
			])
		).json();
		await classIdle(id);
		const [video, srt] = up.results.map((r: { file: { id: string } }) => r.file.id) as [string, string];
		const videoFile = () => stores.classStore.getClass(id)!.files.find((f) => f.id === video)!;
		assert.equal(videoFile().status, "ready");
		assert.equal(videoFile().transcriptId, srt);
		assert.deepEqual(getNames(id), ["Counting"], "facts only from the transcript");
		const del = await fileRoute.DELETE(json("/x", "DELETE"), ctx({ id, fileId: srt }));
		assert.equal(del.status, 200);
		await classIdle(id);
		assert.equal(videoFile().transcriptId, undefined);
		assert.notEqual(videoFile().status, "pending", "queued again and processed");
	});
});

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
		assert.deepEqual(stores.chatStore.getChat(loose.id)!.messages.map((m) => (m as { customType?: string }).customType), ["study-context"], "No-class lessons carry no card, just the study plan");
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

	it("deleting a class also removes a lesson created in it while the delete waited", async () => {
		const id = await makeClass("Doomed too");
		const first = await (await chatsRoute.POST(json("/api/chats", "POST", { title: "First", classId: id }))).json();
		const deleting = server.deleteClass(id);
		const late = server.createLesson({ title: "Late", classId: id });
		assert.equal(late.ok, true);
		const res = await deleting;
		assert.equal(res.ok, true);
		const lateId = late.ok ? late.chat.id : "";
		assert.deepEqual(res.ok ? res.value.lessonIds.sort() : [], [first.id, lateId].sort());
		assert.equal(stores.chatStore.getChat(lateId), null);
	});

	it("deleting a class removes its lessons and folder", async () => {
		const id = await makeClass("Doomed");
		const lesson = await (await chatsRoute.POST(json("/api/chats", "POST", { title: "Gone", classId: id }))).json();
		const folder = fs.mkdtempSync(path.join(os.tmpdir(), "lh-classes-doomed-"));
		try {
			await folderRoute.PUT(json("/x", "PUT", { path: folder }), ctx({ id }));
			assert.notEqual(server.folderStatusOf(id).checkedAt, null);
			const res = await classRoute.DELETE(json("/x", "DELETE"), ctx({ id }));
			assert.equal(res.status, 200);
			assert.deepEqual((await res.json()).lessonIds, [lesson.id]);
			assert.equal(stores.chatStore.getChat(lesson.id), null);
			assert.equal(fs.existsSync(path.join(TMP_DATA, "classes", id)), false);
			assert.equal(fs.existsSync(folder), true, "a linked folder is never touched");
			assert.equal(server.folderStatusOf(id).checkedAt, null, "its folder scan is forgotten");
		} finally {
			fs.rmSync(folder, { recursive: true, force: true });
		}
	});
});

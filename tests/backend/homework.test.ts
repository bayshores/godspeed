/**
 * HOMEWORK SESSIONS: the deadline's assignment file and problems on disk,
 * a homework start from POST /api/chats, the homework tools (post, open,
 * conclude, done marks) and the hints-only prompt.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import type { HomeworkProblem } from "../../src/shared/core/contracts.ts";
import type { HomeworkDeadline } from "../../src/backend/agent/tools/homework.ts";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-homework-"));
process.env.LH_DATA_DIR = TMP_DATA;

const server = await import("../../src/backend/server/index.ts");
const classesRoute = await import("../../src/app/api/classes/route.ts");
const filesRoute = await import("../../src/app/api/classes/[id]/files/route.ts");
const deadlinesRoute = await import("../../src/app/api/classes/[id]/deadlines/route.ts");
const deadlineRoute = await import("../../src/app/api/classes/[id]/deadlines/[deadlineId]/route.ts");
const chatsRoute = await import("../../src/app/api/chats/route.ts");
const { homeworkTools } = await import("../../src/backend/agent/tools/homework.ts");
const { composeInstructions } = await import("../../src/backend/agent/teacher-agent.ts");
const { homeworkDeadline } = await import("../../src/backend/server/homework.ts");
await (await import("../../src/backend/agent/engine-load.ts")).loadAgentCore();

const { stores, updateClassDeadline } = server;

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const json = (url: string, method: string, body?: unknown) =>
	new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function makeClass(): Promise<string> {
	const res = await classesRoute.POST(json("/api/classes", "POST", { name: "CSE 21", description: "Discrete math" }));
	return (await res.json()).class.id;
}

async function addDeadline(id: string, kind: string, name: string): Promise<string> {
	const res = await deadlinesRoute.POST(json("/x", "POST", { kind, name, date: "2026-12-10" }), ctx({ id }));
	return (await res.json()).deadline.id;
}

async function addInfoFile(id: string, name: string): Promise<string> {
	const form = new FormData();
	form.append("kind", "info");
	form.append("files", new File(["1. Prove it."], name));
	const res = await filesRoute.POST(new Request(`http://localhost/api/classes/${id}/files`, { method: "POST", body: form }), ctx({ id }));
	return (await res.json()).results[0].file.id;
}

const PROBLEMS = [
	{ number: "1", title: "Induction", text: "Prove $\\sum i = n(n+1)/2$.", page: 1 },
	{ number: "2", title: "Pigeonhole", text: "Show two of five points…" },
];

describe("the deadline's assignment and problems", () => {
	it("attaches a class file as the assignment, clears it, and refuses an unknown one", async () => {
		const id = await makeClass();
		const hw = await addDeadline(id, "homework", "HW 4");
		const fileId = await addInfoFile(id, "hw4.txt");
		const put = await deadlineRoute.PUT(json("/x", "PUT", { assignmentFileId: fileId }), ctx({ id, deadlineId: hw }));
		assert.equal((await put.json()).deadline.assignmentFileId, fileId);
		const bad = await deadlineRoute.PUT(json("/x", "PUT", { assignmentFileId: "f_nope" }), ctx({ id, deadlineId: hw }));
		assert.equal(bad.status, 400);
		const cleared = await deadlineRoute.PUT(json("/x", "PUT", { assignmentFileId: null }), ctx({ id, deadlineId: hw }));
		assert.equal((await cleared.json()).deadline.assignmentFileId, undefined);
	});

	it("saves problems and refuses duplicate numbers", async () => {
		const id = await makeClass();
		const hw = await addDeadline(id, "homework", "HW 5");
		const deadline = homeworkDeadline(id, hw);
		assert.equal(deadline.post(PROBLEMS), null);
		assert.deepEqual(
			deadline.problems().map((p) => [p.number, p.done]),
			[["1", false], ["2", false]],
		);
		deadline.markDone("2");
		// Posting again keeps the done mark by number.
		assert.equal(deadline.post([...PROBLEMS, { number: "3", title: "Graphs", text: "…" }]), null);
		assert.deepEqual(
			deadline.problems().map((p) => [p.number, p.done]),
			[["1", false], ["2", true], ["3", false]],
		);
		const dup = updateClassDeadline(id, hw, { problems: [PROBLEMS[0]!, PROBLEMS[0]!].map((p) => ({ ...p, done: false })) });
		assert.equal(dup.ok, false);
	});
});

describe("a homework start", () => {
	it("opens a homework session with the class card and the homework note", async () => {
		const id = await makeClass();
		const hw = await addDeadline(id, "homework", "HW 6");
		const res = await chatsRoute.POST(json("/api/chats", "POST", { classId: id, deadlineId: hw, homework: true }));
		assert.equal(res.status, 200);
		const { id: chatId, title } = await res.json();
		assert.equal(title, "Work on HW 6");
		const chat = stores.chatStore.getChat(chatId)!;
		assert.equal(chat.kind, "homework");
		assert.equal(chat.deadlineId, hw);
		assert.deepEqual(
			chat.messages.map((m) => (m as { customType?: string }).customType),
			["class-context", "homework-context"],
		);
		const note = String((chat.messages[1] as { content: unknown }).content);
		assert.match(note, /No assignment file is attached yet/);
		assert.match(note, /post them all with post_problems/);
	});

	it("refuses an exam, a missing deadline and a start with no class", async () => {
		const id = await makeClass();
		const exam = await addDeadline(id, "exam", "Midterm");
		assert.equal((await chatsRoute.POST(json("/api/chats", "POST", { classId: id, deadlineId: exam, homework: true }))).status, 404);
		assert.equal((await chatsRoute.POST(json("/api/chats", "POST", { classId: id, deadlineId: "d_nope", homework: true }))).status, 404);
		assert.equal((await chatsRoute.POST(json("/api/chats", "POST", { deadlineId: exam, homework: true }))).status, 400);
	});
});

/** A deadline kept in memory, for the tools alone. */
function memoryDeadline(): HomeworkDeadline & { list: HomeworkProblem[] } {
	const d = {
		list: [] as HomeworkProblem[],
		problems: () => d.list,
		post: (posted: Omit<HomeworkProblem, "done">[]) => {
			d.list = posted.map((p) => ({ ...p, done: false }));
			return null;
		},
		markDone: (n: string) => {
			d.list = d.list.map((p) => (p.number === n ? { ...p, done: true } : p));
		},
	};
	return d;
}

function tools(deadline: HomeworkDeadline) {
	return homeworkTools({ chatId: "chat_x", chatStore: { getChat: () => null }, homework: deadline });
}

const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? "").join("");

describe("the homework tools", () => {
	it("opens only posted problems, one at a time, and marks solved ones done", async () => {
		const deadline = memoryDeadline();
		const t = tools(deadline);
		const early = await t.problem!.execute("c0", { number: "1", statement: "…" });
		assert.match(text(early), /post_problems first/);
		await t.post_problems!.execute("c1", { problems: PROBLEMS });
		const unknown = await t.problem!.execute("c2", { number: "9", statement: "…" });
		assert.match(text(unknown), /the numbers are 1, 2/);
		const open = await t.problem!.execute("c3", { number: "1", statement: "Prove it." });
		assert.equal(open.terminate, true);
		const second = await t.problem!.execute("c4", { number: "2", statement: "…" });
		assert.match(text(second), /problem 1 is still open/);
		await t.conclude!.execute("c5", { outcome: "solvedWithHints", verdict: "Right." });
		assert.deepEqual(deadline.list.map((p) => p.done), [true, false]);
		await t.problem!.execute("c6", { number: "2", statement: "…" });
		await t.conclude!.execute("c7", { outcome: "movedOn", verdict: "Later." });
		assert.deepEqual(deadline.list.map((p) => p.done), [true, false]);
		const none = await t.conclude!.execute("c8", { outcome: "solved", verdict: "x" });
		assert.match(text(none), /no problem is open/);
	});

	it("marks a part only while a problem is open, without ending the turn", async () => {
		const t = tools(memoryDeadline());
		assert.match(text(await t.part!.execute("p0", { part: "a" })), /no problem is open/);
		await t.post_problems!.execute("p1", { problems: PROBLEMS });
		const opened = await t.problem!.execute("p2", { number: "1", statement: "…" });
		assert.match(text(opened), /work and questions arrive as their messages/);
		const marked = await t.part!.execute("p3", { part: "b" });
		assert.equal(text(marked), "Marked.");
		assert.notEqual((marked as { terminate?: boolean }).terminate, true);
	});

	it("carries no solution field and keeps practice's side tools", () => {
		const t = tools(memoryDeadline());
		assert.ok(!("modelSolution" in (t.problem!.parameters as { properties: object }).properties));
		for (const name of ["post_problems", "problem", "part", "conclude", "read", "ls", "find", "grep"]) assert.ok(t[name], name);
	});
});

describe("the homework prompt", () => {
	it("is the homework base plus practice's hints, never the teaching base", () => {
		const prompt = composeInstructions("homework");
		assert.match(prompt, /## Never the answer/);
		assert.match(prompt, /## Hints/);
		assert.doesNotMatch(prompt, /## The opening — straight to problems/);
	});
});

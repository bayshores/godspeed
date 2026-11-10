/**
 * The Talk chat: one fixed chat outside lessons that every lesson list
 * skips, its rows (messages and the changes the tools made), and its
 * tools, which run the same class actions as the MCP server, record each
 * change for the panel and never delete a class or a file; its short
 * prompt and its own summary shape.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-talk-"));
const originalEnv = process.env;
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	LH_DATA_DIR: path.join(scratch, "data"),
	HOME: path.join(scratch, "home"),
};
fs.mkdirSync(path.join(scratch, "home"), { recursive: true });
after(() => {
	process.env = originalEnv;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const { TALK_CHAT_ID } = await import("../../src/shared/core/contracts.ts");
const { chatStore } = await import("../../src/backend/store/chats.ts");
const { openTalk, clearTalk } = await import("../../src/backend/server/talk.ts");
const { classActions } = await import("../../src/backend/server/class-actions.ts");
const { clearAgentActions, recentAgentActions } = await import("../../src/backend/server/agent-actions.ts");
const { lessonClassChangeTools, talkTools } = await import("../../src/backend/agent/tools/talk.ts");
const { createTeacherTools } = await import("../../src/backend/agent/tools.ts");
const { practiceTools } = await import("../../src/backend/agent/tools/practice.ts");
const { jobStore } = await import("../../src/backend/store/jobs.ts");
const { actionFor, appRequestText, speakerOf, startsTurn, talkRows } = await import("../../src/frontend/components/halley/talk-model.ts");
const { composeInstructions } = await import("../../src/backend/agent/teacher-agent.ts");
const { buildCompactionPrompt } = await import("../../src/shared/core/compaction.ts");
const { lessonStartedLastTurn } = await import("../../src/shared/core/class-tools.ts");
type ClassActions = import("../../src/shared/core/class-tools.ts").ClassActions;
type LhMessage = import("../../src/shared/core/native-messages.ts").LhMessage;

const sent: { chatId: string; text: string }[] = [];
async function sendOk(chatId: string, text: string): Promise<Response> {
	sent.push({ chatId, text });
	return new Response("ok");
}
type AgentAction = import("../../src/shared/core/events.ts").AgentAction;

describe("the Talk chat", () => {
	it("opens one fixed chat, again and again, that no lesson list shows", () => {
		const first = openTalk();
		assert.equal(first.id, TALK_CHAT_ID);
		assert.equal(openTalk().id, TALK_CHAT_ID);
		assert.equal(chatStore.getChat(TALK_CHAT_ID)?.kind, "talk");
		const lesson = chatStore.createChat("A lesson");
		const listed = chatStore.listChats().map((c) => c.id);
		assert.ok(listed.includes(lesson.id));
		assert.ok(!listed.includes(TALK_CHAT_ID));
	});
	it("Clear deletes it, and the next open starts empty", async () => {
		openTalk();
		assert.deepEqual(await clearTalk(), { ok: true });
		assert.equal(chatStore.getChat(TALK_CHAT_ID), null);
		assert.deepEqual(await clearTalk(), { ok: true }, "nothing to clear is fine");
		assert.deepEqual(openTalk().messages, []);
	});
});

describe("the Talk rows", () => {
	it("your messages, the teacher's replies, and one row per change", () => {
		const rows = talkRows([
			{ id: "u1", role: "user", parts: [{ type: "text", text: "Add CSE 21" }] },
			{ id: "g1", role: "user", parts: [{ type: "data-app-request", id: "ar_g1", data: { deadlines: [{ id: "d1", name: "Midterm", className: "CSE 21" }] } }] },
			{
				id: "a1",
				role: "assistant",
				parts: [
					{ type: "tool-create_class", toolCallId: "t1", state: "output-available", input: {}, output: { changes: [{ label: "Creating CSE 21", page: "/class" }, { label: 3 }] } },
					{ type: "tool-list_classes", toolCallId: "t0", state: "output-available", input: {}, output: { changes: [] } },
					{ type: "text", text: "Done, CSE 21 is set up." },
					{ type: "text", text: "  " },
				],
			},
		] as never);
		assert.deepEqual(
			rows.map((r) => [r.kind, r.kind === "change" ? r.change.label : r.kind === "app" ? r.deadlines[0]!.name : r.text]),
			[
				["you", "Add CSE 21"],
				["app", "Midterm"],
				["change", "Creating CSE 21"],
				["teacher", "Done, CSE 21 is set up."],
			],
		);
	});
	it("your message's pictures and PDFs ride its row, even with no text", () => {
		const rows = talkRows([
			{
				id: "u1",
				role: "user",
				parts: [
					{ type: "text", text: "Here is the syllabus" },
					{ type: "data-image", id: "u1-a1", data: { base64: "QUJD", mimeType: "image/png" } },
					{ type: "data-pdf", id: "u1-a2", data: { name: "syllabus.pdf", path: "/x/syllabus.pdf" } },
				],
			},
			{ id: "u2", role: "user", parts: [{ type: "data-image", id: "u2-a0", data: { base64: "REVG", mimeType: "image/png" } }] },
		] as never);
		assert.deepEqual(
			rows.map((r) => (r.kind === "you" ? [r.text, r.files.map((f) => f.type)] : r.kind)),
			[
				["Here is the syllabus", ["data-image", "data-pdf"]],
				["", ["data-image"]],
			],
		);
	});
	it("godspeed's own requests are their own speaker, and say what was asked", () => {
		const rows = talkRows([
			{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
			{ id: "g1", role: "user", parts: [{ type: "data-app-request", id: "ar_g1", data: { deadlines: [] } }] },
			{ id: "a1", role: "assistant", parts: [{ type: "text", text: "On it." }] },
		] as never);
		assert.deepEqual(rows.map(speakerOf), ["you", "app", "teacher"]);
		assert.deepEqual(rows.map((_, i) => startsTurn(rows, i)), [true, true, true]);
		const one = [{ id: "d1", name: "Midterm", className: "CSE 21" }];
		assert.equal(appRequestText("Marco", one), "Asked Marco to work out what's on Midterm (CSE 21) from your files.");
		const three = [...one, { id: "d2", name: "HW 5", className: "CSE 21" }, { id: "d3", name: "Final", className: "CSE 29" }];
		assert.equal(appRequestText("Marco", three), "Asked Marco to work out what's on Midterm (CSE 21), HW 5 (CSE 21) and Final (CSE 29) from your files.");
	});
	it("a change row opens its recorded action while it is still recent", () => {
		const action: AgentAction = { id: "x", at: "2026-11-01T10:00:00.000Z", agent: "Claude Code", label: "Creating CSE 21", classId: "c", target: null, page: "/class" };
		assert.equal(actionFor({ label: "Creating CSE 21", page: "/class" }, [action]), action);
		assert.equal(actionFor({ label: "Creating CSE 21", page: "/class" }, []), null);
	});
});

describe("class changes in a lesson", () => {
	const actions = () => classActions("Claude Code", sendOk, { openStarted: true });
	it("a lesson takes only the deadline changes and the class list", () => {
		assert.deepEqual(Object.keys(lessonClassChangeTools(actions())).sort(), ["add_class_deadline", "list_classes", "remove_class_deadline", "update_class_deadline"]);
	});
	it("the teacher's and practice's tools include them when given the class actions", () => {
		const teacher = createTeacherTools({ chatId: "c1", chatStore, jobStore, spawn: () => {}, classActions: actions() });
		assert.ok(teacher.add_class_deadline && teacher.list_classes);
		assert.equal(createTeacherTools({ chatId: "c1", chatStore, jobStore, spawn: () => {} }).add_class_deadline, undefined);
		assert.ok(practiceTools({ chatId: "c1", chatStore, classActions: actions() }).add_class_deadline);
	});
});

describe("the Talk tools", () => {
	it("offer the class tools, none that deletes a class or a file", () => {
		const names = Object.keys(talkTools(classActions("Claude Code", sendOk, { openStarted: true })));
		assert.ok(names.includes("create_class") && names.includes("add_class_deadline"));
		assert.ok(names.every((n) => !/delete|unlink|remove_class(_file)?$/.test(n)), names.join(", "));
	});
	it("a change is recorded for the panel and returned as the result's changes", async () => {
		clearAgentActions();
		const tools = talkTools(classActions("Claude Code", sendOk, { openStarted: true }));
		const result = await tools.create_class!.execute("t1", { name: "CSE 21", icon: "sigma" });
		assert.deepEqual(result.details, { changes: [{ label: "Creating CSE 21", page: "/class" }] });
		const [recorded] = recentAgentActions();
		assert.equal(recorded?.label, "Creating CSE 21");
		assert.equal(recorded?.agent, "Claude Code");
		const listed = await tools.list_classes!.execute("t2", {});
		assert.deepEqual(listed.details, { changes: [] });
		assert.match((listed.content[0] as { text: string }).text, /CSE 21/);
	});
	it("every class action names a missing class the same way, so the agent knows to list classes", async () => {
		const actions = classActions("Claude Code", sendOk, { openStarted: true });
		const missing = { class_id: "cls_missing" };
		const outcomes = [
			actions.read_class(missing),
			actions.update_class({ ...missing, name: "x" }),
			actions.add_class_file({ ...missing, path: "/tmp/x.md", kind: "study" }),
			actions.set_class_file_kind({ ...missing, file_ids: ["f_x"], kind: "info" }),
			actions.add_class_deadline({ ...missing, deadlines: [{ kind: "exam", name: "Final", date: "2026-12-10" }] }),
			actions.update_class_deadline({ ...missing, deadline_id: "ddl_x", done: true }),
			actions.remove_class_deadline({ ...missing, deadline_id: "ddl_x" }),
			actions.link_class_folder({ ...missing, path: "/tmp" }),
		];
		outcomes.push(await actions.start_lesson({ topic: "Sets", ...missing }));
		for (const outcome of outcomes) assert.deepEqual(outcome, { ok: false, error: 'No class "cls_missing". Use list_classes.' });
	});
	it("start_lesson starts a lesson on the learner's words and opens it in the window", async () => {
		clearAgentActions();
		sent.length = 0;
		const tools = talkTools(classActions("Claude Code", sendOk, { openStarted: true }));
		const result = await tools.start_lesson!.execute("t4", { topic: "the CSE 29 problem set" });
		const [change] = (result.details as { changes: { page: string }[] }).changes;
		const lessonId = change!.page.slice("/chat/".length);
		assert.equal(chatStore.getChat(lessonId)?.kind, "study");
		assert.deepEqual(sent, [{ chatId: lessonId, text: "the CSE 29 problem set" }]);
		assert.equal(recentAgentActions()[0]?.open, true);
	});
	it("start_lesson from the outside agent leaves opening the lesson to Follow", async () => {
		clearAgentActions();
		const outcome = await classActions("Codex", sendOk, { openStarted: false }).start_lesson({ topic: "Pointers" });
		assert.equal(outcome.ok, true);
		assert.equal(recentAgentActions()[0]?.open, undefined);
	});
	it("a failed first message is the agent's error", async () => {
		const failing = async () => new Response("busy", { status: 409 });
		const outcome = await classActions("Codex", failing, { openStarted: false }).start_lesson({ topic: "Pointers" });
		assert.deepEqual(outcome, { ok: false, error: "The lesson was created but could not start: busy" });
	});
	it("finds the lesson the last turn started, so the agent goes on to teach it", () => {
		const user = { id: "u", role: "user", content: "lets do pointers", timestamp: 1 } as LhMessage;
		const call = { id: "a", role: "assistant", content: [], timestamp: 2 } as unknown as LhMessage;
		const started = (isError: boolean) =>
			({ id: "r", role: "toolResult", toolCallId: "c1", toolName: "start_lesson", content: [], isError, details: { changes: [{ label: "Starting Pointers", page: "/chat/chat_1" }] }, timestamp: 3 }) as unknown as LhMessage;
		assert.equal(lessonStartedLastTurn([user, call, started(false), call]), "chat_1");
		assert.equal(lessonStartedLastTurn([user, call, started(true)]), null);
		// An earlier turn's lesson isn't this turn's.
		assert.equal(lessonStartedLastTurn([user, call, started(false), call, user, call]), null);
	});
	it("a refusal reaches the model as an error", async () => {
		const refuse = { read_class: () => ({ ok: false, error: 'No class "nope". Use list_classes.' }) } as unknown as ClassActions;
		await assert.rejects(talkTools(refuse).read_class!.execute("t3", { class_id: "nope" }), /No class "nope"/);
	});
});

describe("the Talk prompt and summary", () => {
	it("is the short Talk prompt plus the shared voice, without the lesson doctrine", () => {
		const prompt = composeInstructions("talk");
		assert.match(prompt, /in the Talk chat of the teacher's panel/);
		assert.match(prompt, /## Voice/);
		assert.ok(prompt.length < 5000, `${prompt.length} characters`);
		assert.ok(prompt.length * 4 < composeInstructions("practice").length);
	});
	it("is summarized by what was done, what was learned and what is open", () => {
		const prompt = buildCompactionPrompt({ spanText: "[LEARNER] add CSE 21", planTreeText: null, kind: "talk" });
		assert.deepEqual(prompt.match(/^## .+$/gm), ["## Done", "## Learned about the learner", "## Open"]);
		assert.match(prompt, /\[LEARNER\] add CSE 21$/);
	});
});

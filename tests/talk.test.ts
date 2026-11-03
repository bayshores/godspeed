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

const { TALK_CHAT_ID } = await import("../src/core/contracts.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { openTalk, clearTalk } = await import("../src/server/talk.ts");
const { classActions } = await import("../src/server/class-actions.ts");
const { clearAgentActions, recentAgentActions } = await import("../src/server/agent-actions.ts");
const { talkTools } = await import("../src/agent/tools/talk.ts");
const { actionFor, appRequestText, speakerOf, startsTurn, talkRows } = await import("../src/components/halley/talk-model.ts");
const { composeInstructions } = await import("../src/agent/teacher-agent.ts");
const { buildCompactionPrompt } = await import("../src/core/compaction.ts");
type ClassActions = import("../src/core/class-tools.ts").ClassActions;
type AgentAction = import("../src/core/events.ts").AgentAction;

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

describe("the Talk tools", () => {
	it("offer the class tools, none that deletes a class or a file", () => {
		const names = Object.keys(talkTools(classActions("Claude Code")));
		assert.ok(names.includes("create_class") && names.includes("add_class_deadline"));
		assert.ok(names.every((n) => !/delete|unlink|remove_class(_file)?$/.test(n)), names.join(", "));
	});
	it("a change is recorded for the panel and returned as the result's changes", async () => {
		clearAgentActions();
		const tools = talkTools(classActions("Claude Code"));
		const result = await tools.create_class!.execute("t1", { name: "CSE 21", icon: "sigma" });
		assert.deepEqual(result.details, { changes: [{ label: "Creating CSE 21", page: "/class" }] });
		const [recorded] = recentAgentActions();
		assert.equal(recorded?.label, "Creating CSE 21");
		assert.equal(recorded?.agent, "Claude Code");
		const listed = await tools.list_classes!.execute("t2", {});
		assert.deepEqual(listed.details, { changes: [] });
		assert.match((listed.content[0] as { text: string }).text, /CSE 21/);
	});
	it("every class action names a missing class the same way, so the agent knows to list classes", () => {
		const actions = classActions("Claude Code");
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
		for (const outcome of outcomes) assert.deepEqual(outcome, { ok: false, error: 'No class "cls_missing". Use list_classes.' });
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

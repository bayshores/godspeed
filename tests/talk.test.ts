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
const { actionFor, talkRows } = await import("../src/components/halley/talk-model.ts");
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
			rows.map((r) => [r.kind, r.kind === "change" ? r.change.label : r.text]),
			[
				["you", "Add CSE 21"],
				["change", "Creating CSE 21"],
				["teacher", "Done, CSE 21 is set up."],
			],
		);
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

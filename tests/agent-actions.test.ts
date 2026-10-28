/**
 * Halley's server half (plan 2026-10-28, Phase 4): every MCP tool that
 * changes something records an agent action — {id, at, agent, label,
 * classId, target, page} — announces it as "agent-action", and the last
 * 20 are served by GET /api/agent-actions.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, beforeEach, describe, it } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-agent-actions-"));
const originalEnv = process.env;
const originalFetch = globalThis.fetch;
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	LH_DATA_DIR: path.join(scratch, "data"),
	LH_AUTH_FILE: path.join(scratch, "auth.json"),
	HOME: path.join(scratch, "home"),
};
fs.mkdirSync(path.join(scratch, "home"), { recursive: true });
globalThis.fetch = async () => {
	throw new Error("CLOSED: unexpected network request");
};
after(() => {
	process.env = originalEnv;
	globalThis.fetch = originalFetch;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const mcp = await import("../src/server/mcp.ts");
const actions = await import("../src/server/agent-actions.ts");
const route = await import("../src/app/api/agent-actions/route.ts");
const { subscribe } = await import("../src/core/events.ts");
type AgentAction = import("../src/core/events.ts").AgentAction;

function rpc(body: unknown, headers: Record<string, string> = {}) {
	return new Request("http://127.0.0.1:3000/api/mcp", {
		method: "POST",
		headers: { host: "127.0.0.1:3000", "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
		body: JSON.stringify(body),
	});
}

const auth = () => ({ authorization: `Bearer ${mcp.ensureMcpAccess()}` });

async function call(name: string, args: Record<string, unknown>) {
	const res = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }, auth()))).json();
	const text = res.result.content[0].text as string;
	return { error: res.result.isError === true, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
}

/** Run `fn` and collect the agent-action events it caused. */
async function heard(fn: () => Promise<unknown>): Promise<AgentAction[]> {
	const got: AgentAction[] = [];
	const off = subscribe((e) => {
		if (e.type === "agent-action") {
			const { type: _t, ...action } = e;
			got.push(action);
		}
	});
	try {
		await fn();
	} finally {
		off();
	}
	return got;
}

describe("agent actions from the MCP tools", () => {
	beforeEach(() => actions.clearAgentActions());

	it("deadline tools report what changed, with the class, target and page", async () => {
		// Name the agent the way its handshake does.
		await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "1" } } }, auth()));
		let classId = "";
		const [created] = await heard(async () => {
			classId = (await call("create_class", { name: "CSE 21" })).body.class.id;
		});
		assert.deepEqual({ ...created, id: undefined, at: undefined }, { id: undefined, at: undefined, agent: "Claude Code", label: "Creating CSE 21", classId, target: { kind: "class", id: classId }, page: "/class" });
		assert.match(created!.id, /^act_/);
		assert.ok(!Number.isNaN(Date.parse(created!.at)));

		let deadlineId = "";
		const [added] = await heard(async () => {
			deadlineId = (await call("add_class_deadline", { class_id: classId, kind: "homework", name: "HW 5", date: "2026-11-05" })).body.deadline.id;
		});
		assert.equal(added!.label, "Adding HW 5");
		assert.deepEqual(added!.target, { kind: "deadline", id: deadlineId });
		assert.equal(added!.page, "/");
		assert.equal(added!.classId, classId);

		const [done] = await heard(() => call("update_class_deadline", { class_id: classId, deadline_id: deadlineId, done: true }));
		assert.equal(done!.label, "Marking HW 5 done");
		const [moved] = await heard(() => call("update_class_deadline", { class_id: classId, deadline_id: deadlineId, time: "17:00" }));
		assert.equal(moved!.label, "Moving HW 5");
		const [removed] = await heard(() => call("remove_class_deadline", { class_id: classId, deadline_id: deadlineId }));
		assert.equal(removed!.label, "Removing HW 5");
		assert.equal(removed!.removed, true);
	});

	it("a refused change reports nothing", async () => {
		const got = await heard(() => call("add_class_deadline", { class_id: "cls_missing", kind: "exam", name: "Final", date: "2026-12-10" }));
		assert.deepEqual(got, []);
		const got2 = await heard(() => call("list_classes", {}));
		assert.deepEqual(got2, [], "reading changes nothing");
	});

	it("files and notes point at the Files page", async () => {
		const classId = (await call("create_class", { name: "CSE 29" })).body.class.id as string;
		const file = path.join(scratch, "syllabus.md");
		fs.writeFileSync(file, "# Syllabus\n");
		const [addedFile] = await heard(() => call("add_class_file", { class_id: classId, path: file, kind: "info" }));
		assert.equal(addedFile!.label, "Adding syllabus.md");
		assert.equal(addedFile!.target?.kind, "file");
		assert.equal(addedFile!.page, "/class/files");
		const [kind] = await heard(() => call("set_class_file_kind", { class_id: classId, file_id: addedFile!.target!.id, kind: "info" }));
		assert.equal(kind!.label, "Marking syllabus.md as course info");
	});
});

describe("the recent list", () => {
	beforeEach(() => actions.clearAgentActions());

	it("keeps the last 20, newest first, served by GET /api/agent-actions", async () => {
		for (let i = 1; i <= 25; i++) actions.recordAgentAction({ label: `Adding HW ${i}`, classId: "cls_a", target: { kind: "deadline", id: `ddl_${i}` }, page: "/" });
		const res = await route.GET();
		const body = (await res.json()) as { actions: AgentAction[] };
		assert.equal(body.actions.length, actions.RECENT_LIMIT);
		assert.equal(body.actions[0]!.label, "Adding HW 25");
		assert.equal(body.actions.at(-1)!.label, "Adding HW 6");
	});

	it("a repeat of the newest (a lesson's many replies) only refreshes its time", () => {
		const t0 = Date.parse("2026-10-28T16:00:00Z");
		const input = { label: "Replying in Counting", classId: null, target: { kind: "lesson" as const, id: "c1" }, page: "/chat/c1" };
		const events = [] as AgentAction[];
		const off = subscribe((e) => {
			if (e.type === "agent-action") events.push(e);
		});
		const first = actions.recordAgentAction(input, t0);
		const again = actions.recordAgentAction(input, t0 + 30_000);
		const later = actions.recordAgentAction(input, t0 + 30_000 + actions.COALESCE_MS + 1);
		off();
		assert.equal(first.id, again.id);
		assert.equal(again.at, new Date(t0 + 30_000).toISOString());
		assert.notEqual(later.id, first.id);
		assert.equal(events.length, 2, "the repeat is not announced again");
		assert.equal(actions.recentAgentActions().length, 2);
	});

	it("labels are one short line, and an unnamed agent is 'Outside agent'", () => {
		const a = actions.recordAgentAction({ label: `Reading  ${"x".repeat(200)}\nmore`, classId: null, target: null, page: "/graph" });
		assert.ok(a.label.length <= 80);
		assert.ok(!a.label.includes("\n"));
		assert.equal(a.agent, "Outside agent");
	});
});

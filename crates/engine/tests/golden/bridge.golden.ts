// The real agent-bridge.ts driven by a script of operations that tests/bridge_golden.rs runs on
// the Rust Bridge: views, errors, replies as assistant messages, saved marks and events. Random
// work and call ids are numbered by first appearance; times are masked.
import * as bridge from "../../../../src/backend/agent/agent-bridge.ts";
import type { SeenMark, SeenStore } from "../../../../src/shared/core/agent-seen.ts";
import { subscribe } from "../../../../src/shared/core/events.ts";

type Op = Record<string, unknown> & { op: string };

const decl = (name: string, description: string) => ({ name, description, parameters: { type: "object", properties: { text: { type: "string" } } } });
const sys = { role: "system", content: "Teach well.", toolsAdded: [decl("quiz", "Ask."), decl("echo", "Echo.")], timestamp: 0 };
const user = (text: string, image = false) => ({ role: "user", content: image ? [{ type: "text", text }, { type: "image", data: "aGk=", mimeType: "image/png" }] : text, timestamp: 1 });

const script: Op[] = [
	{ op: "park", as: "A", conversation: "chat_l1", messages: [sys, user("hi", true)] },
	{ op: "wait", as: "W1", conversation: "chat_l1", agent: "agent-A" },
	{ op: "respond", work: "W1", toolCalls: [{ name: "nope", arguments: {} }] },
	{ op: "respond", work: "W1", text: "  " },
	{ op: "pages", work: "W1", pages: [["p1"], ["p2a", "p2b"], ["p3"]] },
	{ op: "respond", work: "W1", text: "x" },
	{ op: "read", work: "W1", page: 4 },
	{ op: "read", work: "W1", page: 2 },
	{ op: "read", work: "W1", page: 3 },
	{ op: "respond", work: "W1", text: "Hello", toolCalls: [{ name: "echo", arguments: { text: "a" } }], hold: 30_000 },
	{ op: "result", of: "A" },
	{ op: "parkNext", as: "B", from: "A", result: "echo: a" },
	{ op: "wait", as: "none1", agent: "agent-B" },
	{ op: "wait", as: "W2", conversation: "chat_l1", agent: "agent-A" },
	{ op: "release", conversation: "chat_l1" },
	{ op: "park", as: "C", conversation: "chat_l2", messages: [sys, user("other")] },
	{ op: "wait", as: "W3", agent: "agent-A" },
	{ op: "wait", as: "none2", agent: "agent-B" },
	{ op: "claimed" },
	{ op: "forget", agent: "agent-A", cleared: true },
	{ op: "wait", as: "W4", agent: "agent-B" },
	{ op: "label", conversation: "job_x", label: "Topic grouping: CSE 21" },
	{ op: "park", as: "D", conversation: "job_x", messages: [{ role: "system", content: "Group topics.", timestamp: 0 }, user("topics")] },
	{ op: "pending" },
	{ op: "wait", as: "W5", conversation: "chat_l2", agent: "agent-C", andBackground: true },
	{ op: "wait", as: "W6", conversation: "chat_l2", agent: "agent-C", andBackground: true },
	{ op: "full", work: "W6" },
	{ op: "respond", work: "W6", text: "done" },
	{ op: "respond", work: "W6", text: "again" },
	{ op: "result", of: "D" },
	{ op: "respond", work: "W4", text: "Fine.", hold: 0 },
	{ op: "result", of: "B" },
	{ op: "parkNext", as: "B2", from: "B", result: "" },
	{ op: "wait", as: "W7", conversation: "chat_l1", agent: "agent-B" },
	{ op: "wait", as: "W8", conversation: "chat_l1", agent: "agent-A", full: true },
	{ op: "park", as: "E", conversation: "chat_l3", messages: [sys, user("stop me")] },
	{ op: "abort", of: "E" },
	{ op: "result", of: "E" },
	{ op: "pending" },
	{ op: "stay", agent: "agent-A", lesson: "chat_l1" },
	{ op: "staying", agent: "agent-A" },
	{ op: "stay", agent: "agent-A" },
	{ op: "staying", agent: "agent-A" },
	{ op: "forgetConversation", conversation: "job_x" },
	{ op: "wait", as: "none3", conversation: "job_x", agent: "agent-C" },
	// A text-only reply holds no random id, so this saved mark's hash is the same every run.
	{ op: "park", as: "F", conversation: "chat_l4", messages: [sys, user("mark me", true)] },
	{ op: "wait", as: "W9", conversation: "chat_l4", agent: "agent-D" },
	{ op: "respond", work: "W9", text: "Marked." },
	{ op: "result", of: "F" },
	{ op: "names", infos: [{ name: "claude-code" }, { name: " Codex-CLI " }, { name: "x", title: "  My Agent  " }, { name: "n".repeat(70) }, {}, { name: 5 }] },
];

const tick = () => new Promise((r) => setTimeout(r, 5));

function numberIds(value: unknown, seen: Map<string, string>): unknown {
	if (typeof value === "string")
		return value.replace(/\b(work|agent)_[0-9a-f]{8}-[0-9a-f]{3}/g, (id, kind) => {
			if (!seen.has(id)) seen.set(id, `<${kind}#${[...seen.keys()].filter((k) => k.startsWith(kind)).length + 1}>`);
			return seen.get(id)!;
		});
	if (Array.isArray(value)) return value.map((v) => numberIds(v, seen));
	if (value && typeof value === "object") {
		const o = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.entries(o)
				.filter(([k]) => !(k === "durationMs" && o.role === "assistant"))
				.map(([k, v]) => [k, k === "timestamp" || k === "claimedAt" ? "<t>" : k === "durationMs" ? "<ms>" : numberIds(v, seen)]),
		);
	}
	return value;
}

async function run() {
	const marks = new Map<string, SeenMark>();
	const store: SeenStore = {
		get: (agent, conversation) => marks.get(`${agent} ${conversation}`),
		set: (agent, conversation, mark) => void marks.set(`${agent} ${conversation}`, mark),
		forgetAgent: (agent) => { for (const k of [...marks.keys()]) if (k.startsWith(`${agent} `)) marks.delete(k); },
	};
	bridge.setSeenStore(store);
	const events: string[] = [];
	subscribe((e) => void events.push(e.type));
	const parked = new Map<string, { messages: unknown[]; result: Promise<unknown>; abort: AbortController }>();
	const works = new Map<string, string>();
	const out: unknown[] = [];
	const model = bridge.agentModel();
	for (const step of script) {
		events.length = 0;
		let result: unknown = null;
		const s = step as Record<string, any>;
		switch (step.op) {
			case "park":
			case "parkNext": {
				let messages = s.messages;
				let conversation = s.conversation;
				if (step.op === "parkNext") {
					const from = parked.get(s.from)!;
					const reply = (await from.result) as { content: { type: string; id?: string; name?: string }[] };
					const calls = reply.content.filter((b) => b.type === "toolCall");
					messages = [...from.messages, reply, ...calls.map((c) => ({ role: "toolResult", toolCallId: c.id, toolName: c.name, content: [{ type: "text", text: s.result }], isError: false, timestamp: 1 }))];
					conversation = (from as { conversation?: string }).conversation;
				}
				const abort = new AbortController();
				const stream = bridge.agentStream(model, { messages } as never, { sessionId: conversation, signal: abort.signal } as never);
				parked.set(s.as, { messages, result: stream.result(), abort, conversation } as never);
				await tick();
				break;
			}
			case "wait": {
				const view = await bridge.waitForWork(0, { conversation: s.conversation, agent: s.agent, full: s.full, andBackground: s.andBackground });
				if (view) works.set(s.as, view.workId);
				result = view;
				break;
			}
			case "respond": {
				result = bridge.respondToWork(works.get(s.work)!, { text: s.text, toolCalls: s.toolCalls }, s.hold ?? 30_000);
				await tick();
				break;
			}
			case "result":
				result = await parked.get(s.of)!.result;
				break;
			case "pages":
				bridge.setWorkPages(works.get(s.work)!, s.pages);
				break;
			case "read":
				result = bridge.readWorkPage(works.get(s.work)!, s.page);
				break;
			case "full":
				result = bridge.fullWorkView(works.get(s.work)!);
				break;
			case "release":
				bridge.releaseConversation(s.conversation);
				break;
			case "forget":
				bridge.forgetAgent(s.agent, s.cleared);
				break;
			case "label":
				bridge.labelConversation(s.conversation, s.label);
				break;
			case "claimed":
				result = bridge.claimedLessons();
				break;
			case "pending":
				result = bridge.pendingWorkCount();
				break;
			case "abort":
				parked.get(s.of)!.abort.abort();
				await tick();
				break;
			case "stay":
				bridge.stayOn(s.agent, s.lesson);
				break;
			case "staying":
				result = bridge.stayingOn(s.agent) ?? null;
				break;
			case "forgetConversation":
				bridge.forgetConversation(s.conversation);
				break;
			case "names":
				result = s.infos.map((i: never) => bridge.displayAgentName(i) ?? null);
				break;
		}
		out.push({ step, result, events: [...events] });
	}
	const saved = Object.fromEntries([...marks].map(([k, m]) => [k, m]));
	return numberIds({ steps: out, saved }, new Map());
}

export default { script: () => run() };

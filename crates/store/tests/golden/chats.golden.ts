// The lesson store on disk: what listChats, getChat and the writers produce from the same files.
// The cases record whole files. chats-seed.lab.golden.ts is the same store on real app data.
import fs from "node:fs";
import path from "node:path";
import { chatStore } from "../../../../src/backend/store/chats.ts";
import { inFolder } from "./chats-support.ts";

function attempt<T>(run: () => T): { ok: T | null } | { error: string } {
	try {
		return { ok: run() ?? null };
	} catch (err) {
		return { error: (err as Error).message };
	}
}

const call = (id: string, name: string, args: unknown) => ({ type: "toolCall", id, name, arguments: args });
const assistant = (id: string, content: unknown[]) => ({ id, role: "assistant", content, stopReason: "toolUse", timestamp: 1 });
const result = (id: string, toolCallId: string, toolName: string, details: unknown = {}) => ({ id, role: "toolResult", toolCallId, toolName, content: [{ type: "text", text: "ok" }], details, isError: false, timestamp: 2 });
const record = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) => ({
	id, title: `Lesson ${id}`, createdAt: "2026-01-01T00:00:00.000Z", updatedAt, messages: [], ...extra,
});

const synthetic: Record<string, string> = {
	"chat_a.json": JSON.stringify(record("chat_a", "2026-02-01T00:00:00.000Z", { spaceId: "cls_1" }), null, "\t"),
	"chat_b.json": JSON.stringify(record("chat_b", "2026-03-01T00:00:00.000Z", { kind: "study", version: 1, messages: [{ id: "u1", role: "user", content: "hi", timestamp: 3 }] }), null, "\t"),
	"chat_c.json": JSON.stringify(
		record("chat_c", "2026-01-15T00:00:00.000Z", {
			kind: "practice",
			messages: [assistant("a1", [call("p1", "problem", { statement: "s" })]), result("r1", "p1", "problem")],
			turns: [{ id: "t0" }],
			tree: { nodes: [] },
		}),
		null,
		"\t",
	),
	"chat_d.json": JSON.stringify(
		record("chat_d", "2026-03-01T00:00:00.000Z", {
			messages: [assistant("a1", [call("d1", "probe_done", {})]), result("r1", "d1", "probe_done"), assistant("a2", [call("q1", "quiz", { nodeId: "n1" })])],
		}),
		null,
		"\t",
	),
	"chat_talk.json": JSON.stringify(record("chat_talk", "2026-04-01T00:00:00.000Z", { kind: "talk" }), null, "\t"),
	"chat_future.json": JSON.stringify(record("chat_future", "2026-05-01T00:00:00.000Z", { version: 3 }), null, "\t"),
	"chat_noshape.json": JSON.stringify({ id: "chat_noshape", messages: [] }),
	"chat_broken.json": "{ not json",
	"odd name.json": JSON.stringify(record("odd name", "2026-06-01T00:00:00.000Z")),
	"chat_dir": "",
};

const ids = ["chat_a", "chat_b", "chat_c", "chat_d", "chat_talk", "chat_future", "chat_noshape", "chat_broken", "odd name", "../escape", "missing", ""];

const steps = [
	{ op: "rename", id: "chat_a", title: "  New name  " },
	{ op: "rename", id: "chat_a", title: "   " },
	{ op: "setSpace", id: "chat_a", spaceId: "cls_2" },
	{ op: "setSpace", id: "chat_a", spaceId: null },
	{ op: "turnUsage", id: "chat_a", entry: { id: "t1", tokens: 5 } },
	{ op: "turnUsage", id: "chat_a", entry: { id: "t1", tokens: 6 } },
	{ op: "turnUsage", id: "chat_a", entry: { id: "t2" } },
	{ op: "extractionUsage", id: "chat_a", entry: { startedAt: "s1", cost: 1 } },
	{ op: "extractionUsage", id: "chat_a", entry: { startedAt: "s1", cost: 2 } },
	{ op: "tree", id: "chat_a", tree: { nodes: [{ id: "n" }] } },
	{ op: "rename", id: "chat_b", title: "Study notes" },
	{ op: "turnUsage", id: "chat_c", entry: { id: "t0" } },
	{ op: "rename", id: "chat_talk", title: "Talk" },
	{ op: "rename", id: "chat_future", title: "x" },
	{ op: "rename", id: "chat_broken", title: "x" },
	{ op: "rename", id: "../escape", title: "x" },
	{ op: "tree", id: "missing", tree: {} },
	{ op: "turnUsage", id: "missing", entry: { id: "t" } },
	{ op: "extractionUsage", id: "", entry: { startedAt: "s" } },
	{ op: "setSpace", id: "missing", spaceId: "cls" },
	{ op: "saveMessages", id: "missing" },
	{ op: "delete", id: "chat_d" },
	{ op: "delete", id: "chat_d" },
	{ op: "delete", id: "../escape" },
	{ op: "delete", id: "chat_broken" },
	{ op: "attachment", id: "chat_a", name: "pic.png" },
	{ op: "attachment", id: "chat_a", name: "dir/pic.png" },
	{ op: "attachment", id: "../escape", name: "pic.png" },
	{ op: "delete", id: "chat_a" },
] as const;

type Step = (typeof steps)[number];

/** Runs one step against the store. Returns what the caller would see. */
function run(step: Step): unknown {
	switch (step.op) {
		case "rename": return chatStore.renameChat(step.id, step.title);
		case "setSpace": return chatStore.setChatSpace(step.id, step.spaceId);
		case "turnUsage": return chatStore.appendTurnUsage(step.id, step.entry as never);
		case "extractionUsage": return chatStore.appendExtractionUsage(step.id, step.entry as never);
		case "tree": return chatStore.saveTree(step.id, step.tree as never);
		case "saveMessages": return chatStore.saveMessages(step.id, []);
		case "delete": return chatStore.deleteChat(step.id);
		case "attachment": return fs.readFileSync(chatStore.saveAttachment(step.id, step.name, new Uint8Array([1, 2, 3]))).toString("hex");
	}
}

function writeFiles(dir: string) {
	for (const [name, text] of Object.entries(synthetic)) {
		if (name === "chat_dir") fs.mkdirSync(path.join(dir, name));
		else fs.writeFileSync(path.join(dir, name), text);
	}
}

function bytesOf(dir: string): Record<string, string | null> {
	return Object.fromEntries(fs.readdirSync(dir).sort().map((name) => {
		const file = path.join(dir, name);
		return [name, fs.statSync(file).isDirectory() ? null : fs.readFileSync(file, "utf-8")];
	}));
}

/** Masks the clock's and the id generator's output in a created record's text. */
const maskCreated = (text: string) => text.replace(/chat_[0-9a-z]+_[0-9a-f]{8}/g, "<id>").replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<time>");

export default {
	"synthetic store": () =>
		inFolder((dir) => {
			writeFiles(dir);
			const reads = ids.map((id) => ({ id, chat: chatStore.getChat(id) }));
			const list = chatStore.listChats();
			const afterSteps = steps.map((step) => {
				const outcome = attempt(() => run(step));
				return { step, ...outcome, files: bytesOf(dir), list: chatStore.listChats() };
			});
			return { files: synthetic, ids, reads, list, afterSteps };
		}),
	"created lessons": () =>
		inFolder((dir) => {
			const made = [
				chatStore.createChat("  Limits  ", undefined, "cls_1", ""),
				chatStore.createChat("", undefined, undefined, "deadline_1"),
				chatStore.createChat("Quick chat", "talk"),
				chatStore.createChat("Study", "study", "cls_2", "d2"),
			];
			return made.map((chat) => ({
				masked: JSON.parse(maskCreated(JSON.stringify(chat))),
				keys: Object.keys(chat),
				text: maskCreated(fs.readFileSync(path.join(dir, `${chat.id}.json`), "utf-8")),
			}));
		}),
} as Record<string, () => unknown>;

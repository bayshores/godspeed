// The turns package's pure seams on the real TypeScript, over synthetic lessons: the settled
// stream terminal, the compaction trigger's context estimate, the canonical turn save (ids the
// save mints read "<new>") and PDF attachments. tests/turns_golden.rs replays each case.
const server = "../../../../src/backend/server";
const { settledTurnResponse, rememberTurnFailure, clearTurnFailure } = await import(`${server}/turn-runs.ts`);
const { projectedContextTokens } = await import(`${server}/compaction.ts`);
const { persistTurn } = await import(`${server}/turn-service.ts`);
const { storeAttachments } = await import(`${server}/attachments.ts`);

type Msg = Record<string, unknown>;

const usage = (input: number, output: number) => ({ input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
const user = (id: string, content: string): Msg => ({ id, role: "user", content, timestamp: 1 });
const reply = (id: string | undefined, text: string, u?: ReturnType<typeof usage>, stopReason = "stop"): Msg => ({
	...(id ? { id } : {}),
	role: "assistant",
	content: [{ type: "text", text }],
	...(u ? { usage: u } : {}),
	stopReason,
	timestamp: 2,
});
const call = (name: string, id: string, args: unknown = {}): Msg => ({ role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }], stopReason: "toolUse", timestamp: 3 });
const result = (name: string, id: string, isError: boolean, details?: unknown): Msg => ({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text: `${name} result` }], isError, ...(details === undefined ? {} : { details }), timestamp: 4 });
const marker = (id: string, firstKept: string): Msg => ({ id, role: "custom", customType: "compaction", content: "[SESSION HISTORY COMPACTED] summary", display: true, details: { firstKeptMessageId: firstKept, tokensBefore: 9 }, timestamp: 5 });

/** Replaces what the save minted (ids, and a plan block's time) with fixed text. */
function masked(messages: Msg[], known: Set<string>): Msg[] {
	return messages.map((m) => {
		const out: Msg = { ...m };
		if (typeof out.id === "string" && !known.has(out.id)) out.id = "<new>";
		if (out.customType === "plan-block") {
			const details = out.details as { planCallId: string; block: Record<string, unknown> };
			out.timestamp = "<now>";
			out.details = { ...details, block: { ...details.block, at: "<now>" } };
		}
		return out;
	});
}

function persistCase(record: { messages: Msg[]; tree?: unknown }, base: number, turn: Msg[]) {
	let saved: Msg[] = [];
	const store = {
		getChat: () => ({ id: "chat_g", title: "G", createdAt: "x", updatedAt: "x", messages: record.messages, ...(record.tree ? { tree: record.tree } : {}) }),
		saveMessages: (_id: string, messages: Msg[]) => {
			saved = messages;
		},
	};
	const known = new Set([...record.messages, ...turn].map((m) => m.id).filter((id): id is string => typeof id === "string"));
	const stamped = persistTurn(store as never, "chat_g", base, turn as never) as Msg[];
	return { stamped: masked(stamped, known), saved: masked(saved, known) };
}

const tree = { nodes: [{ id: "a", title: "Limits" }, { id: "b", title: "Derivatives" }], edges: [{ from: "a", to: "b" }] };

export default {
	"settled stream": async () => {
		clearTurnFailure("chat_g");
		const plain = await settledTurnResponse("chat_g").text();
		rememberTurnFailure("chat_g", "The reply could not be saved.");
		const failed = await settledTurnResponse("chat_g").text();
		clearTurnFailure("chat_g");
		return { plain, failed };
	},
	"projected tokens": () => {
		const plain = [user("m1", "What is a limit? ".repeat(40)), user("m2", "and continuity")];
		const anchored = [user("m1", "hi"), reply("m2", "Hello there", usage(1200, 40)), user("m3", "x".repeat(400))];
		const stale = [user("m1", "hi"), reply("m2", "old", usage(50_000, 10)), marker("m3", "m4"), user("m4", "kept tail"), user("m5", "next")];
		return [plain, anchored, stale].map((messages) => [0, 1500].map((sys) => projectedContextTokens(messages as never, sys)));
	},
	"persist plain turn": () => persistCase({ messages: [user("u1", "hi")] }, 1, [user("u1", "hi"), reply(undefined, "Hello!", usage(10, 2)), reply("keep_id", "Kept id")]),
	"persist drops a clean question placeholder": () =>
		persistCase({ messages: [user("u1", "quiz me")] }, 1, [user("u1", "quiz me"), call("quiz", "q1"), result("quiz", "q1", false), call("ask_user_question", "q2"), result("ask_user_question", "q2", true)]),
	"persist a plan block once": () => {
		const first = persistCase({ messages: [user("u1", "plan it")], tree }, 1, [user("u1", "plan it"), call("plan_init", "p1"), result("plan_init", "p1", false, { ok: true }), reply(undefined, "Here is the plan.")]);
		const failed = persistCase({ messages: [user("u1", "plan it")], tree }, 1, [user("u1", "plan it"), call("plan_init", "p1"), result("plan_init", "p1", true, { ok: false })]);
		return { first, failed };
	},
	"persist with a base past the record": () => persistCase({ messages: [] }, 3, [user("a", "1"), user("b", "2"), user("c", "3"), reply(undefined, "four")]),
	"pdf attachments": async () => {
		const saved: string[] = [];
		const save = (fileName: string) => {
			saved.push(fileName);
			return `/lessons/chat_g/${fileName}`;
		};
		const pdf = Buffer.from("%PDF-1.4 a tiny synthetic document").toString("base64");
		const parts = await storeAttachments(
			[
				{ name: "Week 3 notes.pdf", mimeType: "application/pdf", data: pdf },
				{ name: "../odd:name?.PDF", mimeType: "application/pdf", data: pdf },
			],
			save,
		);
		let refused = "";
		try {
			await storeAttachments([{ name: "fake.pdf", mimeType: "application/pdf", data: Buffer.from("hello").toString("base64") }], save);
		} catch (err) {
			refused = (err as Error).message;
		}
		let unreadable = "";
		try {
			await storeAttachments([{ name: "photo.png", mimeType: "image/png", data: Buffer.from("not a picture").toString("base64") }], save);
		} catch (err) {
			unreadable = (err as Error).message;
		}
		return { parts, saved, refused, unreadable };
	},
};

/** Source marks on the server: marks in a reply are checked against the
 *  class's indexed passages before the reply is stored, the cited route
 *  serves the passage and the PDF page, and respond tells the agent what it
 *  removed. The search index is never built under test, so the tables are
 *  written by hand (made-up classes and text). */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-citations-"));
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

const { checkCites } = await import("../../src/backend/server/citations.ts");
const { graphDirFor } = await import("../../src/backend/server/stores.ts");
const { classStore } = await import("../../src/backend/store/classes.ts");
const { chatStore } = await import("../../src/backend/store/chats.ts");
const { isTurnRunning } = await import("../../src/backend/server/turn-liveness.ts");
const { handleChatInput } = await import("../../src/backend/server/chat-handler.ts");
const bridge = await import("../../src/backend/agent/agent-bridge.ts");
const mcp = await import("../../src/backend/server/mcp.ts");
const { ensureMcpToken } = await import("../../src/backend/store/mcp-token.ts");
const passageRoute = await import("../../src/app/api/cited/[fileId]/route.ts");
const pageRoute = await import("../../src/app/api/cited/[fileId]/page/[n]/route.ts");

const NOTES = "f_aaaaaaaaaaaa";
const SLIDES = "f_bbbbbbbbbbbb";
const GONE = "f_cccccccccccc";
const TALK = "f_dddddddddddd";

/** A class with a text file and a PDF, and a search table of their passages. */
function makeClass() {
	const record = classStore.createClass({ name: "Made-up Class" });
	const dir = classStore.filesDir(record.id);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, "notes.txt"), "line one\nline two\n");
	fs.copyFileSync(path.join(import.meta.dirname, "../fixtures/sample-3page.pdf"), path.join(dir, "slides.pdf"));
	const file = (id: string, name: string) => ({ id, origin: "copied" as const, name, path: name, kind: "study" as const, contentFp: "0", status: "ready" as const, addedAt: "2026-01-01T00:00:00.000Z" });
	classStore.saveFiles(record.id, [file(NOTES, "notes.txt"), file(SLIDES, "slides.pdf"), file(TALK, "lecture.srt")]);
	const rows = [
		{ id: `${NOTES}:1`, fileId: NOTES, range: "lines 1–2", from: 1, to: 2, text: "line one line two", hash: "h1" },
		{ id: `${SLIDES}:1`, fileId: SLIDES, range: "p. 2", from: 2, to: 2, text: "Page two says hello.", hash: "h2" },
		// A transcript's place is rounded down, so its number is before the passage starts.
		{ id: `${TALK}:1`, fileId: TALK, range: "12:30–13:40", from: 750.5, to: 820, text: "So a heap is a tree.", hash: "h3" },
	];
	const searchDir = path.join(path.dirname(graphDirFor(record.id)), "search");
	fs.mkdirSync(searchDir, { recursive: true });
	fs.writeFileSync(path.join(searchDir, "passages.json"), JSON.stringify({ format: 1, model: "Snowflake/snowflake-arctic-embed-xs", rows, files: { [NOTES]: { fp: "0", extent: "2 lines" }, [SLIDES]: { fp: "0", extent: "3 pages" } } }));
	fs.writeFileSync(path.join(searchDir, "passages.f32"), Buffer.from(new Float32Array(rows.length * 384).buffer));
	return record;
}

makeClass();

describe("checkCites", () => {
	it("rewrites a passage mark to the stored form with the file name", () => {
		const out = checkCites(`Page two says hello. [[${SLIDES}:1]]`);
		assert.deepEqual(out, { text: `Page two says hello. [[${SLIDES}/p. 2/slides.pdf]]`, removed: [] });
	});

	it("keeps a transcript mark it wrote itself, whose place is a rounded time", () => {
		const stored = `Heaps. [[${TALK}/12:30–13:40/lecture.srt]]`;
		assert.deepEqual(checkCites(`Heaps. [[${TALK}:1]]`), { text: stored, removed: [] });
		assert.deepEqual(checkCites(stored), { text: stored, removed: [] });
	});

	it("removes a mark whose passage does not exist and reports it once", () => {
		const out = checkCites(`A. [[${NOTES}:9]] B. [[${NOTES}:9]] C. [[${GONE}:1]]`);
		assert.equal(out.text, "A.  B.  C. ");
		assert.deepEqual(out.removed, [`${NOTES}:9`, `${GONE}:1`]);
	});

	it("keeps a stored-form mark that still points at a passage, with the current name", () => {
		const out = checkCites(`Yes. [[${SLIDES}/p. 2/old name.pdf]]`);
		assert.deepEqual(out, { text: `Yes. [[${SLIDES}/p. 2/slides.pdf]]`, removed: [] });
	});

	it("removes a stored-form mark whose place has no passage", () => {
		const out = checkCites(`Yes. [[${SLIDES}/p. 3/slides.pdf]]`);
		assert.deepEqual(out, { text: "Yes. ", removed: [`${SLIDES}/p. 3`] });
	});

	it("keeps a web mark as written", () => {
		const text = "See this. [[https://example.com/page]]";
		assert.deepEqual(checkCites(text), { text, removed: [] });
	});

	it("leaves text without marks untouched", () => {
		const text = "Nothing here, only [brackets] and a list a[[0]] in code `[[x]]`.";
		assert.deepEqual(checkCites(text), { text, removed: [] });
	});
});

describe("the cited routes", () => {
	const ctx = (fileId: string, n?: string) => ({ params: Promise.resolve({ fileId, n: n as string }) });
	const get = (fileId: string, range: string) => passageRoute.GET(new Request(`http://localhost/api/cited/${fileId}?range=${encodeURIComponent(range)}`), ctx(fileId));

	it("gives a text file's passage with no page", async () => {
		const res = await get(NOTES, "lines 1–2");
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { name: "notes.txt", range: "lines 1–2", page: null, text: "line one line two" });
	});

	it("gives a PDF's passage with its page number", async () => {
		const res = await get(SLIDES, "p. 2");
		assert.deepEqual(await res.json(), { name: "slides.pdf", range: "p. 2", page: 2, text: "Page two says hello." });
	});

	it("gives a PDF page that is not indexed with its page and no text", async () => {
		const res = await get(SLIDES, "p. 3");
		assert.deepEqual(await res.json(), { name: "slides.pdf", range: "p. 3", page: 3, text: "" });
	});

	it("is 404 for a place with no passage in a text file, a missing file or a bad id, and 400 for no range", async () => {
		assert.equal((await get(NOTES, "lines 50–60")).status, 404);
		assert.equal((await get(GONE, "p. 1")).status, 404);
		assert.equal((await get("not-an-id", "p. 1")).status, 404);
		assert.equal((await passageRoute.GET(new Request(`http://localhost/api/cited/${NOTES}`), ctx(NOTES))).status, 400);
	});

	it("renders a PDF page as a PNG and refuses a text file, a missing file and a bad page", async () => {
		const page = await pageRoute.GET(new Request("http://localhost"), ctx(SLIDES, "2"));
		assert.equal(page.status, 200);
		assert.equal(page.headers.get("content-type"), "image/png");
		assert.deepEqual([...new Uint8Array(await page.arrayBuffer()).slice(1, 4)], [80, 78, 71]);
		assert.equal((await pageRoute.GET(new Request("http://localhost"), ctx(NOTES, "1"))).status, 404);
		assert.equal((await pageRoute.GET(new Request("http://localhost"), ctx(GONE, "1"))).status, 404);
		assert.equal((await pageRoute.GET(new Request("http://localhost"), ctx(SLIDES, "0"))).status, 400);
		assert.equal((await pageRoute.GET(new Request("http://localhost"), ctx(SLIDES, "9"))).status, 404);
	});
});

describe("respond checks source marks", () => {
	const rpc = (body: unknown) =>
		new Request("http://127.0.0.1:3000/api/mcp", {
			method: "POST",
			headers: { host: "127.0.0.1:3000", "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${ensureMcpToken()}` },
			body: JSON.stringify(body),
		});
	async function respond(args: Record<string, unknown>) {
		const res = await (await mcp.handleMcpRequest(rpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "respond", arguments: args } }))).json();
		return (res.result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");
	}
	const lastTeacherText = (chatId: string) => {
		const last = chatStore.getChat(chatId)!.messages.at(-1) as { role: string; content: { type: string; text: string }[] };
		return last.role === "assistant" ? last.content.map((c) => c.text).join("") : "";
	};
	/** The turn has been saved and closed. */
	async function settled(chatId: string) {
		for (let i = 0; i < 400 && isTurnRunning(chatId); i++) await new Promise((r) => setTimeout(r, 20));
	}

	it("stores the rewritten text and tells the agent what it removed when the turn is done", async () => {
		const chat = chatStore.createChat("Marks");
		await handleChatInput(chat.id, { type: "text", text: "hello" });
		const work = await bridge.waitForWork(5000, { conversation: chat.id });
		assert.ok(work);
		const said = await respond({ work_id: work.workId, text: `Page two. [[${SLIDES}:1]] Made up. [[${NOTES}:9]]`, wait_seconds: 0 });
		assert.match(said, /Removed source marks that don't point at a passage of a class file: f_aaaaaaaaaaaa:9\./);
		assert.match(said, /turn_complete/);
		await settled(chat.id);
		assert.equal(lastTeacherText(chat.id), `Page two. [[${SLIDES}/p. 2/slides.pdf]] Made up. `);
	});

	it("tells the agent too when the next work item comes back", async () => {
		const chat = chatStore.createChat("Marks again");
		await handleChatInput(chat.id, { type: "text", text: "hello" });
		const work = await bridge.waitForWork(5000, { conversation: chat.id });
		assert.ok(work);
		const said = await respond({ work_id: work.workId, text: `Hmm. [[${GONE}:1]]`, tool_calls: [{ name: "ls", arguments: {} }], wait_seconds: 5 });
		assert.ok(said.startsWith(`Removed source marks that don't point at a passage of a class file: ${GONE}:1.`), said);
		assert.match(said, /"status":"work"/);
		const nextId = /"workId":"([^"]+)"/.exec(said)?.[1];
		assert.ok(nextId);
		assert.ok(bridge.respondToWork(nextId, { text: "Done." }, 0).ok);
		await settled(chat.id);
	});

	it("names the removed mark when the reply was nothing else", async () => {
		const chat = chatStore.createChat("Only a mark");
		await handleChatInput(chat.id, { type: "text", text: "hello" });
		const work = await bridge.waitForWork(5000, { conversation: chat.id });
		assert.ok(work);
		const said = await respond({ work_id: work.workId, text: `[[${GONE}:1]]`, wait_seconds: 0 });
		assert.match(said, /Removed source marks[^.]*f_cccccccccccc:1\. .*A reply needs text/);
		assert.ok(bridge.respondToWork(work.workId, { text: "Done." }, 0).ok);
		await settled(chat.id);
	});

	it("says nothing extra when every mark is good", async () => {
		const chat = chatStore.createChat("Clean marks");
		await handleChatInput(chat.id, { type: "text", text: "hello" });
		const work = await bridge.waitForWork(5000, { conversation: chat.id });
		assert.ok(work);
		const said = await respond({ work_id: work.workId, text: `Fine. [[${SLIDES}:1]]`, wait_seconds: 0 });
		assert.doesNotMatch(said, /Removed/);
		await settled(chat.id);
	});
});

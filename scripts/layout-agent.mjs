/**
 * layout-agent.mjs — the stand-in `claude` and `codex` that `npm run layout` puts first on the
 * throwaway home's PATH, so a Start in the check never runs a real agent. It draws a fixed
 * made-up screen, checks in to the app as godspeed's teacher (the start script runs it in the
 * godspeed folder, whose `.godspeed/target.mjs` says where the app is), then only waits. As the
 * folder's hooks do for a real agent, it names the chat it runs; a chat it went back to has a
 * line typed in it, so the app lists it.
 *
 * For Follow's slip a screen hands it a line as if the learner typed it in its terminal (the
 * shell takes keys only from a terminal that is shown and clicked, so the check writes the line to
 * the file named by LAYOUT_TYPED, which the stand-in removes once it has done it): "follow <space id>"
 * starts a new chat, as after /clear (the jobs it took and never answered stay with the old chat;
 * while it held them its calls would make no steps), hands the app that line as the prompt hook
 * does, which begins its round of work, reads the space as an agent would (four steps) and
 * searches the web for its homework, told as the folder's tool hook tells it;
 * "change" adds a homework to the space in that round;
 * "done" takes the homework away and stops as the Stop hook says, which ends the round. It waits
 * for no work while its round lasts, since its next wait would end the round.
 *
 * For the lesson's desk, "desk <space id>", typed while it holds the waiting lesson's reply, reads a
 * file of its own, told as the folder's tool hook tells it, then finds a passage of the space's
 * files and reads it: the desk lists the steps and lifts that file to the front of its stack.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const { target, terminalHeader } = await import(pathToFileURL(path.resolve(".godspeed/target.mjs")).href);

process.stdout.write("\x1b[2J\x1b[H \x1b[1mStand-in agent\x1b[0m\r\n\r\n Ask me about Lab Algebra, or type a task.\r\n\r\n > ");

let rpcId = 0;
/** One MCP request; the first text block of a tool's answer. */
const call = async (method, params) => {
	const { url, token } = target();
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, ...terminalHeader() },
		body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
	});
	if (!res.ok) process.exit(1);
	const text = await res.text();
	return text.startsWith("{") ? (JSON.parse(text).result?.content?.[0]?.text ?? "") : "";
};
const tool = (name, args) => call("tools/call", { name, arguments: args });

/** What the folder's hooks post: the chat started, a line typed to the agent, a tool it uses, a stop. */
const tell = async (route, body) => {
	const { url, token } = target();
	await fetch(new URL(route, url), { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...terminalHeader() }, body: JSON.stringify(body) });
};
const back = process.env.GODSPEED_RESUME;
await tell("/api/mcp/agent-event", { event: "session", session: back ?? "0f8fad5b-d9cb-469f-a165-70867728950e", agent: "claude" });
if (back) await tell("/api/mcp/line", { line: "why is slope rise over run" });

/** The round of work a screen asked for: settled once it is done, so the waits go on. */
let round = Promise.resolve();
let roundDone = () => {};
let space = "";
let homework = "";
const HOMEWORK = "Homework 7: slopes";
const inDays = (days) => new Date(Date.now() + days * 86_400_000).toLocaleDateString("sv");

async function typed(line) {
	const [word, arg] = line.trim().split(/\s+/);
	if (word === "follow" && arg) {
		space = arg;
		round = new Promise((done) => (roundDone = done));
		await tell("/api/mcp/agent-event", { event: "session", session: crypto.randomUUID(), agent: "claude" });
		await tell("/api/mcp/line", { line: "Update Lab Algebra" });
		await tool("list_spaces", {});
		await tool("read_space", { space_id: space });
		const found = await tool("search_space_files", { space_id: space, query: "graphing" });
		const passage = /f_[0-9a-f]{12}:\d+/.exec(found)?.[0];
		if (passage) await tool("read_passage", { space_id: space, passage_id: passage });
		await tell("/api/mcp/agent-event", { event: "tool", tool: "WebSearch", subject: "lab algebra homework 7" });
	} else if (word === "desk" && arg) {
		await tell("/api/mcp/agent-event", { event: "tool", tool: "Read", subject: "notes.md" });
		const found = await tool("search_space_files", { space_id: arg, query: "graphing" });
		const passage = /f_[0-9a-f]{12}:\d+/.exec(found)?.[0];
		if (passage) await tool("read_passage", { space_id: arg, passage_id: passage });
	} else if (word === "change") {
		await tool("add_space_deadline", { space_id: space, deadlines: [{ kind: "homework", name: HOMEWORK, date: inDays(6) }] });
		const { deadlines = [] } = JSON.parse((await tool("read_space", { space_id: space })) || "{}");
		homework = deadlines.find((d) => d.name === HOMEWORK)?.id ?? "";
	} else if (word === "done") {
		if (homework) await tool("remove_space_deadline", { space_id: space, deadline_id: homework });
		homework = "";
		await tell("/api/mcp/agent-event", { event: "stop" });
		roundDone();
	}
}

// The helper runs this file too; only the teacher is typed to.
const typedFile = process.env.GODSPEED_HELPER ? undefined : process.env.LAYOUT_TYPED;
let busy = false;
setInterval(async () => {
	if (busy || !typedFile || !fs.existsSync(typedFile)) return;
	busy = true;
	await typed(fs.readFileSync(typedFile, "utf8"));
	fs.rmSync(typedFile);
	busy = false;
}, 100);

await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "layout-agent", version: "1" } });
for (;;) {
	await round;
	await tool("wait_for_work", { timeout_seconds: 60 });
}

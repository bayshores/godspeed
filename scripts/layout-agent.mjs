/**
 * layout-agent.mjs — the stand-in `claude` and `codex` that `npm run layout` puts first on the
 * throwaway home's PATH, so a Start in the check never runs a real agent. It draws a fixed
 * made-up screen, checks in to the app as godspeed's teacher (the start script runs it in the
 * godspeed folder, whose `.godspeed/target.mjs` says where the app is), then only waits. As the
 * folder's hooks do for a real agent, it names the chat it runs; a chat it went back to has a
 * line typed in it, so the app lists it.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const { target, terminalHeader } = await import(pathToFileURL(path.resolve(".godspeed/target.mjs")).href);

process.stdout.write("\x1b[2J\x1b[H \x1b[1mStand-in agent\x1b[0m\r\n\r\n Ask me about Lab Algebra, or type a task.\r\n\r\n > ");

const call = async (id, method, params) => {
	const { url, token } = target();
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, ...terminalHeader() },
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
	});
	if (!res.ok) process.exit(1);
	await res.text();
};

/** What the folder's hooks post: the chat started, a line typed to the agent. */
const tell = async (route, body) => {
	const { url, token } = target();
	await fetch(new URL(route, url), { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...terminalHeader() }, body: JSON.stringify(body) });
};
const back = process.env.GODSPEED_RESUME;
await tell("/api/mcp/agent-event", { event: "session", session: back ?? "0f8fad5b-d9cb-469f-a165-70867728950e", agent: "claude" });
if (back) await tell("/api/mcp/line", { line: "why is slope rise over run" });

await call(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "layout-agent", version: "1" } });
for (let id = 2; ; id++) await call(id, "tools/call", { name: "wait_for_work", arguments: { timeout_seconds: 60 } });

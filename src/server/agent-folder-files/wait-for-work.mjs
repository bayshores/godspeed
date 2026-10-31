#!/usr/bin/env node
/**
 * The background waiter: waits for the next godspeed work item WITHOUT
 * the model polling. Claude Code runs it as a background task; the script
 * calls wait_for_work over and over itself (no tokens), and exits the
 * moment work arrives, printing the work item (see the output below). The
 * exit wakes the agent, which answers the item with `respond` as usual.
 *
 *   node wait-for-work.mjs [--lesson <lesson id>] [--max-minutes <n>]
 *
 * If the --lesson lesson is deleted, it waits for any work instead.
 *
 * Exit codes: 0 = work item printed; 2 = nothing arrived within
 * --max-minutes (default 120; run it again to keep waiting); 1 = godspeed
 * refused or is unreachable for over 5 minutes (the message says why).
 *
 * The item is CLAIMED for this agent (same as calling wait_for_work), so
 * read it and respond promptly — an unanswered claim is released to other
 * agents after 10 minutes. No dependencies — Node 18+.
 *
 * Images: the item's "[image N]" markers point at real images, which stdout
 * can't carry. They are saved as files and listed in "imageFiles" (in
 * order), so the agent can open them.
 *
 * It sends Claude Code's session id (CLAUDE_CODE_SESSION_ID), so godspeed
 * sends this session only the messages it hasn't seen yet.
 *
 * The output is the result's text blocks, a blank line between them: the
 * item's JSON on the first line, then its instructions and long message
 * texts ("[text N]") as plain text. A long item comes in pages: the first
 * line is then a short header ("pages"), page 1 of the item follows, and
 * the agent reads the other pages with the read_work tool.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NO_TOKEN, target } from "./target.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
};
let lessonId = flag("--lesson");
const agent = process.env.CLAUDE_CODE_SESSION_ID;
const maxMinutes = Number(flag("--max-minutes") ?? 120);
const deadline = Date.now() + (Number.isFinite(maxMinutes) && maxMinutes > 0 ? maxMinutes : 120) * 60_000;
const UNREACHABLE_LIMIT_MS = 5 * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(text) {
	process.stdout.write(`${text}\n`);
	process.exit(1);
}

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

/** Save the result's image blocks; returns their file paths. */
function saveImages(content, workId) {
	const blocks = (content ?? []).filter((c) => c?.type === "image" && typeof c.data === "string");
	if (!blocks.length) return [];
	const dir = fileURLToPath(new URL("./images/", import.meta.url));
	fs.mkdirSync(dir, { recursive: true });
	return blocks.map((block, i) => {
		const file = path.join(dir, `${String(workId).replace(/[^\w-]/g, "")}-${i + 1}.${EXTENSIONS[block.mimeType] ?? "png"}`);
		fs.writeFileSync(file, Buffer.from(block.data, "base64"));
		return file;
	});
}

/** The 2026-07-28 MCP version: every request says its version and client
 *  in _meta and headers. An app from before it answers 400; the waiter then
 *  sends the older shape for the rest of its run. */
const MCP_VERSION = "2026-07-28";
let modern = true;
const appVersion = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
const ENVELOPE = {
	"io.modelcontextprotocol/protocolVersion": MCP_VERSION,
	"io.modelcontextprotocol/clientCapabilities": {},
	// It waits for Claude Code, so godspeed names the agent Claude Code.
	"io.modelcontextprotocol/clientInfo": { name: "claude-code", version: appVersion },
};

/** One wait_for_work call. Returns the parsed tool result, or throws. */
async function waitOnce() {
	const { url, token } = target();
	if (!token) fail(NO_TOKEN);
	const meta = { ...(modern ? ENVELOPE : {}), ...(agent ? { "godspeed/agent": agent } : {}) };
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${token}`,
			...(modern ? { "mcp-protocol-version": MCP_VERSION, "mcp-method": "tools/call", "mcp-name": "wait_for_work" } : {}),
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: {
				name: "wait_for_work",
				arguments: { timeout_seconds: 55, ...(lessonId ? { lesson_id: lessonId } : {}) },
				...(Object.keys(meta).length ? { _meta: meta } : {}),
			},
		}),
	});
	const body = await res.text();
	if (res.status === 400 && modern) {
		modern = false;
		return waitOnce();
	}
	if (res.status === 401 || res.status === 403) {
		let detail = body;
		try {
			detail = JSON.parse(body).error ?? body;
		} catch {
			/* plain text */
		}
		fail(`godspeed refused the request (${res.status}): ${detail}`);
	}
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const rpc = JSON.parse(body);
	if (rpc.error) fail(`godspeed error: ${rpc.error.message}`);
	const text = rpc.result?.content?.[0]?.text ?? "";
	if (rpc.result?.isError && lessonId && text.startsWith("No lesson")) {
		// The learner deleted the lesson it stayed on: wait for any work instead.
		lessonId = undefined;
		return { item: { status: "idle" } };
	}
	if (rpc.result?.isError) fail(`wait_for_work failed: ${text}`);
	const item = JSON.parse(text);
	if (item.status === "work") {
		const imageFiles = saveImages(rpc.result?.content, item.workId);
		if (imageFiles.length) item.imageFiles = imageFiles;
	}
	const rest = (rpc.result?.content ?? []).slice(1).filter((c) => c?.type === "text").map((c) => c.text);
	return { item, rest };
}

let unreachableSince = null;
while (Date.now() < deadline) {
	let item, rest;
	try {
		({ item, rest } = await waitOnce());
		unreachableSince = null;
	} catch {
		// The app may be restarting: keep trying for a while.
		unreachableSince ??= Date.now();
		if (Date.now() - unreachableSince > UNREACHABLE_LIMIT_MS) fail(`Can't reach godspeed at ${target().url}. Is the app open?`);
		await sleep(5_000);
		continue;
	}
	if (item.status === "work") {
		process.stdout.write(`${[JSON.stringify(item), ...rest].join("\n\n")}\n`);
		process.exit(0);
	}
}
process.stdout.write(`No work arrived in ${maxMinutes} minutes. Run the waiter again to keep waiting.\n`);
process.exit(2);

#!/usr/bin/env node
/**
 * The waiter: Claude Code's Stop hook (asyncRewake) in the folder's
 * claude-settings.json. After each turn it waits in the background for the
 * next godspeed work item WITHOUT the model polling: it calls
 * wait_for_work over and over itself (no tokens). When an item arrives it
 * writes the item to stderr and exits 2, which wakes the agent with the
 * item as a message of its own; the agent answers it with `respond`.
 *
 * It reads the hook's JSON from stdin for the session id, so godspeed
 * sends this session only the messages it hasn't seen yet. The helper's
 * start script sets GODSPEED_HELPER=1: the waiter then takes the
 * background jobs, and lesson turns only while the teacher session
 * compacts its context.
 *
 * Exit codes: 2 = a work item, or a failure the agent must tell the user
 * (godspeed refused or was unreachable for over 5 minutes, or its token is
 * missing), on stderr; 0 = nothing to say: no work in 2 hours (just under
 * the hook's timeout), the terminal was closed in godspeed, another waiter
 * already waits for this session, or this failure was already reported.
 * godspeed nudges a quiet teacher in its terminal when work waits, and the
 * turn that answers starts a new waiter.
 *
 * One waiter per session: every turn's end starts one, also while an
 * earlier one still waits (the learner typed to the agent meanwhile). A
 * lock file per session in the temp folder holds the waiting one's pid.
 *
 * The item is CLAIMED for this agent (same as calling wait_for_work). An
 * unanswered claim is released to other agents after 10 minutes. This
 * agent gets it back at once one time, and again after it lost its
 * context; after that only when the claim runs out.
 *
 * Images: the item's "[image N]" markers point at real images, which text
 * can't carry. They are saved as files and listed in "imageFiles" (in
 * order), so the agent can open them.
 *
 * The output is the result's text blocks, a blank line between them: the
 * item's JSON on the first line, then its instructions and long message
 * texts ("[text N]") as plain text. A long item comes in pages: the first
 * line is then a short header ("pages"), page 1 of the item follows, and
 * the agent reads the other pages with the read_work tool.
 * No dependencies; Node 18+.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NO_TOKEN, target, terminalHeader } from "./target.mjs";

const MAX_WAIT_MS = 120 * 60_000;
const UNREACHABLE_LIMIT_MS = 5 * 60_000;
// The hook's timeout: Claude Code has ended a waiter by then, so an older lock is stale even if
// its pid now belongs to another program.
const LOCK_LIFE_MS = 7260_000;
// godspeed's answer when the app terminal this agent runs in was closed.
const TERMINAL_CLOSED = "This terminal was closed in godspeed.";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let input = "";
if (!process.stdin.isTTY) for await (const chunk of process.stdin) input += chunk;
let agent;
try {
	agent = JSON.parse(input).session_id;
} catch {
	/* not run as a hook */
}
if (typeof agent !== "string" || !agent) {
	// A chat from an older godspeed still runs the waiter itself.
	process.stdout.write("godspeed was updated. Close this window and open your agent from godspeed again.\n");
	process.exit(1);
}
const helper = process.env.GODSPEED_HELPER === "1";

const dir = path.join(os.tmpdir(), "godspeed-waiters");
const base = path.join(dir, agent.replace(/[^\w-]/g, "_"));
const lock = `${base}.pid`;
const failed = `${base}.failed`;

const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (err) {
		return err.code === "EPERM";
	}
};

/** Takes this session's lock, unless a live waiter holds it. A temp folder it can't write
 *  leaves it waiting unguarded: two waiters beat none. */
function takeLock() {
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch {
		return true;
	}
	for (let tries = 0; tries < 2; tries++) {
		try {
			fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
			return true;
		} catch (err) {
			if (err.code !== "EEXIST") return true;
		}
		let pid = NaN;
		let since = 0;
		try {
			pid = Number(fs.readFileSync(lock, "utf8"));
			since = fs.statSync(lock).mtimeMs;
		} catch {
			/* it was just removed */
		}
		if (Number.isInteger(pid) && pid > 0 && alive(pid) && Date.now() - since < LOCK_LIFE_MS) return false;
		// Its waiter ended without removing it (killed): take it over.
		fs.rmSync(lock, { force: true });
	}
	return false;
}

if (!takeLock()) process.exit(0);
process.on("exit", () => {
	try {
		if (fs.readFileSync(lock, "utf8") === String(process.pid)) fs.rmSync(lock);
	} catch {
		/* already gone */
	}
});

const readFailed = () => {
	try {
		return fs.readFileSync(failed, "utf8");
	} catch {
		return null;
	}
};

/** Wakes the agent with `text` once it is written (a pipe may take it in parts). Never settles. */
function wake(text) {
	process.stderr.write(`${text}\n`, () => process.exit(2));
	return new Promise(() => {});
}

/** Wakes the agent with the failure, once: the turn that reports it ends in another waiter. */
function fail(text) {
	if (readFailed() === text) process.exit(0);
	try {
		fs.writeFileSync(failed, text);
	} catch {
		/* no temp folder: it is told each time */
	}
	return wake(text);
}

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg" };

/** Save the result's image blocks; returns their file paths. */
function saveImages(content, workId) {
	const blocks = (content ?? []).filter((c) => c?.type === "image" && typeof c.data === "string");
	if (!blocks.length) return [];
	const images = fileURLToPath(new URL("./images/", import.meta.url));
	fs.mkdirSync(images, { recursive: true });
	return blocks.map((block, i) => {
		const file = path.join(images, `${String(workId).replace(/[^\w-]/g, "")}-${i + 1}.${EXTENSIONS[block.mimeType] ?? "png"}`);
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
	if (!token) return fail(NO_TOKEN);
	const meta = { ...(modern ? ENVELOPE : {}), "godspeed/agent": agent };
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			authorization: `Bearer ${token}`,
			...terminalHeader(),
			...(modern ? { "mcp-protocol-version": MCP_VERSION, "mcp-method": "tools/call", "mcp-name": "wait_for_work" } : {}),
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "wait_for_work", arguments: { timeout_seconds: 55, ...(helper ? { helper: true } : {}) }, _meta: meta },
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
		if (detail === TERMINAL_CLOSED) process.exit(0);
		return fail(`godspeed refused the request (${res.status}): ${detail}`);
	}
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const rpc = JSON.parse(body);
	if (rpc.error) return fail(`godspeed error: ${rpc.error.message}`);
	const text = rpc.result?.content?.[0]?.text ?? "";
	if (rpc.result?.isError && text === TERMINAL_CLOSED) process.exit(0);
	if (rpc.result?.isError) return fail(`wait_for_work failed: ${text}`);
	fs.rmSync(failed, { force: true });
	const item = JSON.parse(text);
	if (item.status === "work") {
		const imageFiles = saveImages(rpc.result?.content, item.workId);
		if (imageFiles.length) item.imageFiles = imageFiles;
	}
	const rest = (rpc.result?.content ?? []).slice(1).filter((c) => c?.type === "text").map((c) => c.text);
	return { item, rest };
}

const deadline = Date.now() + MAX_WAIT_MS;
let unreachableSince = null;
while (Date.now() < deadline) {
	let item, rest;
	try {
		({ item, rest } = await waitOnce());
		unreachableSince = null;
	} catch {
		// The app may be restarting: keep trying for a while.
		unreachableSince ??= Date.now();
		if (Date.now() - unreachableSince > UNREACHABLE_LIMIT_MS) await fail(`Can't reach godspeed at ${target().url}. Is the app open?`);
		await sleep(5_000);
		continue;
	}
	if (item.status === "work") {
		await wake([JSON.stringify(item), ...rest].join("\n\n"));
	}
}
process.exit(0);

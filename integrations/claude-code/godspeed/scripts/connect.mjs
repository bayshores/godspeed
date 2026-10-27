#!/usr/bin/env node
/**
 * godspeed MCP connector: a stdio MCP server that forwards every message
 * to the running godspeed app (its /api/mcp endpoint), adding the access
 * token from the app's data folder. No dependencies — Node 18+.
 *
 * Where it looks (first match wins):
 *   URL:   $GODSPEED_MCP_URL → <data>/mcp-endpoint.json → http://127.0.0.1:47613/api/mcp
 *   Token: $GODSPEED_MCP_TOKEN → <data>/mcp-token
 *   <data>: $GODSPEED_DATA_DIR → the desktop app's data folder for this OS
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

const DEFAULT_URL = "http://127.0.0.1:47613/api/mcp";

function dataDir() {
	if (process.env.GODSPEED_DATA_DIR) return process.env.GODSPEED_DATA_DIR;
	const home = os.homedir();
	if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "godspeed", "data");
	if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), "godspeed", "data");
	return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "godspeed", "data");
}

function readText(file) {
	try {
		return fs.readFileSync(file, "utf8").trim();
	} catch {
		return null;
	}
}

/** Read fresh on every message: the app may restart on a new port, or the token may be rotated. */
function target() {
	const dir = dataDir();
	let url = process.env.GODSPEED_MCP_URL;
	if (!url) {
		try {
			url = JSON.parse(readText(path.join(dir, "mcp-endpoint.json")) ?? "null")?.url;
		} catch {
			url = undefined;
		}
	}
	return { url: url || DEFAULT_URL, token: process.env.GODSPEED_MCP_TOKEN || readText(path.join(dir, "mcp-token")) };
}

function send(message) {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function replyError(id, text) {
	if (id === undefined || id === null) return;
	send({ jsonrpc: "2.0", id, error: { code: -32000, message: text } });
}

async function forward(line) {
	let message;
	try {
		message = JSON.parse(line);
	} catch {
		return;
	}
	const { url, token } = target();
	if (!token) {
		replyError(message.id, "godspeed access is off. In the godspeed app open Settings → Outside agents and turn on outside-agent access.");
		return;
	}
	let res;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				authorization: `Bearer ${token}`,
			},
			body: line,
		});
	} catch {
		replyError(message.id, `Can't reach godspeed at ${url}. Is the app open?`);
		return;
	}
	const body = await res.text();
	if (!res.ok && res.status !== 202) {
		let detail = body;
		try {
			detail = JSON.parse(body).error ?? body;
		} catch {
			/* plain text */
		}
		replyError(message.id, `godspeed refused the request (${res.status}): ${detail}`);
		return;
	}
	if (!body.trim()) return; // notifications get an empty 202
	try {
		const parsed = JSON.parse(body);
		for (const m of Array.isArray(parsed) ? parsed : [parsed]) send(m);
	} catch {
		replyError(message.id, "godspeed sent an unreadable reply.");
	}
}

// Messages are handled concurrently: a long wait_for_work must not block others.
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
	if (line.trim()) void forward(line);
});

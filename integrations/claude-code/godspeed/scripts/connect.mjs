#!/usr/bin/env node
/**
 * godspeed MCP connector: a stdio MCP server that forwards every message
 * to the running godspeed app (its /api/mcp endpoint), adding the access
 * token from the app's data folder (found by target.mjs). No
 * dependencies — Node 18+.
 */
import readline from "node:readline";
import { ACCESS_OFF, target } from "./target.mjs";

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
		replyError(message.id, ACCESS_OFF);
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

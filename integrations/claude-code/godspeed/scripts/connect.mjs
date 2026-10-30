#!/usr/bin/env node
/**
 * godspeed MCP connector: a stdio MCP server that forwards every message
 * to the running godspeed app (its /api/mcp endpoint), adding the access
 * token from the app's data folder (found by target.mjs). Tool calls carry
 * Claude Code's session id, so godspeed sends this session only the
 * messages it hasn't seen yet. No dependencies — Node 18+.
 */
import readline from "node:readline";
import { NO_TOKEN, target } from "./target.mjs";

const agent = process.env.CLAUDE_CODE_SESSION_ID;

/** Request id → the request still waiting for godspeed's answer. */
const inFlight = new Map();

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
	// Closing a cancelled call's request makes godspeed stop its wait, so it
	// doesn't take a work item for an answer nobody reads.
	if (message?.method === "notifications/cancelled") inFlight.get(message.params?.requestId)?.abort();
	if (message?.method === "tools/call" && agent) {
		message.params = { ...message.params, _meta: { ...message.params?._meta, "godspeed/agent": agent } };
	}
	const { url, token } = target();
	if (!token) {
		replyError(message.id, NO_TOKEN);
		return;
	}
	const controller = new AbortController();
	if (message.id !== undefined) inFlight.set(message.id, controller);
	let res, body;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(message),
			signal: controller.signal,
		});
		body = await res.text();
	} catch {
		if (!controller.signal.aborted) replyError(message.id, `Can't reach godspeed at ${url}. Is the app open?`);
		return;
	} finally {
		if (inFlight.get(message.id) === controller) inFlight.delete(message.id);
	}
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

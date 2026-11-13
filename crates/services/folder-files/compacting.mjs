#!/usr/bin/env node
/**
 * Claude Code hook (PreCompact): this session is about to compact its
 * context, so godspeed lets the helper answer its lesson and Talk
 * turns meanwhile. Reads the hook's JSON from stdin and tells the app the
 * session id. Prints nothing (Claude Code would read it as compaction
 * instructions) and always exits 0 (exit 2 would stop the compaction).
 * No dependencies — Node 18+.
 */
import { target } from "./target.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
	const agent = JSON.parse(input).session_id;
	const { url, token } = target();
	if (typeof agent === "string" && token) {
		await fetch(`${url.replace(/\/$/, "")}/compacting`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
			body: JSON.stringify({ agent }),
			signal: AbortSignal.timeout(3000),
		});
	}
} catch {
	/* the app is closed or the input was unreadable: compaction goes on */
}

#!/usr/bin/env node
/**
 * Claude Code hook: this session lost its context (it compacted, or /clear
 * ended it), so godspeed sends its next work items in full again. Reads
 * the hook's JSON from stdin and tells the app the session id. Prints
 * nothing and never fails: if godspeed is closed there is nothing to reset.
 * No dependencies — Node 18+.
 */
import { target } from "./target.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
	const agent = JSON.parse(input).session_id;
	const { url, token } = target();
	if (typeof agent === "string" && token) {
		await fetch(`${url.replace(/\/$/, "")}/forget`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
			body: JSON.stringify({ agent }),
			signal: AbortSignal.timeout(3000),
		});
	}
} catch {
	/* godspeed closed or the input was unreadable */
}

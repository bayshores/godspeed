#!/usr/bin/env node
/**
 * Claude Code and Codex hook (Stop, and Notification or PermissionRequest):
 * tells godspeed the agent in its terminal stopped, or waits for the
 * learner's say, so the window can play its sound while the learner looks
 * away. It prints nothing, so it never decides anything for the agent.
 * No dependencies — Node 18+.
 */
import { target, terminalHeader } from "./target.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
	const hook = JSON.parse(input);
	const event = hook.hook_event_name === "Stop" ? "stop" : "needs";
	const { url, token } = target();
	const terminal = terminalHeader();
	if (token && terminal["x-godspeed-terminal"]) {
		await fetch(`${url.replace(/\/$/, "")}/agent-event`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...terminal },
			body: JSON.stringify({ event }),
			signal: AbortSignal.timeout(3000),
		});
	}
} catch {
	/* the app is closed or the input was unreadable: nothing to tell */
}

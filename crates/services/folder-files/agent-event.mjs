#!/usr/bin/env node
/**
 * Claude Code and Codex hook (SessionStart, Stop, and Notification or
 * PermissionRequest): tells godspeed which chat the agent in its terminal
 * runs (so the learner can go back to it), that it stopped, or that it
 * waits for the learner's say (so the window can play its sound while the
 * learner looks away). It prints nothing, so it never decides anything for
 * the agent.
 * No dependencies — Node 18+.
 */
import { target, terminalHeader } from "./target.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
	const hook = JSON.parse(input);
	const name = hook.hook_event_name;
	const event = name === "SessionStart" ? "session" : name === "Stop" ? "stop" : "needs";
	// Each agent keeps its chats in its own folder (~/.claude, ~/.codex).
	const agent = /[\\/]\.codex[\\/]/.test(hook.transcript_path ?? "") ? "codex" : "claude";
	const { url, token } = target();
	const terminal = terminalHeader();
	if (token && terminal["x-godspeed-terminal"]) {
		await fetch(`${url.replace(/\/$/, "")}/agent-event`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...terminal },
			body: JSON.stringify(event === "session" ? { event, session: hook.session_id, agent } : { event }),
			signal: AbortSignal.timeout(3000),
		});
	}
} catch {
	/* the app is closed or the input was unreadable: nothing to tell */
}

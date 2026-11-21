#!/usr/bin/env node
/**
 * Claude Code and Codex hook (UserPromptSubmit): a line the learner typed
 * in godspeed's terminal while a lesson or a cheat sheet is on screen goes
 * to that page, where the agent's answer goes too, and the hook stops it
 * here. Any other line (an agent outside godspeed's terminals, no page on
 * screen, the app closed) reaches the agent as usual: the hook prints
 * nothing then. No dependencies — Node 18+.
 */
import { target, terminalHeader } from "./target.mjs";

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
	const hook = JSON.parse(input);
	const { url, token } = target();
	const terminal = terminalHeader();
	// The waiter's wake comes through this hook too (Claude Code wraps it this way): nobody typed it.
	const typed = typeof hook.prompt === "string" && !hook.prompt.startsWith("<task-notification>");
	if (typed && token && terminal["x-godspeed-terminal"]) {
		const res = await fetch(`${url.replace(/\/$/, "")}/line`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...terminal },
			body: JSON.stringify({ line: hook.prompt }),
			signal: AbortSignal.timeout(5000),
		});
		const { sent } = res.ok ? await res.json() : {};
		if (typeof sent === "string") {
			const block = { decision: "block", reason: `Sent to your ${sent}.` };
			// Codex refuses fields it doesn't know; Claude Code then leaves the line out of its note.
			const codex = "turn_id" in hook;
			process.stdout.write(JSON.stringify(codex ? block : { ...block, hookSpecificOutput: { hookEventName: "UserPromptSubmit", suppressOriginalPrompt: true } }));
		}
	}
} catch {
	/* the app is closed or the input was unreadable: the agent reads the line */
}

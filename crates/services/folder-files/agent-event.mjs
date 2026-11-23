#!/usr/bin/env node
/**
 * Claude Code and Codex hook (SessionStart, Stop, PreToolUse, and Notification
 * or PermissionRequest): tells godspeed which chat the agent in its terminal
 * runs (so the learner can go back to it), that it stopped, which of its own
 * tools it uses (Follow's slip shows it), or that it waits for the learner's
 * say (so the window can play its sound while the learner looks away). It
 * prints nothing, so it never decides anything for the agent.
 * No dependencies — Node 18+.
 */
import { target, terminalHeader } from "./target.mjs";

/** A subject is cut to this many characters here, before it leaves the agent. */
const SUBJECT_MAX = 80;

const text = (value) => (typeof value === "string" ? value : "");

/**
 * What one of the agent's own tools is about, cut so no folder, page address,
 * query or command leaves the agent: a file's name, a site's name, the web
 * search's words, or a search's words when they are plain words.
 */
function subjectOf(tool, input) {
	let subject = "";
	if (tool === "WebSearch") subject = text(input.query);
	if (tool === "Read") subject = text(input.file_path).split(/[\\/]/).pop() ?? "";
	if (tool === "Grep" && /^[\p{L}\p{N} ]+$/u.test(text(input.pattern))) subject = text(input.pattern);
	if (tool === "WebFetch") {
		try {
			subject = new URL(text(input.url)).hostname;
		} catch {
			subject = "";
		}
	}
	const one = subject.replace(/\s+/g, " ").trim();
	return one ? [...one].slice(0, SUBJECT_MAX).join("") : undefined;
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
	const hook = JSON.parse(input);
	const name = hook.hook_event_name;
	// The tool hook fires on every listed tool, so it must never fall through to "needs".
	const event = name === "SessionStart" ? "session" : name === "Stop" ? "stop" : name === "PreToolUse" ? "tool" : "needs";
	// Each agent keeps its chats in its own folder (~/.claude, ~/.codex).
	const agent = /[\\/]\.codex[\\/]/.test(hook.transcript_path ?? "") ? "codex" : "claude";
	const body =
		event === "session"
			? { event, session: hook.session_id, agent }
			: event === "tool"
				? { event, tool: text(hook.tool_name), subject: subjectOf(hook.tool_name, hook.tool_input ?? {}) }
				: { event };
	const { url, token } = target();
	const terminal = terminalHeader();
	if (token && terminal["x-godspeed-terminal"]) {
		await fetch(`${url.replace(/\/$/, "")}/agent-event`, {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...terminal },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(3000),
		});
	}
} catch {
	/* the app is closed or the input was unreadable: nothing to tell */
}

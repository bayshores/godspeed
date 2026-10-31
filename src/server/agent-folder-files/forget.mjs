#!/usr/bin/env node
/**
 * Claude Code hook: this session lost its context (it compacted, or /clear
 * ended it), so godspeed sends its next work items in full again. Reads
 * the hook's JSON from stdin and tells the app the session id. godspeed
 * saves what each session has seen in <data>/agent-seen.json, so when the
 * app is closed this hook removes the session from that file itself.
 * Prints nothing and never fails. No dependencies — Node 18+.
 */
import fs from "node:fs";
import path from "node:path";
import { dataDir, target } from "./target.mjs";

/** Drop the session from the closed app's saved file (temp file + rename,
 *  the same shape the app writes). */
function forgetSaved(agent) {
	const file = path.join(dataDir(), "agent-seen.json");
	const saved = JSON.parse(fs.readFileSync(file, "utf8"));
	if (!saved?.agents?.[agent]) return;
	delete saved.agents[agent];
	const tmp = `${file}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, JSON.stringify(saved, null, "\t"));
	fs.renameSync(tmp, file);
}

let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
	const hook = JSON.parse(input);
	const agent = hook.session_id;
	const { url, token } = target();
	if (typeof agent === "string" && token) {
		try {
			await fetch(`${url.replace(/\/$/, "")}/forget`, {
				method: "POST",
				headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
				// After /clear the session is gone, so the app frees the work it held.
				body: JSON.stringify({ agent, cleared: hook.hook_event_name === "SessionEnd" }),
				signal: AbortSignal.timeout(3000),
			});
		} catch (err) {
			// A timeout means the app is running but slow: it still forgets, and
			// writing its file now could race its own writes.
			if (err?.name !== "TimeoutError") forgetSaved(agent);
		}
	}
} catch {
	/* the input or the saved file was unreadable */
}

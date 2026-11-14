/**
 * "Start Claude Code" (the godspeed folder): which agent the button starts,
 * and, outside the desktop app, the log under it. Pure: exported for tests.
 */

import type { FolderAgent, OldSetup, StartCommands } from "@/shared/core";

/** The button's menu: an agent the app starts, or the setup for any other MCP app. */
export type LaunchChoice = FolderAgent | "other";

export const AGENT_LABEL: Record<FolderAgent, string> = { claude: "Claude Code", codex: "Codex" };

/** What the server says about the folder (GET /api/agent-folder). */
export interface FolderView {
	folder: string;
	short: string;
	exists: boolean;
	commands: Record<FolderAgent, string>;
	startCommands: StartCommands;
	oldSetup: OldSetup;
}

/** A click on the button outside the desktop app: the folder is made,
 *  then the learner runs the command. */
export interface Launch {
	agent: FolderAgent;
	/** Only the helper was asked for. */
	helperOnly?: true;
	/** Running, done, or failed with a message. */
	made: "wait" | "done" | { error: string };
}

export interface LogLine {
	text: string;
	state: "done" | "wait" | "error" | "note";
}

/** The log's lines for a launch and the live agent status. */
export function logLines(launch: Launch, status: { connected: boolean; teaching: boolean; helperHere: boolean }, short: string): LogLine[] {
	const name = AGENT_LABEL[launch.agent];
	if (typeof launch.made === "object") return [{ text: launch.made.error, state: "error" }];
	if (launch.made === "wait") return [{ text: `Making ${short}…`, state: "wait" }];
	const lines: LogLine[] = [
		{ text: `Made ${short}`, state: "done" },
		{ text: "Copy the command and run it in your terminal", state: status.connected ? "done" : "wait" },
	];
	if (launch.helperOnly) return [...lines, status.helperHere ? { text: "Started the helper", state: "done" } : { text: "Waiting for the helper to start…", state: "wait" }];
	if (!status.connected) {
		lines.push({ text: `Waiting for ${name} to start…`, state: "wait" });
		lines.push({ text: `If ${name} asks whether to trust the folder, choose Yes.`, state: "note" });
		return lines;
	}
	lines.push({ text: `Started ${name}`, state: "done" });
	lines.push(status.teaching ? { text: `${name} is teaching`, state: "done" } : { text: `Waiting for ${name} to start teaching…`, state: "wait" });
	return lines;
}

/** The agent "Start Claude Code" starts: the last one started here, else Claude Code. */
export function rememberedAgent(saved: string | null): FolderAgent {
	return saved === "codex" ? "codex" : "claude";
}

/** What is left of the old setup, one entry each: `short` for Settings,
 *  `full` for the notice. Empty when nothing is left. */
export function oldSetupLines(old: OldSetup, short: string): { short: string; full: string }[] {
	return [
		...(old.plugin
			? [{ short: "Old godspeed plugin found.", full: `The old godspeed plugin is still on this computer. It lets Claude Code chats outside ${short} use godspeed.` }]
			: []),
		...(old.codex
			? [{ short: "Old godspeed entry found in Codex's settings.", full: `An old godspeed entry is still in Codex's settings. It lets Codex chats outside ${short} use godspeed.` }]
			: []),
	];
}

/** After Remove: which open chats still have it until they restart. */
export function removedNote(removed: OldSetup): string {
	const chats = [removed.plugin && "Claude Code", removed.codex && "Codex"].filter(Boolean).join(" and ");
	return `Removed. Restart any open ${chats} chats to finish.`;
}

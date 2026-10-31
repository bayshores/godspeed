/**
 * "Open Claude Code" (the godspeed folder): which agent the button opens,
 * and the live log under it. Pure — exported for tests.
 */

import type { FolderAgent } from "@/core";

/** The button's menu: an agent the app opens, or the setup for any other MCP app. */
export type LaunchChoice = FolderAgent | "other";

export const AGENT_LABEL: Record<FolderAgent, string> = { claude: "Claude Code", codex: "Codex" };

/** What the server says about the folder (GET /api/agent-folder). */
export interface FolderView {
	folder: string;
	short: string;
	exists: boolean;
	commands: Record<FolderAgent, string>;
}

/** One step of a launch: running, done, or failed with a message. */
export type StepState = "wait" | "done" | { error: string };

/** A click on the button: the folder being made, then the terminal
 *  opening ("manual" outside the desktop app: the learner runs the command). */
export interface Launch {
	agent: FolderAgent;
	made: StepState;
	opened?: StepState | "manual";
}

export interface LogLine {
	text: string;
	state: "done" | "wait" | "error" | "note";
}

/** The log's lines for a launch and the live agent status. */
export function logLines(launch: Launch, status: { connected: boolean; teaching: boolean }, short: string, mac: boolean): LogLine[] {
	const name = AGENT_LABEL[launch.agent];
	const terminal = mac ? "Terminal" : "a terminal";
	const lines: LogLine[] = [];
	if (typeof launch.made === "object") return [{ text: launch.made.error, state: "error" }];
	lines.push(launch.made === "done" ? { text: `Made ${short}`, state: "done" } : { text: `Making ${short}…`, state: "wait" });
	const opened = launch.opened;
	if (opened === undefined) return lines;
	if (typeof opened === "object") return [...lines, { text: opened.error, state: "error" }];
	if (opened === "manual") lines.push({ text: "Copy the command and run it in your terminal", state: status.connected ? "done" : "wait" });
	else lines.push(opened === "done" ? { text: `Opened ${terminal} in it`, state: "done" } : { text: `Opening ${terminal}…`, state: "wait" });
	if (opened === "wait") return lines;
	if (!status.connected) {
		lines.push({ text: `Waiting for ${name} to start…`, state: "wait" });
		lines.push({ text: `If ${name} asks whether to trust the folder, choose Yes.`, state: "note" });
		return lines;
	}
	lines.push({ text: `Started ${name}`, state: "done" });
	lines.push(status.teaching ? { text: `${name} is teaching`, state: "done" } : { text: `Waiting for ${name} to start teaching…`, state: "wait" });
	return lines;
}

/** The agent the sidebar's button opens: the last one opened here, else Claude Code. */
export function rememberedAgent(saved: string | null): FolderAgent {
	return saved === "codex" ? "codex" : "claude";
}

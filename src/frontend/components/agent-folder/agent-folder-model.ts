/**
 * The godspeed folder in words: the agents' names, what the server says
 * about the folder, and the old setup left on the computer. Pure.
 */

import type { FolderAgent, OldSetup, StartCommands } from "@/shared/core";

export const AGENT_LABEL: Record<FolderAgent, string> = { claude: "Claude Code", codex: "Codex" };

/** What the server says about the folder (GET /api/agent-folder). */
export interface FolderView {
	folder: string;
	short: string;
	exists: boolean;
	commands: Record<FolderAgent, string>;
	startCommands: StartCommands;
	oldSetup: OldSetup;
	/** The agent the learner picked to run the lessons; null until they pick one (lessons run on Claude Code then). */
	agent: FolderAgent | null;
	/** The model each agent's new chats and lessons start on, where the learner picked one. */
	model: Partial<Record<FolderAgent, string>>;
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

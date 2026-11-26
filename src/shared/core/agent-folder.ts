/**
 * The godspeed folder (default ~/godspeed), where the agent works: its
 * agent, the old setups still on the computer and the learner's own start
 * commands. Pure.
 */

export type FolderAgent = "claude" | "codex";

export const isFolderAgent = (v: unknown): v is FolderAgent => v === "claude" || v === "codex";

/** The old ways godspeed loaded outside the folder that are still set up:
 *  the retired Claude Code plugin, and the block once pasted into Codex's config. */
export interface OldSetup {
	plugin: boolean;
	codex: boolean;
}

/** The learner's own command for an agent, run in place of `claude` or
 *  `codex`: a launcher such as "standardcompute launch claude --". */
export type StartCommands = Partial<Record<FolderAgent, string>>;


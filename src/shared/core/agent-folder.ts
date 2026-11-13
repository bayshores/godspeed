/**
 * The godspeed folder (default ~/godspeed): the one folder an outside agent
 * is opened in. It holds the agent's instructions (CLAUDE.md, AGENTS.md),
 * the connection to the app (.mcp.json for Claude Code, command-line flags
 * for Codex) and, in .godspeed/, the scripts and the start scripts the
 * app's "Open Claude Code" button runs. Pure: the generated file contents
 * and commands. The server writes them.
 */

export type FolderAgent = "claude" | "codex";

/** What a start script starts: an agent as the teacher, or as the helper,
 *  which does the background jobs in a second window. */
export type StartTarget = FolderAgent | `${FolderAgent}-helper`;

/** The old ways godspeed loaded outside the folder that are still set up:
 *  the retired Claude Code plugin, and the block once pasted into Codex's config. */
export interface OldSetup {
	plugin: boolean;
	codex: boolean;
}

/** The learner's own command for an agent, run in place of `claude` or
 *  `codex`: a launcher such as "standardcompute launch claude --". */
export type StartCommands = Partial<Record<FolderAgent, string>>;


/**
 * The server's events: the Rust server sends each as an SSE frame on
 * GET /api/events. They carry the fact, never the data: the window fetches
 * the truth on receipt, so a reconnect heals by refetching.
 *
 * Pure types, no imports.
 */

/** What an outside agent changed: every MCP tool
 *  that changes something reports one, so the window can show it. */
export interface AgentAction {
	id: string;
	/** ISO time. */
	at: string;
	/** The agent's display name ("Claude Code"). */
	agent: string;
	/** Short and plain: "Adding HW 5", "Reading syllabus.pdf". */
	label: string;
	spaceId: string | null;
	/** The thing that changed, as tagged in the page (data-teacher-target). */
	target: { kind: "deadline" | "file" | "space" | "lesson"; id: string } | null;
	/** The app path where it shows ("/", "/space", "/space/files", "/chat/<id>"). */
	page: string;
	/** The target was removed (it fades out after the visit). */
	removed?: true;
	/** The learner asked for it (a lesson they started): the
	 *  window goes there even with Follow off. */
	open?: true;
	/** godspeed's own space check made it: listed, never visited. */
	background?: true;
}

/** The `agent` of the app's own entries in that list (a linked folder's
 *  new files): not an agent, so the teacher never flies to them. */
const APP_SOURCE = "godspeed";

/** The `agent` of what the learner did in the app (answers, deadlines). */
const LEARNER_SOURCE = "you";

/** An outside agent's entry: the only kind Follow and the teacher go to. */
export function isAgentEntry(action: AgentAction): boolean {
	return action.agent !== APP_SOURCE && action.agent !== LEARNER_SOURCE;
}

/** The full event vocabulary. */
export interface ServerEvents {
	/** A teach turn began server-side (beginTurn) — client-initiated sends,
	 *  wake turns, other-tab turns: every origin rides the same event. */
	"turn-started": { chatId: string };
	/** A turn settled (endTurn — AFTER persistTurn, so any fetch triggered
	 *  by this event reads a durable record). */
	"turn-settled": { chatId: string };
	/** A job record changed (dispatch, progress, settle, abort, recovery).
	 *  chatId when known — consumers that own one chat filter on it. */
	"jobs-changed": { chatId?: string };
	/** An extraction run changed phase (activity dock). */
	"activity-changed": Record<string, never>;
	/** The session list changed (create, delete, title). */
	"chats-changed": Record<string, never>;
	/** The space list or a space record changed (create, edit, close,
	 *  delete, files). */
	"spaces-changed": Record<string, never>;
	/** The outside agent's status changed: it checked in, went quiet, or
	 *  a request started or stopped waiting for it. */
	"agent-changed": Record<string, never>;
	/** A chat's record changed WITHOUT a turn (the silent dismissal write).
	 *  Same notify-then-fetch contract as the turn events: open views of
	 *  the chat refetch and adopt the durable record. */
	"record-changed": { chatId: string };
	/** An outside agent changed something (the payload is the action). */
	"agent-action": AgentAction;
	/** A teaching rule was saved, undone or edited. `saved` when an outside
	 *  agent saved one from the terminal (the window shows a notice). */
	"rules-changed": { saved?: { text: string; where: { area: string } | { spaceId: string }; label: string; agent: string } };
	/** A space's linked folder brought new files (the window shows a notice). */
	"files-added": { spaceId: string; files: { id: string; name: string; kind: "study" | "info" }[] };
	/** Files left a space's linked folder (the window shows a notice). */
	"files-removed": { spaceId: string; files: { id: string; name: string }[] };
	/** A line the learner typed in the agent's terminal for the page on screen (a lesson, a cheat sheet). */
	"terminal-line": { id: number; text: string; attachments: { name: string; mimeType: string; data: string }[] };
	/** The vault's setting changed, or a note godspeed writes in it was written, found again or marked removed. */
	"vault-notes-changed": Record<string, never>;
	/** The teacher's round of work began, gained a step or ended (GET /api/teacher-work). */
	"teacher-work": Record<string, never>;
	/** A lesson's running turn began, gained a step, a plan or a question to allow, or ended (GET /api/chats/{id}/work). `asking`: a question to allow waits. */
	"lesson-work": { chatId: string; asking: boolean };
	/** A check of the picked agent (GET /api/agent/health) began or ended, or its sign-in started, ended or failed. */
	"agent-health": Record<string, never>;
	/** The picked agent's update (POST /api/agent/update) started, printed a line, finished or failed. `command` is what it runs, which the learner can run themselves. */
	"agent-update": { state: "running" | "done" | "failed"; line: string | null; command: string };
	/** The teacher in godspeed's terminal finished answering the learner there ("done") or stopped to ask them something ("needs"). */
	"agent-event": { kind: "done" | "needs" };
	/** A deadline's cheat sheet or its agent request changed. */
	"cheat-sheet-changed": { deadlineId: string };
	/** A space's mocks or one of their agent requests changed. */
	"mocks-changed": { spaceId: string };
	/** A request from the deadline page or godspeed to the learner's agent started or ended. */
	"deadline-request-changed": { spaceId: string; deadlineId: string };
	/** godspeed's own check of a space changed something; `run` is what Undo
	 *  names, `said` the agent's last line. */
	"space-checked": { run: string; spaceId: string; agent: string; lines: string[]; said: string | null };
}

export type ServerEventType = keyof ServerEvents;

/** The vocabulary's runtime names — the client wires one listener per
 *  name (types are erased; this list is the single source of truth for
 *  what the SSE channel can carry). */
export const SERVER_EVENT_TYPES = [
	"turn-started",
	"turn-settled",
	"jobs-changed",
	"activity-changed",
	"chats-changed",
	"spaces-changed",
	"agent-changed",
	"record-changed",
	"agent-action",
	"rules-changed",
	"cheat-sheet-changed",
	"mocks-changed",
	"deadline-request-changed",
	"space-checked",
	"files-added",
	"files-removed",
	"terminal-line",
	"agent-event",
	"vault-notes-changed",
	"teacher-work",
	"lesson-work",
	"agent-health",
	"agent-update",
] as const satisfies readonly ServerEventType[];


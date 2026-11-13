/**
 * THE EVENT BUS: notify → fetch, no standing polls.
 *
 * One bus, every layer: server emits turn lifecycle here, the store
 * adapters emit job/chat mutations, the agent layer's background
 * registries (extraction) emit activity changes — and
 * GET /api/events turns every emission into an SSE frame for any open
 * window. The events carry the FACT, never the data: consumers fetch
 * truth on receipt (push the poke, pull the data), so payloads stay
 * tiny, schemaless, and idempotent — a reconnect heals by refetching.
 *
 * WHY globalThis (the turn-liveness discipline, same rationale): Next
 * dev compiles each route as its own module entry, so a module-level
 * singleton is a DIFFERENT instance in the page render, the events
 * route, and every emitter's entry — they would each hold a private
 * listener set and nothing would propagate. globalThis spans module
 * instances within the process; it is the standard Next singleton
 * channel.
 *
 * Pure core by law: no React, no IO, no imports — the one layer that
 * server, store, and agent may all depend on.
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
	/** The learner asked for it (a lesson or a space made from Talk): the
	 *  window goes there even with Follow off. */
	open?: true;
}

/** The `agent` of the app's own entries in that list (a linked folder's
 *  new files): not an agent, so the teacher never flies to them. */
export const APP_SOURCE = "godspeed";

/** The `agent` of what the learner did in the app (answers, deadlines). */
export const LEARNER_SOURCE = "you";

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
	 *  by this event reads a durable record; ordering is guaranteed in
	 *  chat-handler's onFinish). */
	"turn-settled": { chatId: string };
	/** A job record changed (dispatch, progress, settle, abort, recovery).
	 *  chatId when known — consumers that own one chat filter on it. */
	"jobs-changed": { chatId?: string };
	/** An extraction run changed phase (activity dock). */
	"activity-changed": Record<string, never>;
	/** The session list changed (create, delete, title). */
	"chats-changed": Record<string, never>;
	/** The space list or a space record changed (create, edit, archive,
	 *  delete, files). */
	"spaces-changed": Record<string, never>;
	/** The outside agent's status changed: it checked in, went quiet, or
	 *  a request started or stopped waiting for it (agent-bridge.ts). */
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
	/** A deadline's cheat sheet or its agent request changed. */
	"cheat-sheet-changed": { deadlineId: string };
	/** A prep's sheet, its mocks or one of their agent requests changed. */
	"prep-changed": { spaceId: string };
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
	"prep-changed",
	"files-added",
	"files-removed",
] as const satisfies readonly ServerEventType[];


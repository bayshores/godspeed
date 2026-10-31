/**
 * Server-side turn liveness: which chats currently have a teacher turn in
 * flight. The missing half of "sessions keep running in the background" —
 * together with the write-ahead persist in chat-handler, a returning client
 * can tell "the teacher is mid-turn — don't resurrect, don't start anything"
 * apart from "the record IS current".
 *
 * Lives on globalThis, NOT a module-level Map: Next dev compiles each route
 * as its own entry, so a module-level singleton is a DIFFERENT instance in
 * the page render, GET /api/chats/[id], and POST /api/chat — the page would
 * read an empty registry while the chat route holds the live turn.
 * globalThis spans module instances within the process; it is the standard
 * Next.js singleton channel (same reason Prisma clients live there).
 *
 * Still ephemeral BY DESIGN: a process restart clears it, so there are no
 * stale flags to clean up — a crashed turn recovers via the write-ahead
 * record + mount continuation on the next visit. There is no time limit: a
 * turn can wait for the outside agent as long as it takes, and every path
 * after beginTurn ends in endTurn (onFinish runs even on aborts).
 */

import { emit } from "../core/events.ts";
import { clearTurnFailure } from "./turn-runs.ts";

interface LhGlobal {
	__lhTurnsInFlight?: Set<string>;
}

function registry(): Set<string> {
	const g = globalThis as typeof globalThis & LhGlobal;
	return (g.__lhTurnsInFlight ??= new Set<string>());
}

const inFlight = registry();

/**
 * Mark a turn as starting. Returns false if one is already running for the
 * chat — the caller rejects the request (only one turn may own a chat).
 * Announces "turn-started" AFTER the registry write: a listener that reads
 * isTurnRunning or fetches the record sees consistent truth. The rejected
 * double-begin (the 409 path) stays silent — no turn began.
 */
export function beginTurn(chatId: string): boolean {
	if (isTurnRunning(chatId)) return false;
	clearTurnFailure(chatId);
	inFlight.add(chatId);
	emit("turn-started", { chatId });
	return true;
}

/**
 * Mark the chat's turn as finished after normal settlement, or after the
 * failure notice has been retained by settlement cleanup. A subsequent
 * fetch reads durable truth, never a promise that an unsaved reply landed.
 * Emits only when an entry was actually present: a
 * defensive no-op endTurn must not fire a spurious settle.
 */
export function endTurn(chatId: string): void {
	if (inFlight.delete(chatId)) emit("turn-settled", { chatId });
}

/** True while the chat's turn is in flight. */
export function isTurnRunning(chatId: string): boolean {
	return inFlight.has(chatId);
}

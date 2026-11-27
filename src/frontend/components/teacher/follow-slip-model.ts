/**
 * Follow's slip at the page's foot: whether it shows and what its one line says while the
 * teacher works. Pure.
 *
 * It shows while Follow is on and the teacher's round of work is live, and for DONE_MS after
 * the round ends ("Done, 6 steps"), longer while its list is open. Never on a lesson, a mock or
 * a cheat sheet (they show their own wait), and never while the teacher's panel fills the window.
 */
import type { AgentAction } from "@/shared/core";
import { plural } from "@/frontend/lib/plural";
import { hasOwnBox } from "./dock-model";
import type { FollowPause } from "./follow";
import type { TimelineRow } from "./timeline-model";

/** A row's words hold at least this long before the line says "Thinking". */
export const FRESH_MS = 1200;
/** An ended round says "Done" this long, then the slip leaves. */
export const DONE_MS = 3000;

/** The mark before the words: the pencil that writes, the pencil at rest, or a check. */
type SlipMark = "live" | "still" | "done";

export interface SlipView {
	line: string;
	mark: SlipMark;
	/** "4 steps" at the line's end; null when the line says it, or with nothing yet. */
	count: string | null;
	/** While Follow waits: the change it waits to show on another page, for "Go to". */
	waiting: AgentAction | null;
	paused: boolean;
	/** What its list shows, oldest first: every row but the one the line says, each done. */
	past: readonly TimelineRow[];
	/** When the line changes by itself next (ms since the epoch), or null. */
	changesAt: number | null;
}

const PAUSE_LINE: Record<FollowPause, string> = {
	type: "Paused while you type",
	dialog: "Paused while this is open",
};

/** The least of the page the slip needs in view beside the teacher's open panel; in less, the panel's own screen shows the work. */
const LEAST_ROOM = 240;

/** Whether the slip has room: `beside` is how much of the page is in view beside the open panel, null while it is shut. */
export const slipFits = (beside: number | null): boolean => beside === null || beside >= LEAST_ROOM;

/** The pages the slip may show on: not a lesson, a mock or a cheat sheet. */
export function slipPlace(path: string): boolean {
	return !hasOwnBox(path) && !path.startsWith("/space/mock/");
}

export function slipView(i: {
	follow: boolean;
	path: string;
	/** The page beside the teacher's panel has room for it (slipFits). */
	room: boolean;
	live: boolean;
	rows: readonly TimelineRow[];
	/** When the round was seen to end; null while it is live. */
	endedAt: number | null;
	/** Follow waits for the learner; `waiting` is the change it would show. */
	pause: { why: FollowPause; waiting: AgentAction | null } | null;
	/** The learner opened its list. */
	open: boolean;
	now: number;
}): SlipView | null {
	if (!i.follow || !i.room || !slipPlace(i.path)) return null;
	const steps = plural(i.rows.length, "step");
	const base = { past: i.rows, waiting: null, paused: false };
	if (!i.live) {
		const ended = i.endedAt ?? i.now;
		if (i.rows.length === 0 || (!i.open && i.now - ended >= DONE_MS)) return null;
		return { ...base, line: `Done, ${steps}`, mark: "done", count: null, changesAt: i.open ? null : ended + DONE_MS };
	}
	const count = i.rows.length > 0 ? steps : null;
	if (i.pause) return { ...base, line: PAUSE_LINE[i.pause.why], mark: "still", count, waiting: i.pause.waiting, paused: true, changesAt: null };
	const newest = i.rows.at(-1);
	const freshUntil = newest ? Date.parse(newest.at) + FRESH_MS : 0;
	if (newest && i.now < freshUntil) return { ...base, line: newest.text, mark: "live", count, past: i.rows.slice(0, -1), changesAt: freshUntil };
	return { ...base, line: "Thinking", mark: "live", count, changesAt: null };
}

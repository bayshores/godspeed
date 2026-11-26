/**
 * The strip down the window's right edge: what it marks at rest, the rows
 * its peek lists, and what a click on it does. Pure.
 */
import { DAY, dueAtMs } from "@/frontend/components/countdown-model";
import { plural } from "@/frontend/lib/plural";
import type { WorkProgress } from "@/frontend/components/work/work-model";

/** A lesson whose reply came while another page was open. */
export interface ReadyLesson {
	id: string;
	title: string;
}

/** A deadline in its last 24 hours. */
interface DueSoon {
	id: string;
	spaceId: string;
	name: string;
	date: string;
	time?: string;
}

/**
 * The lessons whose reply waits, after reading the lesson list: `add` is a
 * lesson whose turn just settled. A lesson no longer in the list drops out,
 * and each keeps its newest title.
 */
export function keepReady(ready: readonly ReadyLesson[], chats: readonly ReadyLesson[], add: string | null): ReadyLesson[] {
	const ids = [...ready.map((l) => l.id).filter((id) => id !== add), ...(add === null ? [] : [add])];
	return ids.flatMap((id) => {
		const chat = chats.find((c) => c.id === id);
		return chat ? [{ id, title: chat.title }] : [];
	});
}

/**
 * The soonest deadline in its last 24 hours, or null. `pathname`: none on
 * Home, which lists every open deadline with its time left, and not the
 * one whose own page is open.
 */
export function dueSoon(deadlines: readonly DueSoon[], nowMs: number, pathname: string): DueSoon | null {
	if (pathname === "/") return null;
	const open = /^\/space\/deadline\/([^/]+)/.exec(pathname)?.[1];
	const here = open === undefined ? null : decodeURIComponent(open);
	let soonest: DueSoon | null = null;
	for (const d of deadlines) {
		const left = dueAtMs(d) - nowMs;
		if (d.id !== here && left > 0 && left < DAY && (!soonest || dueAtMs(d) < dueAtMs(soonest))) soonest = d;
	}
	return soonest;
}

/** A row of the peek, under the teacher's status. */
type PeekRow =
	/** A reply waits in another lesson: the row's Open goes there. */
	| { kind: "ready"; lesson: ReadyLesson }
	/** Background work under way, as plain words. */
	| { kind: "work"; work: WorkProgress };

/** The strip's square: it breathes while the teacher works. */
export type Square = "working" | "still";

/** The words on the strip's highlighter. */
type Flag = "needs you" | "your turn";

interface StripView {
	square: Square;
	/** The teacher's screen waits for the learner. */
	need: boolean;
	/** The lesson whose teacher waits for the learner to allow something. */
	ask: string | null;
	/** What waits for the learner first, on the highlighter. */
	flag: Flag | null;
	/** First what waits for the learner, then what works. */
	rows: PeekRow[];
}

/**
 * The strip from what is live. `panelOpen`: the open panel's head says what
 * the teacher needs, so the strip leaves it out and a click closes the panel.
 */
export function stripView(i: {
	/** A card in the teacher panel's chat waits to be allowed. */
	talkWaits: boolean;
	/** The teacher works. */
	working: boolean;
	work: WorkProgress | null;
	ready: readonly ReadyLesson[];
	/** The lessons whose teacher waits for the learner to allow something, oldest first. */
	asking: readonly string[];
	panelOpen: boolean;
}): StripView {
	const ask = i.asking[0] ?? null;
	const need = !i.panelOpen && i.talkWaits;
	const rows: PeekRow[] = [
		...i.ready.map((lesson) => ({ kind: "ready", lesson }) as const),
		...(i.work ? [{ kind: "work", work: i.work } as const] : []),
	];
	return {
		square: i.working && !i.talkWaits && !ask ? "working" : "still",
		need,
		ask,
		flag: need || ask ? "needs you" : i.ready.length > 0 ? "your turn" : null,
		rows,
	};
}

/**
 * What a click on the strip does: the panel's chat whose card waits for the
 * learner shows (wherever it is, its own window too); else the lesson whose
 * teacher waits for the learner to allow something; else the open panel
 * closes; else it opens.
 */
export function stripClick(need: boolean, ask: string | null, panelOpen: boolean): "show" | { lesson: string } | "open" | "close" {
	if (need) return "show";
	if (ask) return { lesson: ask };
	return panelOpen ? "close" : "open";
}

/** "2 notices". */
export function noticeCount(notices: number): string {
	return plural(notices, "notice");
}

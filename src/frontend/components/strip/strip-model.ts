/**
 * The strip down the window's right edge: what it marks at rest, the rows
 * its peek lists, and what a click on it does. Pure.
 */
import type { AgentStatus } from "@/frontend/components/agent-status";
import { DAY, dueAtMs } from "@/frontend/components/countdown-model";
import type { TeacherTerminalState, TerminalRole } from "@/frontend/components/terminal/terminal-model";
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
 * Today, which lists every open deadline with its time left, and not the
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
	/** Background work's screen waits for the learner: the row shows it. */
	| { kind: "background" }
	/** A reply waits in another lesson: the row's Open goes there. */
	| { kind: "ready"; lesson: ReadyLesson }
	/** Background work under way, as plain words. */
	| { kind: "work"; work: WorkProgress };

/** The strip's square: it breathes while the teacher works, and is hollow while the teacher is off. */
export type Square = "working" | "still" | "off";

/** The words on the strip's highlighter. */
type Flag = "needs you" | "your turn";

interface StripView {
	square: Square;
	/** The agent's screen that waits for the learner, the teacher's first. */
	need: TerminalRole | null;
	/** What waits for the learner first, on the highlighter. */
	flag: Flag | null;
	/** First what waits for the learner, then what works. */
	rows: PeekRow[];
}

/**
 * The strip from what is live. `panelOpen`: the open panel's head says what
 * the teacher and background work need, so the strip leaves both out and a
 * click closes the panel.
 */
export function stripView(i: {
	agent: AgentStatus | null;
	terminal: TeacherTerminalState | null;
	/** The teacher works. */
	working: boolean;
	/** Background work's screen waits for the learner. */
	background: boolean;
	work: WorkProgress | null;
	ready: readonly ReadyLesson[];
	panelOpen: boolean;
}): StripView {
	const teacherNeeds = i.terminal === "needsYou";
	const need: TerminalRole | null = i.panelOpen ? null : teacherNeeds ? "teacher" : i.background ? "helper" : null;
	const here = i.terminal !== null || !!i.agent?.connected || !!i.agent?.teaching;
	const rows: PeekRow[] = [
		...(i.background && !i.panelOpen ? [{ kind: "background" } as const] : []),
		...i.ready.map((lesson) => ({ kind: "ready", lesson }) as const),
		...(i.work ? [{ kind: "work", work: i.work } as const] : []),
	];
	return {
		square: !here ? "off" : i.working && !!i.agent && !teacherNeeds ? "working" : "still",
		need,
		flag: need ? "needs you" : i.ready.length > 0 ? "your turn" : null,
		rows,
	};
}

/**
 * What a click on the strip does: an agent's screen that needs the learner
 * shows (the teacher's wherever it is, its own window too); else the open
 * panel closes; else it opens.
 */
export function stripClick(need: TerminalRole | null, panelOpen: boolean): { show: TerminalRole } | "open" | "close" {
	if (need) return { show: need };
	return panelOpen ? "close" : "open";
}

/** "2 notices". */
export function noticeCount(notices: number): string {
	return plural(notices, "notice");
}

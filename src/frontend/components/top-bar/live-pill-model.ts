/**
 * The live pill's words: the live things in order of what needs the
 * learner first, and what the pill says of them. Pure.
 */
import { agentStatusLabel, type AgentStatus } from "@/frontend/components/agent-status";
import { DAY, dueAtMs } from "@/frontend/components/countdown-model";
import type { AgentDoing } from "@/frontend/components/teacher/follow-status";
import type { TeacherTerminalState } from "@/frontend/components/terminal/terminal-model";
import { plural } from "@/frontend/lib/plural";
import { HELPER_NAME, type WorkProgress } from "@/frontend/components/work/work-model";

/** A lesson whose reply came while another page was open. */
export interface ReadyLesson {
	id: string;
	title: string;
}

/** A deadline in its last 24 hours. */
export interface DueSoon {
	id: string;
	spaceId: string;
	name: string;
	date: string;
	time?: string;
}

/** One live thing. The pill says `head` then `detail`. */
export interface PillThing {
	kind: "teacher" | "background" | "work" | "ready";
	/** The lesson's id; the kind for the others. */
	key: string;
	head: string;
	detail: string;
	/** "3 of 12", in the count font. */
	count: string | null;
	/** On the highlighter: it waits for the learner. */
	lit: boolean;
	/** The teacher works: the square breathes. */
	working: boolean;
	/** An agent's screen waits for the learner: a click on the pill shows it. */
	needs: boolean;
	/** The pill's own Open: the lesson whose reply waits. */
	action: "open" | null;
}

interface PillInputs {
	name: string;
	doing: AgentDoing | null;
	agent: AgentStatus | null;
	terminal: TeacherTerminalState | null;
	/** Background work's screen waits for the learner. */
	background: boolean;
	work: WorkProgress | null;
	ready: readonly ReadyLesson[];
	/** With Follow off: the label of a fresh change on another page. */
	offer: string | null;
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

const lowerFirst = (text: string) => text.slice(0, 1).toLowerCase() + text.slice(1);

/** The teacher as a live thing, or null while it has nothing to say. */
function teacherThing(i: PillInputs): PillThing | null {
	const thing = (detail: string, more: Partial<PillThing> = {}): PillThing => ({
		kind: "teacher",
		key: "teacher",
		head: i.name,
		detail,
		count: null,
		lit: false,
		working: false,
		needs: false,
		action: null,
		...more,
	});
	// godspeed's own terminal knows first that the teacher starts or needs the learner.
	if (i.terminal === "needsYou") return thing("needs you", { lit: true, needs: true });
	if (i.terminal === "starting") return thing("starting");
	if (i.agent?.helperCovering) return thing("tidying its memory");
	if (i.agent && i.doing?.working)
		return thing(lowerFirst(i.doing.text), { count: i.doing.count ?? null, working: true });
	return i.offer === null ? null : thing(lowerFirst(i.offer));
}

/**
 * The live things, first what waits for the learner (the teacher's
 * question, background work's, a reply in another lesson), then what works
 * (the teacher, background work). Only what waits for the learner is lit.
 */
export function pillThings(i: PillInputs): PillThing[] {
	const teacher = teacherThing(i);
	const needs = teacher?.needs ?? false;
	const background: PillThing | null = i.background
		? { kind: "background", key: "background", head: HELPER_NAME, detail: "needs you", count: null, lit: true, working: false, needs: true, action: null }
		: null;
	const ready = i.ready.map((l): PillThing => ({ kind: "ready", key: l.id, head: l.title, detail: "your turn", count: null, lit: true, working: false, needs: false, action: "open" }));
	const work: PillThing | null = i.work && { kind: "work", key: "work", head: i.work.doing, detail: "", count: i.work.count, lit: false, working: false, needs: false, action: null };
	return [needs ? teacher : null, background, ...ready, needs ? null : teacher, work].filter((t) => t !== null);
}

/** The letters of a name that stay when the bar runs out of room. */
const NAME_LETTERS = 10;

/** The shortest the pill cuts a name to: its first letters. */
export function shortName(name: string): string {
	return name.length <= NAME_LETTERS + 1 ? name : `${name.slice(0, NAME_LETTERS).trimEnd()}…`;
}

/** The shortest the pill cuts what happens to: its first word, or all of
 *  it when it is as short as a name ("your turn", "needs you"). */
export function firstWord(detail: string): string {
	if (detail.length <= NAME_LETTERS + 1) return detail;
	const first = /^[^\s,]+/.exec(detail)?.[0] ?? detail;
	return first === detail ? detail : `${first}…`;
}

/** "2 notices". */
export function noticeCount(notices: number): string {
	return plural(notices, "notice");
}

/**
 * The pill's words while nothing is live. In the app's bar: the teacher's
 * name, or its state when it is not teaching ("Teacher is off").
 * In a page's own bar: the notices it holds, or nothing (no pill).
 */
export function idleWords(i: { name: string; agent: AgentStatus | null; notices: number; own: boolean }): string {
	if (i.own) return i.notices === 0 ? "" : noticeCount(i.notices);
	// Before the first read of the agent's state: just the name.
	if (!i.agent) return i.name;
	return agentStatusLabel(i.agent, i.name);
}

/** What the pill shows. */
export interface PillLine {
	head: string;
	/** Null for a notice and while nothing is live. */
	thing: PillThing | null;
	/** On the highlighter: a notice with something to act on, or a live thing that is. */
	lit: boolean;
	/** A deadline in its last day: its countdown ends the pill. */
	due: DueSoon | null;
	/** The idle words are the pill's line. */
	idle: boolean;
}

/**
 * The pill: a notice that just came first, else the first live thing, else
 * the idle words; then the deadline in its last day. `notice.lit`: a card
 * hangs under it with something to read or do; plain news stays quiet, and
 * never covers a thing that needs the learner.
 */
export function pillLine(i: { things: readonly PillThing[]; notice: { title: string; lit: boolean } | null; idle: string; due: DueSoon | null }): PillLine {
	const first = i.things[0] ?? null;
	const notice = i.notice && (i.notice.lit || !first?.lit) ? i.notice : null;
	const main = notice === null ? first : null;
	return {
		head: notice?.title ?? main?.head ?? i.idle,
		thing: main,
		lit: notice ? notice.lit : (main?.lit ?? false),
		due: i.due,
		idle: notice === null && main === null,
	};
}

/**
 * What a click on the pill's words does: an agent's screen it says needs
 * the learner opens in the teacher's panel (background work's own view for
 * its need); else the open panel closes, in any bar; else in the app's bar
 * the panel opens on the teacher's screen, and in a page's own bar the
 * folded notices show. Null: the pill has nothing to do there.
 */
export function pillClick(i: { main: PillThing | null; own: boolean; panelOpen: boolean; notices: number }): { open: "teacher" | "helper" } | "close" | "notices" | null {
	if (i.main?.needs) return { open: i.main.kind === "background" ? "helper" : "teacher" };
	if (i.panelOpen) return "close";
	if (i.own) return i.notices > 0 ? "notices" : null;
	return { open: "teacher" };
}

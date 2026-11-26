/**
 * What the agent is doing right now, as one line: the Follow chip and the
 * panel's Activity tab show it. Pure.
 *
 * In order: its round of work while it lasts, the lesson on screen, a file
 * or lesson it is reading for facts, a background job, a lesson turn
 * elsewhere, idle. Nothing before the first read of the turns running.
 */
import type { JobKind } from "@/shared/core";

/** A screen reader hears a new line at most this often. */
export const ANNOUNCE_GAP_MS = 8_000;

export interface AgentDoing {
	text: string;
	/** "3 of 12": the part of a file being read in parts. */
	count?: string;
	/** The agent is busy (the dot breathes). */
	working: boolean;
}

interface Extraction {
	kind: "chat" | "notes" | "topics";
	phase: string;
	title: string;
	part?: { i: number; n: number };
}

interface DoingInputs {
	/** The turns running now, in lessons and the panel's chats; null until read. */
	turnsRunning: number | null;
	/** What the teacher's live round says it does (its newest step or change, or "Working"); null with no live round. */
	round: string | null;
	/** The lesson on screen, if one is. */
	lesson: { working: boolean } | null;
	/** Oldest first, as the activity feed lists them. */
	extractions: readonly Extraction[];
	jobs: readonly { kind: JobKind }[];
	/** The teacher panel's chats writing a reply, which their own thread shows: not work elsewhere. */
	talkTurns: number;
}

const JOB_TEXT: Record<JobKind, string> = {
	research: "Looking things up for a lesson",
	demo: "Building a demo",
	pdf: "Reading a PDF",
};

/** How long a new line waits before a screen reader hears it, given when
 *  the last one was announced. */
export function announceDelay(lastAt: number | null, now: number): number {
	return lastAt === null ? 0 : Math.max(0, ANNOUNCE_GAP_MS - (now - lastAt));
}

/** "06_Counting.pdf" from "Slides/06_Counting.pdf (3/12)". */
function fileName(run: Extraction): string {
	const suffix = run.part ? ` (${run.part.i}/${run.part.n})` : "";
	const path = suffix && run.title.endsWith(suffix) ? run.title.slice(0, -suffix.length) : run.title;
	return path.split("/").pop() || path;
}

function readingLine(run: Extraction): Omit<AgentDoing, "working"> {
	if (run.kind === "topics") return { text: "Grouping topics" };
	const name = run.kind === "chat" ? `“${fileName(run)}”` : fileName(run);
	const text = run.phase === "merging" || run.kind === "chat" ? `Saving facts from ${name}` : `Reading ${name}`;
	return run.part ? { text, count: `${run.part.i} of ${run.part.n}` } : { text };
}

export function agentDoing(i: DoingInputs): AgentDoing | null {
	if (i.turnsRunning === null) return null;
	if (i.round) return { text: i.round, working: true };
	// The lesson's desk says what the teacher does there, so the line says it once.
	if (i.lesson?.working) return { text: "Working", working: true };
	const background = backgroundLine(i.extractions, i.jobs);
	if (background) return { ...background, working: true };
	if (i.turnsRunning > i.talkTurns) return { text: "Working", working: true };
	return { text: "Idle", working: false };
}

/** Whether the agent works on something besides the teacher panel chat `shown`: the round of that
 *  chat (`roundChat`) is its own work, which its thread shows. */
export function workElsewhere(i: DoingInputs & { roundChat: string | null; shown: string | null }): boolean {
	const own = i.roundChat !== null && i.roundChat === i.shown;
	return !!agentDoing({ ...i, round: own ? null : i.round })?.working;
}

/** The background work under way, in words: a file or lesson read for
 *  facts, else a job. Null when none runs. */
export function backgroundLine(extractions: readonly Extraction[], jobs: readonly { kind: JobKind }[]): Omit<AgentDoing, "working"> | null {
	// The run in progress first; the rest wait their turn behind it.
	const run = extractions.find((r) => r.phase !== "waiting") ?? extractions[0];
	if (run) return readingLine(run);
	const job = jobs[0];
	return job ? { text: JOB_TEXT[job.kind] } : null;
}

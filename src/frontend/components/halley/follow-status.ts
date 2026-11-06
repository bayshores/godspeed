/**
 * What the agent is doing right now, as one line: the Follow chip and the
 * panel's Activity tab show it. Pure.
 *
 * In order: its newest change while fresh, whether it is teaching at all,
 * the lesson on screen, a file or lesson it is reading for facts, a
 * background job, other work, idle. No agent connected: nothing.
 */
import { APP_SOURCE, type AgentAction, type JobKind } from "@/shared/core";

/** The newest change counts as "what it's doing now" this long, ahead of
 *  live work; then reading a file or a lesson shows. */
export const NOW_WINDOW_MS = 8_000;
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
	agent: { connected: boolean; teaching: boolean; pendingWork: number } | null;
	/** The agent's newest change while it is fresh (freshAction). */
	fresh: AgentAction | null;
	/** The lesson on screen, if one is. */
	lesson: { streaming: boolean; working: boolean } | null;
	/** Oldest first, as the activity feed lists them. */
	extractions: readonly Extraction[];
	jobs: readonly { kind: JobKind }[];
}

const JOB_TEXT: Record<JobKind, string> = {
	research: "Looking things up for a lesson",
	demo: "Building a demo",
	visual: "Drawing a figure",
	pdf: "Reading a PDF",
};

/** The agent's newest change (never the app's own entries, like a
 *  folder's new files) while it is fresh, and how long it stays fresh. */
export function freshAction(recent: readonly AgentAction[], now: number): { action: AgentAction; leftMs: number } | null {
	const action = recent.find((a) => a.agent !== APP_SOURCE);
	if (!action) return null;
	const leftMs = NOW_WINDOW_MS - (now - Date.parse(action.at));
	return leftMs > 0 ? { action, leftMs } : null;
}

/** How long a new line waits before a screen reader hears it, given when
 *  the last one was announced. */
export function announceDelay(lastAt: number | null, now: number): number {
	return lastAt === null ? 0 : Math.max(0, ANNOUNCE_GAP_MS - (now - lastAt));
}

/** "06_Counting.pdf" from "Slides/06_Counting.pdf · 3/12". */
function fileName(run: Extraction): string {
	const suffix = run.part ? ` · ${run.part.i}/${run.part.n}` : "";
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
	const agent = i.agent;
	if (!agent || !(agent.connected || agent.teaching)) return null;
	if (i.fresh) return { text: i.fresh.label, working: true };
	// Connected but not running the work loop: queued work isn't being done.
	if (!agent.teaching) return { text: "Not teaching yet", working: false };
	if (i.lesson?.streaming) return { text: "Writing the lesson", working: true };
	if (i.lesson?.working) return { text: "Working on the lesson", working: true };
	// The run in progress first; the rest wait their turn behind it.
	const run = i.extractions.find((r) => r.phase !== "waiting") ?? i.extractions[0];
	if (run) return { ...readingLine(run), working: true };
	const job = i.jobs[0];
	if (job) return { text: JOB_TEXT[job.kind], working: true };
	if (agent.pendingWork > 0) return { text: "Working", working: true };
	return { text: "Idle", working: false };
}

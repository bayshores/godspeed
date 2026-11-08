/** Pure helpers for Home (home-page.tsx): per-class progress, the fact grid, the ready bar and the activity lines. */
import { APP_SOURCE, LEARNER_SOURCE, UNTESTED_COLOR, rampColor, type AgentAction, type FactProgress, type ProgressPayload } from "@/shared/core";

export interface ClassesProgress {
	/** The latest payload each class has had. */
	progress: ReadonlyMap<string, ProgressPayload>;
	/** Why a class's last read failed. */
	errors: ReadonlyMap<string, string>;
}

export type ProgressRead = { classId: string; payload: ProgressPayload } | { classId: string; error: string };

/** One round of reads on top of the last state. A failed read keeps the
 *  class's earlier payload, so a blip never blanks a card that had data. */
export function foldClassesProgress(prev: ClassesProgress, classIds: readonly string[], reads: readonly ProgressRead[]): ClassesProgress {
	const progress = new Map<string, ProgressPayload>();
	const errors = new Map<string, string>();
	for (const classId of classIds) {
		const read = reads.find((r) => r.classId === classId);
		const payload = read && "payload" in read ? read.payload : prev.progress.get(classId);
		if (payload) progress.set(classId, payload);
		if (read && "error" in read) errors.set(classId, read.error);
	}
	return { progress, errors };
}

/** Every class has either data or a failed read, so no card waits on another. */
export function classesSettled(classIds: readonly string[], state: ClassesProgress): boolean {
	return classIds.every((id) => state.progress.has(id) || state.errors.has(id));
}

/** What a class's slot shows. Until the blocks are ready they all show the
 *  loading box, so they fill in together. */
export function classSlot(classId: string, state: ClassesProgress, blocksReady: boolean): "block" | "failed" | "loading" {
	if (!blocksReady) return "loading";
	if (state.progress.has(classId)) return "block";
	return state.errors.has(classId) ? "failed" : "loading";
}

/** An unstudied fact's cell: the pane's own border color. */
export const UNSTUDIED_CELL = "var(--border)";

/** A fact's share of right answers (0–1); null before its first answer. */
export function factRate(f: Pick<FactProgress, "answers">): number | null {
	if (f.answers.length === 0) return null;
	return f.answers.filter((a) => a.outcome === "right").length / f.answers.length;
}

/** The class's fact grid, one color per fact: answered facts in their
 *  right rate's ramp color, then studied but unanswered ones, then the
 *  unstudied ones dim. */
export function factCells(facts: readonly Pick<FactProgress, "inLessons" | "answers">[]): string[] {
	const answered = facts.filter((f) => f.answers.length > 0).map((f) => rampColor(factRate(f)));
	const studied = facts.filter((f) => f.answers.length === 0 && f.inLessons).map(() => UNTESTED_COLOR);
	const rest = facts.filter((f) => f.answers.length === 0 && !f.inLessons).map(() => UNSTUDIED_CELL);
	return [...answered, ...studied, ...rest];
}

/** How many of a ready bar's 10 blocks are filled. */
export function readyBlocks(ready: number): number {
	return Math.min(10, Math.max(0, Math.round(ready * 10)));
}

/** Who an activity line is about: the agent, the app (a folder sync) or the learner. */
export type ActivitySource = "agent" | "app" | "you";

interface ActivityLine {
	/** "17:49" today, "nov 5" before. */
	time: string;
	/** The label's first word, lowercase ("read"). */
	verb: string;
	rest: string;
	source: ActivitySource;
}

/** One line of Home's activity pane. */
export function activityLine(a: Pick<AgentAction, "at" | "label" | "agent">, nowMs: number): ActivityLine {
	const at = new Date(a.at);
	const now = new Date(nowMs);
	const today = at.toDateString() === now.toDateString();
	const time = today
		? `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
		: `${at.toLocaleString("en-US", { month: "short" }).toLowerCase()} ${at.getDate()}`;
	const [verb = "", ...rest] = a.label.split(" ");
	const source: ActivitySource = a.agent === APP_SOURCE ? "app" : a.agent === LEARNER_SOURCE ? "you" : "agent";
	return { time, verb: verb.toLowerCase(), rest: rest.join(" "), source };
}

/**
 * Halley's visits (plan 2026-10-28, Phase 4). Pure.
 *
 * Each change the agent makes is visited about STEP_MS apart. When more
 * than BURST_LIMIT are waiting, Halley stops touring and shows one summary
 * ("Added 8 deadlines") while every waiting target glows at once.
 */
import type { AgentAction } from "@/core";

/** One visit, start to start. */
export const STEP_MS = 600;
/** Of each visit: the flight; the rest is the glow. */
export const FLY_MS = 380;
/** More waiting than this becomes one summary. */
export const BURST_LIMIT = 5;
/** How long the summary bubble shows. */
export const BURST_MS = 1600;

export type TourStep =
	| { step: "visit"; action: AgentAction; rest: AgentAction[] }
	| { step: "burst"; actions: AgentAction[]; summary: string }
	| { step: "done" };

/** What to do with the waiting actions (oldest first). */
export function nextStep(queue: readonly AgentAction[], className?: (id: string) => string | undefined): TourStep {
	if (queue.length === 0) return { step: "done" };
	if (queue.length > BURST_LIMIT) return { step: "burst", actions: [...queue], summary: summarize(queue, className) };
	const [action, ...rest] = queue as [AgentAction, ...AgentAction[]];
	return { step: "visit", action, rest };
}

const PAST: Record<string, string> = {
	Adding: "Added",
	Archiving: "Archived",
	Changing: "Changed",
	Creating: "Created",
	Linking: "Linked",
	Marking: "Marked",
	Moving: "Moved",
	Reading: "Read",
	Removing: "Removed",
	Replying: "Replied",
	Starting: "Started",
	Unarchiving: "Unarchived",
	Unlinking: "Unlinked",
	Updating: "Updated",
};

const NOUN: Record<NonNullable<AgentAction["target"]>["kind"], [string, string]> = {
	deadline: ["deadline", "deadlines"],
	file: ["file", "files"],
	class: ["class", "classes"],
	lesson: ["lesson", "lessons"],
};

/** The first word of a label ("Adding HW 5" → "Adding"). */
export function verbOf(label: string): string {
	return label.trim().split(/\s+/)[0] ?? "";
}

/** One line for many changes: "Added 8 deadlines to CSE 21" when they are
 *  all the same kind of change, otherwise "Made 8 changes". */
export function summarize(actions: readonly AgentAction[], className?: (id: string) => string | undefined): string {
	const n = actions.length;
	const verbs = new Set(actions.map((a) => verbOf(a.label)));
	const kinds = new Set(actions.map((a) => a.target?.kind ?? null));
	const classes = new Set(actions.map((a) => a.classId));
	const [verb] = verbs;
	const [kind] = kinds;
	const past = verb ? PAST[verb] : undefined;
	if (verbs.size !== 1 || kinds.size !== 1 || !kind || !past) return `Made ${n} changes`;
	const noun = NOUN[kind][n === 1 ? 0 : 1];
	const [only] = classes;
	const where = classes.size === 1 && only && kind !== "class" ? className?.(only) : undefined;
	return where ? `${past} ${n} ${noun} ${verb === "Adding" ? "to" : "in"} ${where}` : `${past} ${n} ${noun}`;
}

/** A change as done, for Recent ("Adding HW 5" → "Added HW 5"). */
export function pastLabel(label: string): string {
	const verb = verbOf(label);
	const past = PAST[verb];
	return past ? `${past}${label.trim().slice(verb.length)}` : label;
}

/** The bubble's text: "Halley · Adding HW 5", or just "Adding" when the
 *  window is narrow. */
export function bubbleText(name: string, label: string, narrow: boolean): { who: string | null; what: string } {
	return narrow ? { who: null, what: verbOf(label) } : { who: name, what: label };
}

/** The target's attribute value ("deadline:ddl_1"). */
export function targetKey(target: NonNullable<AgentAction["target"]>): string {
	return `${target.kind}:${target.id}`;
}

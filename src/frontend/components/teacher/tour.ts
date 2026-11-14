/**
 * The teacher's visits. Pure.
 *
 * With Follow on, each change the agent makes is shown about STEP_MS
 * apart: its page opens and the changed item lights up. When more than
 * BURST_LIMIT are waiting, every waiting item lights up at once instead.
 */
import type { AgentAction } from "@/shared/core";

/** One visit, start to start. */
export const STEP_MS = 600;
/** More waiting than this lights up together. */
export const BURST_LIMIT = 5;

type TourStep = { step: "visit"; action: AgentAction; rest: AgentAction[] } | { step: "burst"; actions: AgentAction[] } | { step: "done" };

/** What to do with the waiting actions (oldest first). */
export function nextStep(queue: readonly AgentAction[]): TourStep {
	if (queue.length === 0) return { step: "done" };
	if (queue.length > BURST_LIMIT) return { step: "burst", actions: [...queue] };
	const [action, ...rest] = queue as [AgentAction, ...AgentAction[]];
	return { step: "visit", action, rest };
}

const PAST: Record<string, string> = {
	Adding: "Added",
	Changing: "Changed",
	Closing: "Closed",
	Creating: "Created",
	Linking: "Linked",
	Marking: "Marked",
	Moving: "Moved",
	Reading: "Read",
	Removing: "Removed",
	Reopening: "Reopened",
	Replying: "Replied",
	Starting: "Started",
	Unlinking: "Unlinked",
	Updating: "Updated",
};

/** The first word of a label ("Adding HW 5" → "Adding"). */
function verbOf(label: string): string {
	return label.trim().split(/\s+/)[0] ?? "";
}

/** A change as done, for Recent ("Adding HW 5" → "Added HW 5"). */
export function pastLabel(label: string): string {
	const verb = verbOf(label);
	const past = PAST[verb];
	return past ? `${past}${label.trim().slice(verb.length)}` : label;
}

/** The target's attribute value ("deadline:ddl_1"). */
export function targetKey(target: NonNullable<AgentAction["target"]>): string {
	return `${target.kind}:${target.id}`;
}

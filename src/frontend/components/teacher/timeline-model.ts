/**
 * The teacher's round as one timeline, oldest first: the round's steps (its reads and notes)
 * merged by time with the changes it made since the round began, which the activity log
 * already words. Pure.
 */
import { isAgentEntry, type AgentAction, type StepLink, type TeacherWork } from "@/shared/core";

export type TimelineRow =
	/** A read or a note; one with a file read's link opens that passage. */
	| { kind: "step"; id: string; at: string; text: string; link: StepLink | null }
	/** A change; a click goes to it. */
	| { kind: "change"; id: string; at: string; text: string; action: AgentAction };

/** `recent` is the activity log's newest entries (any order); only the agent's own, never a
 *  background check's, from the round's start on. No round: no rows. */
export function roundTimeline(work: TeacherWork | null, recent: readonly AgentAction[]): TimelineRow[] {
	if (!work?.since) return [];
	const since = Date.parse(work.since);
	const steps: TimelineRow[] = work.steps.map((s) => ({ kind: "step", id: s.id, at: s.at, text: s.text, link: s.link ?? null }));
	const changes: TimelineRow[] = recent
		.filter((a) => isAgentEntry(a) && !a.background && Date.parse(a.at) >= since)
		.map((a) => ({ kind: "change", id: a.id, at: a.at, text: a.label, action: a }));
	return [...steps, ...changes].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

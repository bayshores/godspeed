/**
 * CONTINUE STUDYING: a deadline's Study button reopens the lesson for that
 * deadline the learner last worked in, until it is finished. The server
 * decides that (`plan_finished` in crates/core/src/study/continue_study.rs)
 * and sends these types; this file holds them and the button labels. Pure
 * and browser-safe.
 */

/** A lesson for a deadline (not its homework lesson), with its step bar's count. */
interface DeadlineSession {
	chatId: string;
	deadlineId: string;
	/** When a message of it was last saved. */
	updatedAt: string;
	/** The step bar's count; absent until
	 *  the session has a plan (the agent writes it when the space has no
	 *  topics for it). */
	done?: number;
	/** The session's plan topics; absent with `done`. */
	total?: number;
	/** Set while it waits at a stop he has not kept going from: when, and
	 *  what is next. */
	stop?: { at: string; next: string | null };
	/** When it reached its end. */
	endedAt?: string;
	/** The topic it is in the middle of, when it is not at a stop. */
	inTopic?: string;
}

export type ContinueStudy = Pick<DeadlineSession, "chatId" | "done" | "total" | "stop" | "inTopic">;

/** What Home's row and the deadline's path say when today's plan is empty
 *  after its session ended: with the space name on Home, alone as a
 *  sentence on the path. */
export function nothingMorePlannedLine(spaceName?: string): string {
	return spaceName ? `${spaceName}, nothing more is planned today.` : "Nothing more is planned today.";
}

/** The label of a Study button that sits by the deadline's own name:
 *  "Study", or "Continue" once a session for it started. */
export function studyLabel(next: ContinueStudy | undefined): string {
	return next ? "Continue" : "Study";
}

/** The label of a Study button among several deadlines' buttons, which
 *  names its deadline. */
export function deadlineStudyLabel(next: ContinueStudy | undefined, name: string): string {
	if (!next) return `Study for ${name}`;
	if (next.total === undefined) return `Continue studying for ${name}`;
	return `Continue studying for ${name}, ${next.done} of ${next.total} ${next.total === 1 ? "topic" : "topics"}`;
}

/**
 * CONTINUE STUDYING: a deadline's Study button reopens the learner's latest
 * Study session started from that deadline until it is finished: it reached
 * its end, or its step bar's count reached its last topic with no stop left
 * to go on from. The server keeps a Rust copy
 * (crates/core/src/study/continue_study.rs). Pure and browser-safe.
 */

/** A Study session started from a deadline, with its step bar's count. */
export interface DeadlineSession {
	chatId: string;
	deadlineId: string;
	createdAt: string;
	/** The step bar's count (plan-step-bar.ts stepPosition). */
	done: number;
	/** The session's plan topics. */
	total: number;
	/** Set while it waits at a stop he has not kept going from: when, and
	 *  what is next. */
	stop?: { at: string; next: string | null };
	/** When it reached its end. */
	endedAt?: string;
	/** The topic it is in the middle of, when it is not at a stop. */
	inTopic?: string;
}

export type ContinueStudy = Pick<DeadlineSession, "chatId" | "done" | "total" | "stop" | "inTopic">;

/** The session a deadline's Study button reopens: the latest one started
 *  from it, while unfinished. A count at its last topic still continues at
 *  a stop, since a skipped topic may be left. */
export function continueStudyFor(deadlineId: string, sessions: readonly DeadlineSession[]): ContinueStudy | null {
	let latest: DeadlineSession | null = null;
	for (const s of sessions) if (s.deadlineId === deadlineId && (!latest || s.createdAt > latest.createdAt)) latest = s;
	if (!latest || latest.endedAt || (latest.done >= latest.total && !latest.stop)) return null;
	return { chatId: latest.chatId, done: latest.done, total: latest.total, ...(latest.stop ? { stop: latest.stop } : {}), ...(latest.inTopic ? { inTopic: latest.inTopic } : {}) };
}

/** What Today's row and the deadline's path say when today's plan is empty
 *  after its session ended: with the space name on Today, alone as a
 *  sentence on the path. */
export function nothingMorePlannedLine(spaceName?: string): string {
	return spaceName ? `${spaceName}, nothing more is planned today.` : "Nothing more is planned today.";
}

/** A deadline's Study button label. The deadline's own page passes no name
 *  (the page already names it). */
export function deadlineStudyLabel(next: ContinueStudy | undefined, name?: string): string {
	const forName = name ? ` for ${name}` : "";
	if (!next) return `Study${forName}`;
	return `Continue studying${forName}, ${next.done} of ${next.total} ${next.total === 1 ? "topic" : "topics"}`;
}

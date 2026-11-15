/**
 * STUDY: the topics a deadline's Study button picks. Pure and browser-safe.
 */
import { daysBetween, type DeadlineProgress, type TopicProgress } from "./progress.ts";
import { planDays } from "./deadline-plan.ts";
import { localDay } from "./today-note.ts";

/** A strong topic is checked again once its newest answer is this many days old. */
const RECHECK_DAYS = 7;

/** The topics a deadline's Study button studies: today's planned topics
 *  and the strong ones not answered for RECHECK_DAYS days, or all its
 *  topics once every one is strong, the plan is over, or today has nothing
 *  left. */
export function deadlineStudyTopicIds(
	today: string,
	deadline: Pick<DeadlineProgress, "date" | "topics">,
	topics: ReadonlyArray<Pick<TopicProgress, "id" | "status" | "answers">>,
): string[] {
	const planned = planDays(today, deadline.date, deadline.topics)[0]?.topics;
	// Today is empty once every topic left was finished today: Study takes them all again.
	if (!planned?.length) return deadline.topics.map((t) => t.id);
	const inDeadline = new Set(deadline.topics.map((t) => t.id));
	const recheck = topics.filter((t) => {
		const newest = t.answers[t.answers.length - 1]?.answeredAt;
		return inDeadline.has(t.id) && t.status === "strong" && !!newest && daysBetween(localDay(Date.parse(newest)), today) >= RECHECK_DAYS;
	});
	return [...planned, ...recheck].map((t) => t.id);
}

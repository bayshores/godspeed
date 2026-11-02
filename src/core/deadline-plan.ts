/**
 * The path to a deadline: the topics that still need work, weakest first,
 * spread over the days from today until the day before it's due (just
 * today when it's due today). Strong topics are left out.
 */
import { daysBetween, topicStatus, type TopicStatus } from "./progress.ts";

export interface PlanTopic {
	id: string;
	name: string;
	/** Right rate; null = not tried yet. */
	rate: number | null;
}

export interface PlanDay<T extends PlanTopic = PlanTopic> {
	/** YYYY-MM-DD. */
	day: string;
	topics: T[];
}

/** Weak first (lowest rate first), then not tried yet, then shaky. */
const RANK: Record<TopicStatus, number> = { weak: 0, untested: 1, shaky: 2, strong: 3 };
const rank = (t: PlanTopic) => RANK[topicStatus(t.rate)];

export function topicsToWorkOn<T extends PlanTopic>(topics: readonly T[]): T[] {
	return topics
		.filter((t) => topicStatus(t.rate) !== "strong")
		.map((t, i) => ({ t, i }))
		.sort((a, b) => rank(a.t) - rank(b.t) || (a.t.rate ?? 0) - (b.t.rate ?? 0) || a.i - b.i)
		.map(({ t }) => t);
}

/** "YYYY-MM-DD" plus n days. */
function addDays(day: string, n: number): string {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The study days with their topics, today first. Empty when the deadline
 *  is past or nothing needs work. More topics than days puts several on a
 *  day (the earlier days take the extra); fewer leaves the later days free. */
export function planDays<T extends PlanTopic>(today: string, due: string, topics: readonly T[]): PlanDay<T>[] {
	const days = daysBetween(today, due);
	const work = topicsToWorkOn(topics);
	if (days < 0 || work.length === 0) return [];
	const count = Math.max(1, Math.min(days, work.length));
	const base = Math.floor(work.length / count);
	const extra = work.length % count;
	const plan: PlanDay<T>[] = [];
	let next = 0;
	for (let i = 0; i < count; i++) {
		const size = base + (i < extra ? 1 : 0);
		plan.push({ day: addDays(today, i), topics: work.slice(next, next + size) });
		next += size;
	}
	return plan;
}

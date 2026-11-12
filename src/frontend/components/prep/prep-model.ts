/** The prep sheet's words and counts. Pure. */
import type { MockFormat, PrepTopicProgress, TopicStatus } from "@/shared/core";
import { calendarDays, dueAtMs } from "@/frontend/components/countdown-model";

/** How a topic is going, in the sheet's words. */
export const STATUS_WORD: Record<TopicStatus, string> = { strong: "solid", shaky: "shaky", weak: "weak", untested: "not started" };

/** How many of a topic's five boxes are filled: its share of right
 *  answers, at least one once it has an answer. */
export function meterBoxes(rate: number | null): number {
	return rate === null ? 0 : Math.max(1, Math.round(rate * 5));
}

/** "1 of 6 topics solid". */
export function solidLine(topics: readonly Pick<PrepTopicProgress, "status">[]): string {
	const solid = topics.filter((t) => t.status === "strong").length;
	return `${solid} of ${topics.length} ${topics.length === 1 ? "topic" : "topics"} solid`;
}

/** The share of topics that are solid, 0 to 1. */
export function solidShare(topics: readonly Pick<PrepTopicProgress, "status">[]): number {
	return topics.length === 0 ? 0 : topics.filter((t) => t.status === "strong").length / topics.length;
}

/** The day's count: whole days left ("6" and "days"), "today" on the day; null once it has passed. */
export function prepCount(date: string, nowMs: number): { count: string; unit: string } | null {
	const days = calendarDays(nowMs, dueAtMs({ date }));
	if (days < 0) return null;
	if (days === 0) return { count: "today", unit: "" };
	return { count: String(days), unit: days === 1 ? "day" : "days" };
}

/** "A mock is 4 questions in 70 minutes, like the real one." */
export function formatLine(format: MockFormat): string {
	return `A mock is ${format.questions} ${format.questions === 1 ? "question" : "questions"} in ${format.minutes} minutes, like the real one.`;
}

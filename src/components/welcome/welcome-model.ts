/**
 * The welcome screen's one line under the logo: the agent, and the next
 * deadline when there is one ("Claude Code connected · Midterm 2 in 3
 * days"). Pure and unit-tested.
 */
import { daysBetween, localDay } from "@/core";
import { isOverdue } from "@/components/deadlines-model";

export function statusLine(
	agent: { connected: boolean; name?: string },
	next: { name: string; date: string; time?: string } | undefined,
	nowMs: number,
): string {
	const who = agent.connected ? `${agent.name?.trim() || "Your agent"} connected` : "No agent connected";
	if (!next) return who;
	let when: string;
	if (isOverdue(next, nowMs)) when = "overdue";
	else {
		const days = daysBetween(localDay(nowMs), next.date);
		when = days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
	}
	return `${who} · ${next.name} ${when}`;
}

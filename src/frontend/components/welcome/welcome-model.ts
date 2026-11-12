/**
 * The welcome screen's start lines under the logo: the version, the agent,
 * and the next deadline ("godspeed 0.5.50", "Claude Code is connected",
 * "Midterm 2 is due in 3 days"). The first launch after updating from the
 * old look says so instead. Pure and unit-tested.
 */
import { compareVersions, daysBetween, localDay } from "@/shared/core";
import { isOverdue } from "@/frontend/components/deadlines-model";

/** The last version with the old look: updating from it (or earlier)
 *  plays the new look's boot once. */
const LAST_OLD_LOOK = "0.5.40";

/** True on the first launch after updating from the old look. */
export function lookUpgraded(whatsNewSince: string | null): boolean {
	return whatsNewSince !== null && compareVersions(whatsNewSince, LAST_OLD_LOOK) <= 0;
}

export function bootLines(
	version: string,
	agent: { connected: boolean; name?: string },
	next: { name: string; date: string; time?: string } | undefined,
	nowMs: number,
	upgraded: boolean,
): string[] {
	const head = `godspeed ${version}`;
	if (upgraded) return [head, "New look", "Loading your spaces"];
	const who = agent.connected ? `${agent.name?.trim() || "Your agent"} is connected` : "No agent is connected";
	if (!next) return [head, who];
	let when: string;
	if (isOverdue(next, nowMs)) when = "overdue";
	else {
		const days = daysBetween(localDay(nowMs), next.date);
		when = days <= 0 ? "due today" : days === 1 ? "due tomorrow" : `due in ${days} days`;
	}
	return [head, who, `${next.name} is ${when}`];
}

/**
 * The top bar's words and which of its tabs is lit. Pure.
 */
import type { AgentAction, SpaceSummary } from "@/shared/core";
import { agentStatusLabel, type AgentStatus } from "@/frontend/components/agent-status";
import { pageName } from "@/frontend/components/teacher/follow";
import type { AgentDoing } from "@/frontend/components/teacher/follow-status";

/** The clock: 24-hour "17:51". */
export function clockText(d: Date): string {
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The lit tab: "today", an open space's id, "closed" (the +) while the
 * window shows a closed space (an old lesson of it), or "menu" for the
 * pages only Menu reaches (Settings, lessons with no space).
 */
export function selectedTab(pathname: string, active: string | null, spaces: readonly Pick<SpaceSummary, "id" | "archived">[]): string {
	if (pathname === "/") return "today";
	if (pathname === "/settings") return "menu";
	const space = spaces.find((s) => s.id === active);
	if (!space) return "menu";
	return space.archived ? "closed" : space.id;
}

const lowerFirst = (text: string) => text.slice(0, 1).toLowerCase() + text.slice(1);

/**
 * The teacher chip's line: the teacher's name with what it is doing
 * ("marco, reading Lecture 14 notes"), or the agent's state when none is
 * teaching ("No agent connected").
 */
export function chipText(i: { name: string; doing: AgentDoing | null; agent: AgentStatus | null }): string {
	// Before the first read of the agent's state: just the name.
	if (!i.agent) return i.name;
	if (i.agent.helperCovering) return `${i.name}, tidying its memory`;
	if (i.doing?.working) return `${i.name}, ${lowerFirst(i.doing.text)}`;
	return i.agent.teaching ? i.name : agentStatusLabel(i.agent);
}

/**
 * The buttons beside the chip. Follow shows only while the teacher works.
 * With Follow off, a fresh change on another page offers "Go to" its page.
 */
export function followButtons(i: { following: boolean; working: boolean; offer: AgentAction | null }): { go: string | null; follow: "Follow" | "Following" | null } {
	return {
		go: !i.following && i.offer ? `Go to ${pageName(i.offer.page)}` : null,
		follow: i.working ? (i.following ? "Following" : "Follow") : null,
	};
}

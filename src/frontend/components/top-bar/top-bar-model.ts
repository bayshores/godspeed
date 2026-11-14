/**
 * The top bar's words and which of its tabs is lit. Pure.
 */
import type { AgentAction, ChatListItem, SpaceSummary } from "@/shared/core";
import { agentStatusLabel, type AgentStatus } from "@/frontend/components/agent-status";
import { pageName } from "@/frontend/components/teacher/follow";
import type { AgentDoing } from "@/frontend/components/teacher/follow-status";
import { teacherStateWords, type TeacherTerminalState } from "@/frontend/components/terminal/terminal-model";

/** The clock: 24-hour "17:51". */
export function clockText(d: Date): string {
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The lit tab: "today", an open space's id, "plus" (the +) while the
 * window shows what the + reaches (the lessons with no space or one of
 * them, a closed space or an old lesson of it), "menu" for Settings and
 * for a space not in the list yet, or "none" for another page with no
 * space.
 */
export function selectedTab(pathname: string, active: string | null, spaces: readonly Pick<SpaceSummary, "id" | "closed">[]): string {
	if (pathname === "/") return "today";
	if (pathname === "/settings") return "menu";
	if (active === null) return pathname === "/space/lessons" || pathname.startsWith("/chat/") ? "plus" : "none";
	const space = spaces.find((s) => s.id === active);
	if (!space) return "menu";
	return space.closed ? "plus" : space.id;
}

/** The + offers "Lessons with no space" only while there is one. Before
 *  the lessons are read, there is none. */
export function hasLessonsWithNoSpace(chats: readonly Pick<ChatListItem, "spaceId">[] | null): boolean {
	return chats?.some((c) => !c.spaceId) ?? false;
}

/** The +'s name for a screen reader and its hover title. The lessons with
 *  no space are read only while its list is open, so it never names them. */
export function plusName(closed: boolean): string {
	return closed ? "Add a space or reopen a closed one" : "Add a space";
}

/** Tells a screen reader that a tab or a closed row has a menu. */
export function spaceMenuDescription(closed: boolean): string {
	return `Has a menu with ${closed ? "Reopen" : "Close"} and Delete space`;
}

const lowerFirst = (text: string) => text.slice(0, 1).toLowerCase() + text.slice(1);

/**
 * The teacher chip's line: the teacher's name with what it is doing
 * ("marco, reading Lecture 14 notes"), or the agent's state when none is
 * teaching ("No agent connected").
 */
export function chipText(i: { name: string; doing: AgentDoing | null; agent: AgentStatus | null; terminal?: TeacherTerminalState | null }): string {
	// godspeed's own terminal knows first that the teacher starts or needs the learner.
	const own = teacherStateWords(i.terminal ?? null, i.name, "chip");
	if (own) return own;
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

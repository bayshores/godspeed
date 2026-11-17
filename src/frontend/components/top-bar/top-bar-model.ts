/**
 * The top bar's words and which of its tabs is lit. Pure.
 */
import type { AgentAction, ChatListItem, SpaceSummary } from "@/shared/core";
import { pageName } from "@/frontend/components/teacher/follow";

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

/**
 * The buttons beside what the teacher does. Follow shows only while it works.
 * With Follow off, a fresh change on another page offers "Go to" its page;
 * a page the agent opened while the window held offers it with Follow on too.
 */
export function followButtons(i: { following: boolean; working: boolean; offer: AgentAction | null; held: boolean }): { go: string | null; follow: "Follow" | "Following" | null } {
	return {
		go: i.offer && (i.held || !i.following) ? `Go to ${pageName(i.offer.page)}` : null,
		follow: i.working ? (i.following ? "Following" : "Follow") : null,
	};
}

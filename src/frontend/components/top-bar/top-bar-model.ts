/**
 * The top bar's words and which of its tabs is lit. Pure.
 */
import type { AgentAction, ChatListItem, SpaceSummary } from "@/shared/core";
import { pageName } from "@/frontend/components/teacher/follow";

/** The date: month, day, year, "11/07/2026". */
export function dateText(d: Date): string {
	return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

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
	if (active === null) return pathname === "/space" || pathname.startsWith("/chat/") ? "plus" : "none";
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
 * "Go to Files", the key the strip's peek offers: with Follow off a fresh change
 * on another page, and with Follow on too a page the agent opened while
 * the window held. Null with nothing to offer.
 */
export function goLabel(i: { following: boolean; offer: AgentAction | null; held: boolean }): string | null {
	return i.offer && (i.held || !i.following) ? `Go to ${pageName(i.offer.page)}` : null;
}

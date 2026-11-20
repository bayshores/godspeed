/**
 * Where a page lies among the others, and which way the window travels from one
 * page to the next. Pure.
 */
import type { SpaceSummary } from "@/shared/core";
import { selectedTab } from "@/frontend/components/top-bar/top-bar-model";

export interface Place {
	/** Two renders with the same key show the same page: nothing travels. */
	key: string;
	/** How many sheets lie under it: 0 for Home, Settings and a space's tabs. */
	depth: number;
	/** Its place from the left among the pages of its depth. */
	column: number;
}

/** The side the next page comes from, or "up" as a sheet laid on this one,
 *  or "down" as this sheet taken off the one under it. */
export type Way = "left" | "right" | "up" | "down";

export function wayBetween(from: Place, to: Place): Way | null {
	if (from.key === to.key) return null;
	if (from.depth !== to.depth) return to.depth > from.depth ? "up" : "down";
	return to.column < from.column ? "left" : "right";
}

/** A deadline's page and the start page lie on a space's page; a lesson, a
 *  mock and a cheat sheet lie on those. */
function pageDepth(pathname: string): number {
	if (pathname.startsWith("/chat/") || pathname.startsWith("/space/mock/") || pathname.endsWith("/cheat-sheet")) return 2;
	if (pathname === "/new" || pathname.startsWith("/space/deadline/")) return 1;
	return 0;
}

/**
 * The window's page. The pages lie in the order of the top bar: Home, the
 * open spaces, what the + reaches, Settings. A space's tabs are one page
 * here (the space's layout moves between them), and another space's are
 * another.
 */
export function pagePlace(pathname: string, active: string | null, spaces: readonly Pick<SpaceSummary, "id" | "closed">[]): Place {
	const depth = pageDepth(pathname);
	const open = spaces.filter((s) => !s.closed);
	const tab = selectedTab(pathname, active, spaces);
	const at = open.findIndex((s) => s.id === tab);
	const column = tab === "today" ? 0 : at >= 0 ? at + 1 : open.length + (tab === "menu" ? 2 : 1);
	const ofSpace = depth === 0 && pathname !== "/" && pathname !== "/settings";
	return { key: ofSpace ? `space ${active ?? ""}` : pathname, depth, column };
}

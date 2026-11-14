/** The tabs under a space's name, the count beside each, and the
 *  signature's share and fit. Pure. */
import type { FactProgress, SheetCard } from "@/shared/core";

/** What a tab counts: the percent of facts studied, lessons, files, cheat
 *  sheets made, deadlines coming up. */
export type TabCounts = Record<"studied" | "lessons" | "files" | "sheets" | "deadlines", number | undefined>;

interface SpaceTab {
	href: string;
	label: string;
	testid: string;
	/** The count shown beside the label. */
	count?: keyof TabCounts;
}

/** What the head is over: a space, or the lessons with no space. */
type HeadKind = "space" | "none";

const TABS: readonly (SpaceTab & { spaceOnly?: boolean })[] = [
	{ href: "/space", label: "Progress", testid: "nav-progress", count: "studied" },
	{ href: "/space/lessons", label: "Lessons", testid: "nav-lessons", count: "lessons" },
	{ href: "/space/files", label: "Files", testid: "nav-files", count: "files", spaceOnly: true },
	{ href: "/graph", label: "Graph", testid: "nav-graph" },
	{ href: "/space/cheat-sheets", label: "Cheat sheets", testid: "nav-cheat-sheets", count: "sheets", spaceOnly: true },
	{ href: "/space/deadlines", label: "Deadlines", testid: "nav-deadlines", count: "deadlines", spaceOnly: true },
];

/** The head's tabs. Lessons with no space have no files, cheat sheets or
 *  deadlines. */
export function spaceTabs(kind: HeadKind): readonly SpaceTab[] {
	return TABS.filter((t) => kind === "space" || !t.spaceOnly);
}

/** A tab's count as shown: the studied share reads "19%". */
export function tabCount(tab: SpaceTab, counts: TabCounts): string | undefined {
	const n = tab.count && counts[tab.count];
	if (n === undefined) return undefined;
	return tab.count === "studied" ? `${n}%` : String(n);
}

/** Share of the space's facts studied, 0 to 1 (null with no facts). A fact
 *  counts once it came up in a lesson, as in the fact grid. */
export function studiedShare(facts: readonly Pick<FactProgress, "inLessons" | "answers">[]): number | null {
	if (facts.length === 0) return null;
	return facts.filter((f) => f.inLessons || f.answers.length > 0).length / facts.length;
}

/** How much to shrink a signature so it fits its room (1 = as is). */
export function fitScale(natural: { width: number; height: number }, room: { width: number; height: number }): number {
	if (natural.width <= 0 || natural.height <= 0) return 1;
	return Math.min(1, room.width / natural.width, room.height / natural.height);
}

/** The cheat sheets that exist or are being made. */
export function sheetCount(cards: readonly Pick<SheetCard, "status">[]): number {
	return cards.filter((c) => c.status !== "none").length;
}

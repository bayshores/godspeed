/** The tabs under a space's name and the count beside each. Pure. */
import type { SheetCard } from "@/shared/core";

/** What a tab counts: lessons, files, cheat sheets made, deadlines coming up. */
export type TabCounts = Record<"lessons" | "files" | "sheets" | "deadlines", number | undefined>;

interface SpaceTab {
	href: string;
	label: string;
	testid: string;
	/** The count shown beside the label. */
	count?: keyof TabCounts;
}

const TABS: readonly (SpaceTab & { spaceOnly?: boolean })[] = [
	{ href: "/space", label: "Progress", testid: "nav-progress" },
	{ href: "/space/lessons", label: "Lessons", testid: "nav-lessons", count: "lessons" },
	{ href: "/space/files", label: "Files", testid: "nav-files", count: "files", spaceOnly: true },
	{ href: "/graph", label: "Graph", testid: "nav-graph" },
	{ href: "/space/cheat-sheets", label: "Cheat sheets", testid: "nav-cheat-sheets", count: "sheets", spaceOnly: true },
	{ href: "/space/deadlines", label: "Deadlines", testid: "nav-deadlines", count: "deadlines", spaceOnly: true },
];

/** A space's tabs; lessons with no space have no files, cheat sheets or deadlines. */
export function spaceTabs(hasSpace: boolean): readonly SpaceTab[] {
	return TABS.filter((t) => hasSpace || !t.spaceOnly);
}

/** The cheat sheets that exist or are being made. */
export function sheetCount(cards: readonly Pick<SheetCard, "status">[]): number {
	return cards.filter((c) => c.status !== "none").length;
}

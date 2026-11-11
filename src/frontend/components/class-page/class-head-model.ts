/** The tabs under a class's name and the count beside each. Pure. */
import type { SheetCard } from "@/shared/core";

/** What a tab counts: lessons, files, cheat sheets made, deadlines coming up. */
export type TabCounts = Record<"lessons" | "files" | "sheets" | "deadlines", number | undefined>;

interface ClassTab {
	href: string;
	label: string;
	testid: string;
	/** The count shown beside the label. */
	count?: keyof TabCounts;
}

const TABS: readonly (ClassTab & { classOnly?: boolean })[] = [
	{ href: "/class", label: "Progress", testid: "nav-progress" },
	{ href: "/class/lessons", label: "Lessons", testid: "nav-lessons", count: "lessons" },
	{ href: "/class/files", label: "Files", testid: "nav-files", count: "files", classOnly: true },
	{ href: "/graph", label: "Graph", testid: "nav-graph" },
	{ href: "/class/cheat-sheets", label: "Cheat sheets", testid: "nav-cheat-sheets", count: "sheets", classOnly: true },
	{ href: "/class/deadlines", label: "Deadlines", testid: "nav-deadlines", count: "deadlines", classOnly: true },
];

/** A class's tabs; lessons with no class have no files, cheat sheets or deadlines. */
export function classTabs(hasClass: boolean): readonly ClassTab[] {
	return TABS.filter((t) => hasClass || !t.classOnly);
}

/** The cheat sheets that exist or are being made. */
export function sheetCount(cards: readonly Pick<SheetCard, "status">[]): number {
	return cards.filter((c) => c.status !== "none").length;
}

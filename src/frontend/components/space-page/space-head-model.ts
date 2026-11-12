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

/** What the head is over: a space, a prep, or the lessons with no space. */
type HeadKind = "space" | "prep" | "none";

const LESSONS: SpaceTab = { href: "/space/lessons", label: "Lessons", testid: "nav-lessons", count: "lessons" };
const FILES: SpaceTab = { href: "/space/files", label: "Files", testid: "nav-files", count: "files" };

const TABS: readonly (SpaceTab & { spaceOnly?: boolean })[] = [
	{ href: "/space", label: "Progress", testid: "nav-progress" },
	LESSONS,
	{ ...FILES, spaceOnly: true },
	{ href: "/graph", label: "Graph", testid: "nav-graph" },
	{ href: "/space/cheat-sheets", label: "Cheat sheets", testid: "nav-cheat-sheets", count: "sheets", spaceOnly: true },
	{ href: "/space/deadlines", label: "Deadlines", testid: "nav-deadlines", count: "deadlines", spaceOnly: true },
];

const PREP_TABS: readonly SpaceTab[] = [
	{ href: "/space", label: "Prep sheet", testid: "nav-prep-sheet" },
	{ href: "/space/mocks", label: "Mocks", testid: "nav-mocks" },
	LESSONS,
	FILES,
];

/** The head's tabs. Lessons with no space have no files, cheat sheets or
 *  deadlines; a prep has its sheet in place of Progress. */
export function spaceTabs(kind: HeadKind): readonly SpaceTab[] {
	if (kind === "prep") return PREP_TABS;
	return TABS.filter((t) => kind === "space" || !t.spaceOnly);
}

/** The cheat sheets that exist or are being made. */
export function sheetCount(cards: readonly Pick<SheetCard, "status">[]): number {
	return cards.filter((c) => c.status !== "none").length;
}

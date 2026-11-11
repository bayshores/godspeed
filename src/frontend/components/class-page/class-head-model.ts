/** The tabs under a class's name. Pure. */

interface ClassTab {
	href: string;
	label: string;
	testid: string;
}

const TABS: readonly (ClassTab & { classOnly?: boolean })[] = [
	{ href: "/class", label: "Progress", testid: "nav-progress" },
	{ href: "/class/lessons", label: "Lessons", testid: "nav-lessons" },
	{ href: "/class/files", label: "Files", testid: "nav-files", classOnly: true },
	{ href: "/graph", label: "Graph", testid: "nav-graph" },
	{ href: "/class/cheat-sheets", label: "Cheat sheets", testid: "nav-cheat-sheets", classOnly: true },
];

/** A class's tabs; lessons with no class have no files or cheat sheets. */
export function classTabs(hasClass: boolean): readonly ClassTab[] {
	return TABS.filter((t) => hasClass || !t.classOnly);
}

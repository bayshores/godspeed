/** A deadline page's Back: the page whose link opened it. Pure. */
type Origin = "today" | "progress";
type Back = { to: string; label: string };

const BACK: Record<Origin, Back> = {
	today: { to: "/", label: "Today" },
	progress: { to: "/space", label: "Progress" },
};

/** The link state Today and Progress pass when they open a deadline. */
export function openedFrom(origin: Origin): { back: Origin } {
	return { back: origin };
}

/** Where Back goes for a link's state. With none (the Deadlines tab, a
 *  pasted address) it is the Deadlines tab. */
export function deadlineBack(state: unknown): Back {
	const origin = (state as { back?: unknown } | null)?.back;
	return origin === "today" || origin === "progress" ? BACK[origin] : { to: "/space/deadlines", label: "Deadlines" };
}

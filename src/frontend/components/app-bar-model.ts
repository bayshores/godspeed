/**
 * The top bar's path and clock. Pure.
 *
 * The path reads like a terminal's: the class (or "~" outside one), then
 * the page, each as a lowercase slug ("cse-29 / review-for-my-exam").
 */

export interface Crumb {
	label: string;
	/** null: the page you're on, not a link. */
	href: string | null;
	/** Going there switches the window to this class first. */
	classId?: string;
}

/** A name as a path segment: lowercase, runs of anything but letters and
 *  digits as one "-". */
export function slug(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "") || "untitled"
	);
}

/** The path's first segment: the class (its overview), or "~" (Home). */
export function rootCrumb(cls: { id: string; name: string } | null): Crumb {
	return cls ? { label: slug(cls.name), href: "/class", classId: cls.id } : { label: "~", href: "/" };
}

/** The clock: 24-hour "17:51". */
export function clockText(d: Date): string {
	return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

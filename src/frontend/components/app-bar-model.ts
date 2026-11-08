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

/** True when every shown part starts the target's part at its place (the
 *  last one may be cut short). */
function startsTarget(shown: readonly string[], target: readonly string[]): boolean {
	return shown.every((s, i) => (i < shown.length - 1 ? s === target[i] : (target[i] ?? "").startsWith(s)));
}

/**
 * One letter of the path retyping toward `target`: while what's shown
 * isn't the start of the target, erase a letter from the end; then type
 * the target's next letter. Returns `shown` itself once it is the target.
 */
export function retypeStep(shown: readonly string[], target: readonly string[]): readonly string[] {
	if (!startsTarget(shown, target)) {
		const last = shown[shown.length - 1]!;
		return last.length > 1 ? [...shown.slice(0, -1), last.slice(0, -1)] : shown.slice(0, -1);
	}
	const i = shown.length - 1;
	if (i >= 0 && shown[i] !== target[i]) return [...shown.slice(0, i), target[i]!.slice(0, shown[i]!.length + 1)];
	if (shown.length < target.length) return [...shown, target[shown.length]!.slice(0, 1)];
	return shown;
}

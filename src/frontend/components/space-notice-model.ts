/** The words and choices of the two cards that come from godspeed's own upkeep of a space. Pure. */
import type { ServerEvents } from "@/shared/core";

export type SpaceCheck = ServerEvents["space-checked"];

/** Most lines a change card shows; the rest are counted. */
const MAX_LINES = 3;

/** A second change in the same space replaces the first card. */
export function addCheck(checks: readonly SpaceCheck[], next: SpaceCheck): SpaceCheck[] {
	return [...checks.filter((c) => c.spaceId !== next.spaceId), next];
}

/** The lines on the card and how many more there were. */
export function cardLines(lines: readonly string[]): { shown: string[]; more: number } {
	return { shown: lines.slice(0, MAX_LINES), more: Math.max(0, lines.length - MAX_LINES) };
}

const PATH_LINE = / path topics?\b|\b(path|description)\b/i;

/** Where a click on the card goes: Progress when a line is about the path
 *  or the description, else the Deadlines tab. */
export function changeHref(lines: readonly string[]): "/space" | "/space/deadlines" {
	return lines.some((line) => PATH_LINE.test(line)) ? "/space" : "/space/deadlines";
}

function joined(names: readonly string[]): string {
	return names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What the card says once Undo answered: its title, and a sentence about
 *  what was left as it is, or null. */
export function undoneWords(answer: unknown): { title: string; left: string | null } {
	const body = (answer && typeof answer === "object" ? answer : {}) as { undone?: unknown; changedSince?: unknown; inUse?: unknown };
	const names = (list: unknown) => (Array.isArray(list) ? list.filter((n): n is string => typeof n === "string") : []);
	const kept = [...new Set([...names(body.changedSince), ...names(body.inUse)])];
	return {
		title: typeof body.undone === "number" && body.undone > 0 ? "Undone" : "Nothing was undone",
		left: kept.length > 0 ? `Left ${joined(kept)} as ${kept.length === 1 ? "it is" : "they are"}.` : null,
	};
}

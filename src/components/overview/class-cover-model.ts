/**
 * The class cover's words and numbers (pure): how much of the signature
 * is inked, where the progress label hangs, the description's first
 * sentence, and when Halley's note was written.
 */

/** Share of the class's facts studied, 0–1 (0 with no facts). */
export function studiedShare(facts: { studied: number; total: number }): number {
	return facts.total > 0 ? Math.min(1, Math.max(0, facts.studied / facts.total)) : 0;
}

/** The progress label hangs left of the line's end, except near the start
 *  where it would run off the cover. */
export function labelHangsLeft(share: number): boolean {
	return share >= 0.15;
}

/** The cover shows the description's first sentence (the whole text
 *  stays in Edit class). */
export function firstSentence(description: string): string {
	const line = description.trim().split("\n")[0]?.trim() ?? "";
	const end = line.search(/[.!?](\s|$)/);
	return end >= 0 ? line.slice(0, end + 1) : line;
}

const DAY_MS = 86_400_000;

/** When the note was written, as "after … lesson": today's, yesterday's,
 *  a weekday's within the week, then the date. */
export function noteWhen(at: string, nowMs: number): string {
	const written = new Date(at);
	if (Number.isNaN(written.getTime())) return "";
	const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((startOf(new Date(nowMs)) - startOf(written)) / DAY_MS);
	if (days <= 0) return "after today's lesson";
	if (days === 1) return "after yesterday's lesson";
	if (days < 7) return `after ${written.toLocaleDateString("en-US", { weekday: "long" })}'s lesson`;
	return `after the ${written.toLocaleDateString("en-US", { month: "short", day: "numeric" })} lesson`;
}

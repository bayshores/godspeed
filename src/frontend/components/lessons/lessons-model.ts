/** A lesson list's words and its search. Pure. */
import { fuzzyScore, type ChatListItem } from "@/shared/core";

/** A lesson's age: "now", "5 minutes ago", "yesterday", "3 days ago",
 *  then its date ("Nov 5", with the year once it isn't this one). */
export function lessonAge(iso: string, now = new Date()): string {
	const at = new Date(iso);
	const ms = now.getTime() - at.getTime();
	if (ms < 60_000) return "now";
	const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
	const min = Math.floor(ms / 60_000);
	if (min < 60) return plural(min, "minute");
	const h = Math.floor(min / 60);
	if (h < 24) return plural(h, "hour");
	const d = Math.floor(h / 24);
	if (d === 1) return "yesterday";
	if (d < 7) return plural(d, "day");
	return at.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(at.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}

/** The lesson waits for the learner: an open question or a posed problem. */
export function lessonWaiting(chat: ChatListItem): boolean {
	return chat.pendingQuestion || chat.pendingProblem;
}

/** The lessons a search finds, best match first; no search keeps them all
 *  in their own order. */
export function matchLessons(chats: readonly ChatListItem[], query: string): ChatListItem[] {
	const q = query.trim();
	if (!q) return [...chats];
	return chats
		.map((c) => ({ c, score: fuzzyScore(q, c.title) }))
		.filter((r): r is { c: ChatListItem; score: number } => r.score !== null)
		.sort((a, b) => b.score - a.score)
		.map((r) => r.c);
}

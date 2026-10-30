/**
 * Pure helpers for the topic Graph's panels and map: status colors, score
 * lines, the topic takeaway, fact order, the deadline picker's choices and
 * default, search matches. Browser-safe, unit-tested.
 */
import {
	RAMP_COLORS,
	type AnswerOutcome,
	type AnswerRef,
	type DeadlineProgress,
	type FactProgress,
	type TopicLink,
	type TopicProgress,
	type TopicStatus,
	type WorkOnNextItem,
} from "@/core";

/** Status → the topic ramp's color (weak red, shaky yellow, strong
 *  green); untested has none (drawn as an empty outline). */
export const STATUS_COLOR: Record<TopicStatus, string | null> = {
	strong: RAMP_COLORS[4],
	shaky: RAMP_COLORS[2],
	weak: RAMP_COLORS[0],
	untested: null,
};

/** The map's "overconfident" orange (the ramp's second step). */
export const OVERCONFIDENT_COLOR = RAMP_COLORS[1];

/** Answer blocks in the topic panel use the topic ramp's ends. */
export const PANEL_ANSWER_COLOR: Record<AnswerOutcome, string> = {
	right: RAMP_COLORS[4],
	wrong: RAMP_COLORS[0],
	dontKnow: "#5A5A5A",
};

/** The hovered topic's answer strip on the map uses the right/wrong tokens. */
export const STRIP_ANSWER_CLASS: Record<AnswerOutcome, string> = {
	right: "bg-ans-right",
	wrong: "bg-ans-wrong",
	dontKnow: "bg-ans-dontknow",
};

/** "4/7" — right over answered. */
export function scoreText(t: Pick<TopicProgress, "right" | "answered">): string {
	return `${t.right}/${t.answered}`;
}

/** The Work-on-next status line: "4/7 right · overconfident" or
 *  "Not tested yet". */
export function statusLine(t: Pick<TopicProgress, "right" | "answered" | "overconfident" | "status">): string {
	if (t.status === "untested") return "Not tested yet";
	return `${scoreText(t)} right${t.overconfident ? " · overconfident" : ""}`;
}

/** The reason under a Work-on-next row. progress.ts says "overconfident"
 *  for that group; the status line already says the word, so the reason
 *  explains it. */
export function reasonText(item: Pick<WorkOnNextItem, "reason">): string {
	return item.reason === "overconfident" ? "You felt sure on most of your misses" : item.reason;
}

/** Wrong answers given at confidence 4–5. */
function sureMisses(answers: readonly Pick<AnswerRef, "outcome" | "level">[]): number {
	return answers.filter((a) => a.outcome === "wrong" && a.level !== undefined && a.level >= 4).length;
}

/** The topic panel's one-line takeaway: "3 of 7 right. On 4 of the misses
 *  you picked 4 or 5, so you felt sure." */
export function takeaway(t: Pick<TopicProgress, "right" | "answered" | "answers">): string {
	if (t.answered === 0) return "Not tested yet.";
	const base = `${t.right} of ${t.answered} right.`;
	const sure = sureMisses(t.answers);
	if (sure === 0) return base;
	return `${base} On ${sure} of the misses you picked 4 or 5, so you felt sure.`;
}

/** A fact's mark: its latest answer's outcome, or null when untested. */
export function factMark(f: Pick<FactProgress, "answers">): AnswerOutcome | null {
	return f.answers.length === 0 ? null : f.answers[f.answers.length - 1]!.outcome;
}

const MARK_ORDER: Record<string, number> = { wrong: 0, dontKnow: 1, right: 2, none: 3 };

/** A topic's facts, the ones to fix first: latest answer wrong, then
 *  "I don't know", then right, then untested; ties by name. */
export function topicFacts(facts: readonly FactProgress[], topic: Pick<TopicProgress, "members">): FactProgress[] {
	const members = new Set(topic.members);
	return facts
		.filter((f) => members.has(f.id))
		.sort((a, b) => MARK_ORDER[factMark(a) ?? "none"]! - MARK_ORDER[factMark(b) ?? "none"]! || a.name.localeCompare(b.name));
}

/** "Needs first" (arrows in) and "Leads to" (arrows out) for a topic,
 *  heaviest arrows first. */
export function neighbors(
	topicId: string,
	links: readonly TopicLink[],
	byId: ReadonlyMap<string, TopicProgress>,
): { needs: TopicProgress[]; leadsTo: TopicProgress[] } {
	const pick = (ls: TopicLink[], key: "from" | "to") =>
		ls
			.sort((a, b) => b.weight - a.weight || a[key].localeCompare(b[key]))
			.map((l) => byId.get(l[key]))
			.filter((t): t is TopicProgress => !!t);
	return {
		needs: pick(links.filter((l) => l.to === topicId), "from"),
		leadsTo: pick(links.filter((l) => l.from === topicId), "to"),
	};
}

/** The deadlines the picker offers: not done, and covering at least one
 *  file (payload order: soonest due first). */
export function pickableDeadlines<T extends Pick<DeadlineProgress, "done" | "files">>(deadlines: readonly T[]): T[] {
	return deadlines.filter((d) => !d.done && d.files.length > 0);
}

/** The deadline the picker opens on: the soonest one still ahead, else
 *  the latest one (they arrive soonest first). */
export function defaultDeadlineId(deadlines: readonly Pick<DeadlineProgress, "id" | "daysUntil">[]): string | null {
	if (deadlines.length === 0) return null;
	return (deadlines.find((d) => d.daysUntil >= 0) ?? deadlines[deadlines.length - 1]!).id;
}

/** "9 days", "1 day", "Today", "3 days ago". */
export function countdownText(days: number): string {
	if (days === 0) return "Today";
	if (days < 0) return `${-days} ${days === -1 ? "day" : "days"} ago`;
	return `${days} ${days === 1 ? "day" : "days"}`;
}

/** What the deadline covers, short: the file's name when there is one,
 *  else "7 files". */
export function deadlineFilesText(files: readonly { name: string }[]): string {
	if (files.length === 0) return "";
	if (files.length === 1) return files[0]!.name;
	return `${files.length} files`;
}

const STATUS_ORDER: Record<TopicStatus, number> = { strong: 0, shaky: 1, weak: 2, untested: 3 };

/** The "Where you're at" bar: one block per topic, strong first. */
export function readinessBlocks<T extends Pick<TopicProgress, "status" | "rate" | "name">>(topics: readonly T[]): T[] {
	return [...topics].sort(
		(a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (b.rate ?? 0) - (a.rate ?? 0) || a.name.localeCompare(b.name),
	);
}

/** Topics matching a search (the topic's name, or any of its facts' name
 *  or statement, case-insensitive). null = no search. */
export function searchMatches(
	query: string,
	topics: readonly Pick<TopicProgress, "id" | "name">[],
	facts: readonly Pick<FactProgress, "topicId" | "name" | "statement">[],
): Set<string> | null {
	const q = query.trim().toLowerCase();
	if (!q) return null;
	const hits = new Set<string>();
	for (const t of topics) if (t.name.toLowerCase().includes(q)) hits.add(t.id);
	for (const f of facts) {
		if (hits.has(f.topicId)) continue;
		if (f.name.toLowerCase().includes(q) || f.statement.toLowerCase().includes(q)) hits.add(f.topicId);
	}
	return hits;
}

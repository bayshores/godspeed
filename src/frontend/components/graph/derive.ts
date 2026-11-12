/**
 * Pure helpers for the Graph page's columns and panes: status colors,
 * score lines, the sure-miss note, levels, a fact's links, the deadline
 * picker's choices and default, search matches. Browser-safe, unit-tested.
 */
import {
	RAMP_COLORS,
	type AnswerOutcome,
	type AnswerRef,
	type DeadlineProgress,
	type FactProgress,
	type GraphChain,
	type StatusCounts,
	type TopicLink,
	type TopicProgress,
	type WorkOnNextItem,
} from "@/shared/core";

/** Answer blocks in the topic panel use the topic ramp's ends. */
export const PANEL_ANSWER_COLOR: Record<AnswerOutcome, string> = {
	right: RAMP_COLORS[4],
	wrong: RAMP_COLORS[0],
	dontKnow: "var(--color-ans-dontknow)",
};

/** "4/7" — right over answered. */
function scoreText(t: Pick<TopicProgress, "right" | "answered">): string {
	return `${t.right}/${t.answered}`;
}

/** The Work-on-next status line: "4/7 right, overconfident" or
 *  "Not tested". */
export function statusLine(t: Pick<TopicProgress, "right" | "answered" | "overconfident" | "status">): string {
	if (t.status === "untested") return "Not tested";
	return `${scoreText(t)} right${t.overconfident ? ", overconfident" : ""}`;
}

/** The reason under a Work-on-next row. progress.ts says "overconfident"
 *  for that group; the status line already says the word, so the reason
 *  explains it. A bare "<n>% right" repeats the status line's score, so
 *  it shows nothing. */
export function reasonText(item: Pick<WorkOnNextItem, "reason">): string {
	if (/^\d+% right$/.test(item.reason)) return "";
	return item.reason === "overconfident" ? "You felt sure on most of your misses" : item.reason;
}

/** Wrong answers given at confidence 4–5. */
function sureMisses(answers: readonly Pick<AnswerRef, "outcome" | "level">[]): number {
	return answers.filter((a) => a.outcome === "wrong" && a.level !== undefined && a.level >= 4).length;
}

/** The topic pane's note under its score: "On 4 of the misses you picked
 *  4 or 5, so you felt sure."; "" with no sure misses. */
export function sureMissNote(t: Pick<TopicProgress, "answers">): string {
	const sure = sureMisses(t.answers);
	return sure === 0 ? "" : `On ${sure} of the misses you picked 4 or 5, so you felt sure.`;
}

/** "3 of 4 right", or "not tested". */
function rightOf(t: Pick<TopicProgress, "right" | "answered">): string {
	return t.answered === 0 ? "not tested" : `${t.right} of ${t.answered} right`;
}

/** The topic pane's count line: "7 facts, 3 of 4 right". */
export function topicCountLine(factCount: number, t: Pick<TopicProgress, "right" | "answered">): string {
	return `${factCount} ${factCount === 1 ? "fact" : "facts"}, ${rightOf(t)}`;
}

/** A Work-on-next row's line: "shaky, 1 of 2 right", or "not tested". */
export function workRowLine(t: Pick<TopicProgress, "status" | "right" | "answered">): string {
	if (t.status === "untested") return "not tested";
	return `${t.status}, ${rightOf(t)}`;
}

/** What a fact's square says, for screen readers: "1 of 2 right", "In a
 *  lesson, not answered" or "Not studied". */
export function factCellLabel(f: Pick<FactProgress, "answers" | "inLessons">): string {
	if (f.answers.length === 0) return f.inLessons ? "In a lesson, not answered" : "Not studied";
	return `${f.answers.filter((a) => a.outcome === "right").length} of ${f.answers.length} right`;
}

/** "2 strong, 3 shaky, 1 weak, 8 not tested". */
export function countsLine(c: StatusCounts): string {
	return `${c.strong} strong, ${c.shaky} shaky, ${c.weak} weak, ${c.untested} not tested`;
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

/** The topics by level (a topic's column: the longest chain of topics it
 *  needs first), each level's topics by name. */
export function topicLevels<T extends Pick<TopicProgress, "column" | "name">>(topics: readonly T[]): T[][] {
	const levels: T[][] = [];
	for (const t of topics) (levels[t.column] ??= []).push(t);
	return levels.filter((l) => l !== undefined).map((l) => l.sort((a, b) => a.name.localeCompare(b.name)));
}

/** A level pane's name: the first says where to start, the last that it's advanced. */
export function levelName(index: number, count: number): string {
	const name = `Level ${index + 1}`;
	if (count < 2) return name;
	if (index === 0) return `${name}, start here`;
	return index === count - 1 ? `${name}, advanced` : name;
}

/** "How many of these topics are ready": the strong ones. */
export function readyCount(topics: readonly Pick<TopicProgress, "status">[]): number {
	return topics.filter((t) => t.status === "strong").length;
}

/** The facts a fact builds on (the premises of chains concluding it) and
 *  the ones it leads to (conclusions of chains it is a premise of), each once. */
export function factLinks(factId: string, chains: readonly Pick<GraphChain, "premises" | "conclusion">[]): { buildsOn: string[]; leadsTo: string[] } {
	const buildsOn = new Set<string>();
	const leadsTo = new Set<string>();
	for (const c of chains) {
		if (c.conclusion === factId) for (const p of c.premises) if (p !== factId) buildsOn.add(p);
		if (c.premises.includes(factId) && c.conclusion !== factId) leadsTo.add(c.conclusion);
	}
	return { buildsOn: [...buildsOn], leadsTo: [...leadsTo] };
}

/**
 * Pure helpers for the Graph page's panels: answer colors, score lines,
 * the sure-miss note, a fact's answer line, a topic's and a fact's links
 * and how many show before they fold, what Find matches.
 * Browser-safe, unit-tested.
 */
import {
	dayLabel,
	localDay,
	RAMP_COLORS,
	rampColor,
	UNTESTED_COLOR,
	type AnswerOutcome,
	type AnswerRef,
	type FactProgress,
	type GraphChain,
	type TopicLink,
	type TopicProgress,
	rightWords,
	tally,
} from "@/shared/core";

/** Answer blocks in the topic panel use the topic ramp's ends. */
export const PANEL_ANSWER_COLOR: Record<AnswerOutcome, string> = {
	right: RAMP_COLORS[4],
	hinted: RAMP_COLORS[2],
	wrong: RAMP_COLORS[0],
	dontKnow: "var(--color-ans-dontknow)",
};

/** A topic's color: its score's ramp color once tested. */
export function topicColor(t: Pick<TopicProgress, "status" | "rate">): string {
	return t.status === "untested" ? UNTESTED_COLOR : rampColor(t.rate);
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

/** "3 of 4 right", "3 of 4 right, 1 with hints", or "not tested". */
function rightOf(t: Pick<TopicProgress, "right" | "hinted" | "answered">): string {
	return t.answered === 0 ? "not tested" : rightWords(t);
}

/** The topic pane's count line: "7 facts, 3 of 4 right". */
export function topicCountLine(factCount: number, t: Pick<TopicProgress, "right" | "hinted" | "answered">): string {
	return `${factCount} ${factCount === 1 ? "fact" : "facts"}, ${rightOf(t)}`;
}

/** What a fact's square says, for screen readers: "1 of 2 right", "In a
 *  lesson, not answered" or "Not studied". */
export function factCellLabel(f: Pick<FactProgress, "answers" | "inLessons">): string {
	if (f.answers.length === 0) return f.inLessons ? "In a lesson, not answered" : "Not studied";
	return rightWords(tally(f.answers));
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

/** True while the space has facts but none is in a topic yet: the server's
 *  Ungrouped bucket is the only topic. */
export function nothingGrouped(topics: readonly Pick<TopicProgress, "ungrouped">[]): boolean {
	return topics.length > 0 && topics.every((t) => t.ungrouped);
}

/** The line under facts not sorted yet: "Quigley sorts these 12 facts into
 *  topics next.", or, with fewer than the server sorts (`least`), when topics come. */
export function sortsNextLine(teacher: string, facts: number, least: number): string {
	if (facts < least) return `Topics appear once this space has ${least} facts.`;
	return `${teacher} sorts these ${facts} facts into topics next.`;
}

/** What Find lights: the topics whose name matches or that hold a
 *  matching fact, and the matching facts (by name or statement, or every
 *  fact of a topic whose name matches); case-insensitive. null = nothing typed. */
export function findMatches(
	query: string,
	topics: readonly Pick<TopicProgress, "id" | "name">[],
	facts: readonly Pick<FactProgress, "id" | "topicId" | "name" | "statement">[],
): { topics: Set<string>; facts: Set<string> } | null {
	const q = query.trim().toLowerCase();
	if (!q) return null;
	const named = new Set(topics.filter((t) => t.name.toLowerCase().includes(q)).map((t) => t.id));
	const hits = { topics: new Set(named), facts: new Set<string>() };
	for (const f of facts) {
		if (!named.has(f.topicId) && !f.name.toLowerCase().includes(q) && !f.statement.toLowerCase().includes(q)) continue;
		hits.facts.add(f.id);
		hits.topics.add(f.topicId);
	}
	return hits;
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

/** A fact's answer line: "Not asked yet", or "1 of 3 right, last Fri Nov 20". */
export function answerLine(f: Pick<FactProgress, "answers">): string {
	if (f.answers.length === 0) return "Not asked yet";
	const last = f.answers.at(-1)?.answeredAt;
	return `${rightWords(tally(f.answers))}${last ? `, last ${dayLabel(localDay(new Date(last)))}` : ""}`;
}

/** True when a fact's statement only says its name again, so the panel shows it once. */
export function sameWords(name: string, statement: string): boolean {
	const plain = (s: string) => s.trim().replace(/[.\s]+$/, "").toLowerCase();
	return !statement.trim() || plain(name) === plain(statement);
}

/** How many links each group shows when `budget` links fit: one to each group in turn, until the budget or the links run out. */
export function shareLinks(counts: readonly number[], budget: number): number[] {
	const shown = counts.map(() => 0);
	let left = Math.min(Math.max(0, budget), counts.reduce((a, b) => a + b, 0));
	while (left > 0) {
		counts.forEach((count, i) => {
			if (left > 0 && shown[i]! < count) {
				shown[i] = shown[i]! + 1;
				left--;
			}
		});
	}
	return shown;
}

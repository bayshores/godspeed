/**
 * What a Study start on topics sends: each topic's facts as the session's
 * picks (the server groups them back into topics and writes the study
 * plan) and the title that becomes its first message. Pure.
 */
import type { FactProgress, GraphContextPick, TopicProgress } from "@/core";
import { topicFacts } from "@/components/graph/derive";

/** The server keeps at most 64 picks. */
export const MAX_PICKS = 64;

/** The picks for a set of topics: each topic's facts, weakest first,
 *  topics in the given order, capped at MAX_PICKS. */
export function studyPicks(
	topics: readonly Pick<TopicProgress, "members">[],
	facts: readonly FactProgress[],
): GraphContextPick[] {
	const picks: GraphContextPick[] = [];
	for (const t of topics) {
		for (const f of topicFacts(facts, t)) {
			if (picks.length >= MAX_PICKS) return picks;
			picks.push({ id: f.id, name: f.name, statement: f.statement });
		}
	}
	return picks;
}

/** The new lesson's title (and first message). */
export function studyTitle(topics: readonly Pick<TopicProgress, "name">[]): string {
	return `Study: ${topics.map((t) => t.name).join(", ")}`;
}

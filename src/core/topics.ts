/**
 * TOPICS: named groups of a
 * graph's facts, the unit the Overview and the topic Graph show.
 *
 * The topic grouper (a background model job, agent/subagents/topic-grouper.ts)
 * proposes groups; this module holds the deterministic parts around it:
 *  - resolveTopics: the READ rule — the last snapshot, members that are no
 *    longer facts dropped, facts in no topic gathered into "Ungrouped";
 *  - repairTopics: the WRITE rule — every current fact in exactly one
 *    topic, whatever the model submitted;
 *  - topicNameProblem / sameFactSet: the grouper's validation and its
 *    "nothing changed" skip.
 *
 * Pure and browser-safe (no node builtins): the shell may import it.
 */
import type { GraphChain, GraphTopic, TopicSnapshot } from "./contracts.ts";

/** The pseudo-topic that holds facts no snapshot has placed yet. Never
 *  stored — derived on read. */
export const UNGROUPED_TOPIC_ID = "ungrouped";
const UNGROUPED_TOPIC_NAME = "Ungrouped";

/** The repair's catch-all for facts with no grouped neighbor. Stored like
 *  any other topic (the grouper may rename or split it next run). */
const OTHER_TOPIC_NAME = "Other";

/** Topic names: 1–4 words (the approved grouper instruction). */
const MAX_TOPIC_NAME_WORDS = 4;

/** Below this many facts the grouper does not run. */
export const MIN_FACTS_FOR_TOPICS = 4;

/** A topic as readers see it: members are live facts only. */
interface ResolvedTopic extends GraphTopic {
	/** True for the derived "Ungrouped" bucket. */
	ungrouped?: true;
}

/** The read rule: topics from the last snapshot over the CURRENT facts.
 *  Members that are no longer facts are dropped, a fact claimed twice
 *  stays in its first topic, topics left empty disappear, and facts in no
 *  topic are gathered into a trailing "Ungrouped" topic (present only
 *  when non-empty). Fact order inside a topic follows the snapshot. */
export function resolveTopics(snapshot: TopicSnapshot | null, factIds: readonly string[]): ResolvedTopic[] {
	const live = new Set(factIds);
	const placed = new Set<string>();
	const out: ResolvedTopic[] = [];
	for (const topic of snapshot?.topics ?? []) {
		const members = topic.members.filter((id) => live.has(id) && !placed.has(id));
		for (const id of members) placed.add(id);
		if (members.length > 0) out.push({ id: topic.id, name: topic.name, members });
	}
	const rest = factIds.filter((id) => !placed.has(id));
	if (rest.length > 0) out.push({ id: UNGROUPED_TOPIC_ID, name: UNGROUPED_TOPIC_NAME, members: [...rest], ungrouped: true });
	return out;
}

/** Every fact id a snapshot names (raw — dead ids included). */
function snapshotFactIds(snapshot: TopicSnapshot | null): Set<string> {
	const ids = new Set<string>();
	for (const topic of snapshot?.topics ?? []) for (const id of topic.members) ids.add(id);
	return ids;
}

/** True when the snapshot covers exactly these facts (the grouper's
 *  "nothing changed since the last run" skip). */
export function sameFactSet(snapshot: TopicSnapshot | null, factIds: readonly string[]): boolean {
	if (!snapshot) return false;
	const named = snapshotFactIds(snapshot);
	const current = new Set(factIds);
	if (named.size !== current.size) return false;
	for (const id of current) if (!named.has(id)) return false;
	return true;
}

/** Collapse whitespace; "" when nothing is left. */
function cleanTopicName(name: string): string {
	return name.trim().replace(/\s+/g, " ");
}

/** Why a submitted name is unusable, or null when it is fine. */
export function topicNameProblem(name: string): string | null {
	const clean = cleanTopicName(name);
	if (!clean) return "A topic name is empty — give every topic a 1–4 word name.";
	const words = clean.split(" ").length;
	if (words > MAX_TOPIC_NAME_WORDS) return `"${clean}" has ${words} words — topic names are 1–4 words.`;
	return null;
}

/** One topic as the grouper submits it: id only when it keeps an existing
 *  topic. */
export interface TopicDraft {
	id?: string;
	name: string;
	members: string[];
}

/**
 * The write rule: turn a submitted grouping into a valid snapshot body over
 * the current facts.
 *  - unknown fact ids are dropped; a fact listed twice stays in its first
 *    topic;
 *  - ids: a draft's id is kept when it names an existing topic (first
 *    claim wins); otherwise an existing topic with the same name (case-
 *    insensitive) lends its id; otherwise a new id (`newId`);
 *  - facts the draft left out join the topic most of their chain
 *    neighbors are in (premises ↔ conclusion, and co-premises), repeated
 *    until nothing more can be placed; the rest go into "Other";
 *  - empty topics are dropped.
 */
export function repairTopics(
	drafts: readonly TopicDraft[],
	factIds: readonly string[],
	chains: ReadonlyArray<Pick<GraphChain, "premises" | "conclusion">>,
	existing: readonly GraphTopic[],
	newId: () => string,
): GraphTopic[] {
	const live = new Set(factIds);
	const existingIds = new Set(existing.map((t) => t.id));
	const idByName = new Map(existing.map((t) => [cleanTopicName(t.name).toLowerCase(), t.id]));
	const usedIds = new Set<string>();
	const topics: GraphTopic[] = [];
	const topicOf = new Map<string, number>();

	const claimId = (draft: TopicDraft, name: string): string => {
		const own = draft.id?.trim();
		if (own && existingIds.has(own) && !usedIds.has(own)) return own;
		const byName = idByName.get(name.toLowerCase());
		if (byName && !usedIds.has(byName)) return byName;
		let id = newId();
		while (usedIds.has(id) || existingIds.has(id)) id = newId();
		return id;
	};

	for (const draft of drafts) {
		const name = cleanTopicName(draft.name);
		if (!name) continue;
		const members: string[] = [];
		for (const id of draft.members) {
			if (!live.has(id) || topicOf.has(id)) continue;
			topicOf.set(id, topics.length);
			members.push(id);
		}
		if (members.length === 0) continue;
		const id = claimId(draft, name);
		usedIds.add(id);
		topics.push({ id, name, members });
	}

	// Place the facts the draft left out by their chain neighbors.
	const neighbors = new Map<string, Set<string>>();
	const link = (a: string, b: string) => {
		if (a === b) return;
		let set = neighbors.get(a);
		if (!set) neighbors.set(a, (set = new Set()));
		set.add(b);
	};
	for (const chain of chains) {
		const members = [...chain.premises, chain.conclusion];
		for (const a of members) for (const b of members) link(a, b);
	}
	let missing = factIds.filter((id) => !topicOf.has(id));
	for (let progress = true; progress && missing.length > 0; ) {
		progress = false;
		const still: string[] = [];
		for (const id of missing) {
			const votes = new Map<number, number>();
			for (const n of neighbors.get(id) ?? []) {
				const t = topicOf.get(n);
				if (t !== undefined) votes.set(t, (votes.get(t) ?? 0) + 1);
			}
			let best: number | undefined;
			for (const [t, n] of votes) {
				if (best === undefined || n > votes.get(best)! || (n === votes.get(best)! && t < best)) best = t;
			}
			if (best === undefined) {
				still.push(id);
				continue;
			}
			topicOf.set(id, best);
			topics[best]!.members.push(id);
			progress = true;
		}
		missing = still;
	}
	if (missing.length > 0) {
		const other = topics.findIndex((t) => t.name.toLowerCase() === OTHER_TOPIC_NAME.toLowerCase());
		if (other >= 0) topics[other]!.members.push(...missing);
		else {
			const id = claimId({ name: OTHER_TOPIC_NAME, members: [] }, OTHER_TOPIC_NAME);
			usedIds.add(id);
			topics.push({ id, name: OTHER_TOPIC_NAME, members: missing });
		}
	}
	return topics;
}

/**
 * STUDY — one session that decides per topic whether to teach, drill or
 * just check. At the start the app turns the picked facts into the
 * session's topics, in the order the class covered them, each with a mode
 * from the learner's track record:
 *
 *  - never tested → "teach": a short explanation with a worked example, then a problem
 *  - weak or shaky → "problems": problems with hints, a short re-teach on a miss
 *  - strong → "check": one quick problem, then move on
 *
 * The topics become the study context the agent reads and the plan the
 * step bar shows (one node per topic). Pure and browser-safe.
 */
import { topicFacts, type DeadlineProgress, type FactProgress, type TopicProgress, type TopicStatus } from "./progress.ts";
import type { PlanTree } from "./contracts.ts";
import { planDays } from "./deadline-plan.ts";
import { dateInName } from "./file-series.ts";
import { createTree } from "./plan-tree.ts";

export type StudyMode = "teach" | "problems" | "check";

export interface StudyTopic {
	/** The plan node id: the class topic's id, or FREE_TOPIC_ID. */
	id: string;
	name: string;
	mode: StudyMode;
	/** The picked facts in this topic (empty for a typed topic). */
	factIds: string[];
}

/** The plan node of a typed topic that matches no fact. */
export const FREE_TOPIC_ID = "topic";

export function studyMode(status: TopicStatus): StudyMode {
	if (status === "untested") return "teach";
	return status === "strong" ? "check" : "problems";
}

/**
 * Each fact's place in the class's order: the files sorted the way the
 * deadline page lists class days (dated files by date, then undated ones
 * by name), and a fact sits where the file it came from sits. Facts born
 * in a lesson have no place.
 */
export function factClassOrder(
	facts: ReadonlyArray<{ id: string; born: string | null }>,
	files: ReadonlyArray<{ name: string; sourceId: string }>,
): Map<string, number> {
	const dated = files.map((f) => ({ f, date: dateInName(f.name) }));
	const sorted = [
		...dated.filter((d) => d.date !== null).sort((a, b) => a.date!.localeCompare(b.date!)),
		...dated.filter((d) => d.date === null).sort((a, b) => a.f.name.localeCompare(b.f.name, undefined, { numeric: true })),
	];
	const rankOf = new Map(sorted.map((d, i) => [d.f.sourceId, i]));
	const out = new Map<string, number>();
	for (const fact of facts) {
		const rank = fact.born === null ? undefined : rankOf.get(fact.born);
		if (rank !== undefined) out.set(fact.id, rank);
	}
	return out;
}

/**
 * The session's topics: the picked facts grouped by their class topic,
 * in class order (a topic sits at its earliest fact; facts from no class
 * file go last; ties keep the order the facts were picked in). When no
 * picked fact is in a topic, the typed topic is the one "teach" topic.
 */
export function studyTopics(input: {
	/** The picked fact ids, in the order they were sent. */
	factIds: readonly string[];
	topics: ReadonlyArray<{ id: string; name: string; members: readonly string[]; status: TopicStatus }>;
	classOrder: ReadonlyMap<string, number>;
	freeTopic: string;
}): StudyTopic[] {
	const topicOf = new Map<string, (typeof input.topics)[number]>();
	for (const t of input.topics) for (const id of t.members) topicOf.set(id, t);
	const groups = new Map<string, StudyTopic>();
	for (const id of input.factIds) {
		const topic = topicOf.get(id);
		if (!topic) continue;
		const group = groups.get(topic.id);
		if (!group) groups.set(topic.id, { id: topic.id, name: topic.name, mode: studyMode(topic.status), factIds: [id] });
		else if (!group.factIds.includes(id)) group.factIds.push(id);
	}
	if (groups.size === 0) return [{ id: FREE_TOPIC_ID, name: input.freeTopic, mode: "teach", factIds: [] }];
	return inClassOrder([...groups.values()], input.classOrder);
}

/** Topics sorted by their earliest fact's place in the class; facts from
 *  no class file go last and ties keep their order. */
function inClassOrder(topics: readonly StudyTopic[], classOrder: ReadonlyMap<string, number>): StudyTopic[] {
	const rank = (t: StudyTopic) => Math.min(Infinity, ...t.factIds.map((id) => classOrder.get(id) ?? Infinity));
	return topics
		.map((t) => ({ t, rank: rank(t) }))
		.sort((a, b) => a.rank - b.rank)
		.map((r) => r.t);
}

/** A session holds at most this many facts. */
export const MAX_STUDY_FACTS = 64;

/**
 * A session on class topics (a Study start on topics or on a deadline):
 * each topic with its facts, the ones to fix first. Whole topics fill the
 * session until the next one would pass MAX_STUDY_FACTS facts (always at
 * least one; one bigger than that keeps its first MAX_STUDY_FACTS facts),
 * and the kept ones are listed in class order.
 *
 * Topics fill in class order. A deadline start passes `studiedToday`, so
 * each Study click moves on: first the topics that are not strong and
 * were not studied today, then not strong but studied today, then strong,
 * each group in class order.
 */
export function topicStudy(input: {
	topicIds: readonly string[];
	topics: readonly Pick<TopicProgress, "id" | "name" | "members" | "status">[];
	facts: readonly FactProgress[];
	classOrder: ReadonlyMap<string, number>;
	/** Deadline starts: the topics that are plan nodes of today's study sessions. */
	studiedToday?: ReadonlySet<string>;
}): StudyTopic[] {
	const byId = new Map(input.topics.map((t) => [t.id, t]));
	const candidates = inClassOrder(
		[...new Set(input.topicIds)].flatMap((id) => {
			const t = byId.get(id);
			return t ? [{ id: t.id, name: t.name, mode: studyMode(t.status), factIds: topicFacts(input.facts, t).map((f) => f.id) }] : [];
		}),
		input.classOrder,
	);
	const today = input.studiedToday;
	// "check" is exactly the strong topics.
	const tier = (t: StudyTopic) => (!today ? 0 : t.mode === "check" ? 2 : today.has(t.id) ? 1 : 0);
	const kept = new Set<StudyTopic>();
	let count = 0;
	for (const t of [...candidates].sort((a, b) => tier(a) - tier(b))) {
		if (kept.size > 0 && count + t.factIds.length > MAX_STUDY_FACTS) break;
		kept.add(t);
		count += t.factIds.length;
	}
	return candidates.filter((t) => kept.has(t)).map((t) => ({ ...t, factIds: t.factIds.slice(0, MAX_STUDY_FACTS) }));
}

/** A Study start's title and first message on class topics. */
export function studyTitle(topics: readonly Pick<StudyTopic, "name">[]): string {
	return `Study: ${topics.map((t) => t.name).join(", ")}`;
}

const MODE_NOTE: Record<StudyMode, string> = {
	teach: "teach (never tested)",
	problems: "problems (weak or shaky)",
	check: "check (strong)",
};

/** The study context's model-facing text: names, modes and fact ids only
 *  (the graph context above it carries the statements). */
export function studyContextText(topics: readonly StudyTopic[]): string {
	return [
		"[Study plan] — this session's topics, in the order the class covered them, each with its plan node and its mode from the learner's track record:",
		...topics.map(
			(t, i) =>
				`${i + 1}. ${t.name} — node ${t.id}, ${MODE_NOTE[t.mode]}${t.factIds.length > 0 ? `, facts ${t.factIds.join(", ")}` : ", no facts in the class graph yet"}`,
		),
	].join("\n");
}

/** The plan the app writes for a study session: one node per topic, in
 *  class order (the step bar keeps authored order when there are no edges). */
export function studyPlanTree(topics: readonly StudyTopic[]): PlanTree {
	return createTree(
		topics.map((t) => ({ id: t.id, title: t.name })),
		[],
	);
}

/** The topics a deadline's Study button studies: today's planned topics,
 *  or all its topics once every one is strong (or the plan is over). */
export function deadlineStudyTopicIds(today: string, deadline: Pick<DeadlineProgress, "date" | "topics">): string[] {
	const plan = planDays(today, deadline.date, deadline.topics);
	return (plan[0]?.topics ?? deadline.topics).map((t) => t.id);
}

/**
 * STUDY: one session over the picked topics. At the start the app turns
 * the picked facts into the session's topics, in the order the space
 * covered them, each with its material (from the topic grouper) and where
 * the learner stands on it from his track record. The study prompt's move
 * table picks each topic's move from that pair.
 *
 * The topics become the study context the agent reads and the plan the
 * step bar shows (one node per topic). Pure and browser-safe.
 */
import { daysBetween, topicFacts, type AnswerOutcome, type DeadlineProgress, type FactProgress, type TopicProgress, type TopicStatus } from "./progress.ts";
import type { PlanTree, TopicMaterial } from "./contracts.ts";
import { planDays } from "./deadline-plan.ts";
import { dateInName } from "./file-series.ts";
import { createTree } from "./plan-tree.ts";
import { localDay } from "./today-note.ts";

interface StudyTopic {
	/** The plan node id: the space topic's id, or FREE_TOPIC_ID. */
	id: string;
	name: string;
	material?: TopicMaterial;
	status: TopicStatus;
	/** Weak and his latest answer on it was not right (the status is a lifetime
	 *  rate, so a topic can stay weak after he has caught up). */
	latestWrong?: true;
	/** The picked facts in this topic (empty for a typed topic). */
	factIds: string[];
}

/** The plan node of a typed topic that matches no fact. */
export const FREE_TOPIC_ID = "topic";

/** A weak topic whose newest answer was not right: taught first again. */
const isLatestWrong = (status: TopicStatus, latest: AnswerOutcome | undefined) => status === "weak" && latest !== "right";

type StudiedTopic = Pick<TopicProgress, "id" | "name" | "members" | "material" | "status" | "answers">;

function studyTopic(t: StudiedTopic, factIds: string[]): StudyTopic {
	const latestWrong = isLatestWrong(t.status, t.answers.at(-1)?.outcome);
	return {
		id: t.id,
		name: t.name,
		...(t.material ? { material: t.material } : {}),
		status: t.status,
		...(latestWrong ? { latestWrong: true as const } : {}),
		factIds,
	};
}

/**
 * Each fact's place in the space's order: the files sorted the way the
 * deadline page lists days (dated files by date, then undated ones
 * by name), and a fact sits where the file it came from sits. Facts born
 * in a lesson have no place.
 */
export function factSpaceOrder(
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
 * The session's topics: the picked facts grouped by their space topic,
 * in space order (a topic sits at its earliest fact; facts from no space
 * file go last; ties keep the order the facts were picked in). When no
 * picked fact is in a topic, the typed topic is the one untested topic.
 */
export function studyTopics(input: {
	/** The picked fact ids, in the order they were sent. */
	factIds: readonly string[];
	topics: readonly StudiedTopic[];
	spaceOrder: ReadonlyMap<string, number>;
	freeTopic: string;
}): StudyTopic[] {
	const topicOf = new Map<string, (typeof input.topics)[number]>();
	for (const t of input.topics) for (const id of t.members) topicOf.set(id, t);
	const groups = new Map<string, StudyTopic>();
	for (const id of input.factIds) {
		const topic = topicOf.get(id);
		if (!topic) continue;
		const group = groups.get(topic.id);
		if (!group) groups.set(topic.id, studyTopic(topic, [id]));
		else if (!group.factIds.includes(id)) group.factIds.push(id);
	}
	if (groups.size === 0) return [{ id: FREE_TOPIC_ID, name: input.freeTopic, status: "untested", factIds: [] }];
	return inSpaceOrder([...groups.values()], input.spaceOrder);
}

/** Topics sorted by their earliest fact's place in the space; facts from
 *  no space file go last and ties keep their order. */
function inSpaceOrder(topics: readonly StudyTopic[], spaceOrder: ReadonlyMap<string, number>): StudyTopic[] {
	const rank = (t: StudyTopic) => Math.min(Infinity, ...t.factIds.map((id) => spaceOrder.get(id) ?? Infinity));
	return topics
		.map((t) => ({ t, rank: rank(t) }))
		.sort((a, b) => a.rank - b.rank)
		.map((r) => r.t);
}

/** A session holds at most this many facts. */
export const MAX_STUDY_FACTS = 64;

/**
 * A session on space topics (a Study start on topics or on a deadline):
 * each topic with its facts, the ones to fix first. Whole topics fill the
 * session until the next one would pass MAX_STUDY_FACTS facts (always at
 * least one; one bigger than that keeps its first MAX_STUDY_FACTS facts),
 * and the kept ones are listed in space order.
 *
 * Topics fill in space order. A deadline start passes `studiedToday`, so
 * each Study click moves on: first the topics that are not strong and
 * were not studied today, then not strong but studied today, then strong,
 * each group in space order.
 */
export function topicStudy(input: {
	topicIds: readonly string[];
	topics: readonly StudiedTopic[];
	facts: readonly FactProgress[];
	spaceOrder: ReadonlyMap<string, number>;
	/** Deadline starts: the topics that are plan nodes of today's study sessions. */
	studiedToday?: ReadonlySet<string>;
}): StudyTopic[] {
	const byId = new Map(input.topics.map((t) => [t.id, t]));
	const candidates = inSpaceOrder(
		[...new Set(input.topicIds)].flatMap((id) => {
			const t = byId.get(id);
			return t ? [studyTopic(t, topicFacts(input.facts, t).map((f) => f.id))] : [];
		}),
		input.spaceOrder,
	);
	const today = input.studiedToday;
	const tier = (t: StudyTopic) => (!today ? 0 : t.status === "strong" ? 2 : today.has(t.id) ? 1 : 0);
	const kept = new Set<StudyTopic>();
	let count = 0;
	for (const t of [...candidates].sort((a, b) => tier(a) - tier(b))) {
		if (kept.size > 0 && count + t.factIds.length > MAX_STUDY_FACTS) break;
		kept.add(t);
		count += t.factIds.length;
	}
	return candidates.filter((t) => kept.has(t)).map((t) => ({ ...t, factIds: t.factIds.slice(0, MAX_STUDY_FACTS) }));
}

/** A Study start's title and first message on space topics. */
export function studyTitle(topics: readonly Pick<StudyTopic, "name">[]): string {
	return `Study: ${topics.map((t) => t.name).join(", ")}`;
}

/** "procedure, weak (latest wrong)": what the study prompt's move table reads. */
function materialAndStanding(t: StudyTopic): string {
	return `${t.material ? `${t.material}, ` : ""}${t.status}${t.latestWrong ? " (latest wrong)" : ""}`;
}

/** The study context's model-facing text: names, standings and fact ids
 *  only (the graph context above it carries the statements). */
export function studyContextText(topics: readonly StudyTopic[]): string {
	return [
		"[Study plan] — this session's topics, in the order the space covered them, each with its plan node, its material and where he stands from his track record:",
		...topics.map(
			(t, i) =>
				`${i + 1}. ${t.name} — node ${t.id}, ${materialAndStanding(t)}${t.factIds.length > 0 ? `, facts ${t.factIds.join(", ")}` : ", no facts in the space graph yet"}`,
		),
	].join("\n");
}

/** The plan the app writes for a study session: one node per topic, in
 *  space order (the step bar keeps authored order when there are no edges). */
export function studyPlanTree(topics: readonly StudyTopic[]): PlanTree {
	return createTree(
		topics.map((t) => ({ id: t.id, title: t.name })),
		[],
	);
}

/** A strong topic is checked again once its newest answer is this many days old. */
const RECHECK_DAYS = 7;

/** The topics a deadline's Study button studies: today's planned topics
 *  and the strong ones not answered for RECHECK_DAYS days, or all its
 *  topics once every one is strong (or the plan is over). */
export function deadlineStudyTopicIds(
	today: string,
	deadline: Pick<DeadlineProgress, "date" | "topics">,
	topics: ReadonlyArray<Pick<TopicProgress, "id" | "status" | "answers">>,
): string[] {
	const planned = planDays(today, deadline.date, deadline.topics)[0]?.topics;
	if (!planned) return deadline.topics.map((t) => t.id);
	const inDeadline = new Set(deadline.topics.map((t) => t.id));
	const recheck = topics.filter((t) => {
		const newest = t.answers[t.answers.length - 1]?.answeredAt;
		return inDeadline.has(t.id) && t.status === "strong" && !!newest && daysBetween(localDay(Date.parse(newest)), today) >= RECHECK_DAYS;
	});
	return [...planned, ...recheck].map((t) => t.id);
}

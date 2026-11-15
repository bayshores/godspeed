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
import { daysBetween, type AnswerOutcome, type DeadlineProgress, type TopicProgress, type TopicStatus } from "./progress.ts";
import type { TopicMaterial } from "./contracts.ts";
import { planDays } from "./deadline-plan.ts";
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

/** A weak topic whose newest answer was not right or solved with hints: taught first again. */
const isLatestWrong = (status: TopicStatus, latest: AnswerOutcome | undefined) => status === "weak" && latest !== "right" && latest !== "hinted";

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

/** A strong topic is checked again once its newest answer is this many days old. */
const RECHECK_DAYS = 7;

/** The topics a deadline's Study button studies: today's planned topics
 *  and the strong ones not answered for RECHECK_DAYS days, or all its
 *  topics once every one is strong, the plan is over, or today has nothing
 *  left. */
export function deadlineStudyTopicIds(
	today: string,
	deadline: Pick<DeadlineProgress, "date" | "topics">,
	topics: ReadonlyArray<Pick<TopicProgress, "id" | "status" | "answers">>,
): string[] {
	const planned = planDays(today, deadline.date, deadline.topics)[0]?.topics;
	// Today is empty once every topic left was finished today: Study takes them all again.
	if (!planned?.length) return deadline.topics.map((t) => t.id);
	const inDeadline = new Set(deadline.topics.map((t) => t.id));
	const recheck = topics.filter((t) => {
		const newest = t.answers[t.answers.length - 1]?.answeredAt;
		return inDeadline.has(t.id) && t.status === "strong" && !!newest && daysBetween(localDay(Date.parse(newest)), today) >= RECHECK_DAYS;
	});
	return [...planned, ...recheck].map((t) => t.id);
}

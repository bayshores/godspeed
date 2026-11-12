/**
 * PROGRESS — the server half of GET /api/progress: reads one space scope's
 * graph, topic snapshot, files, deadlines and lessons, and hands them to the
 * pure derivation (core/progress.ts deriveProgress). A study session's
 * topics, and which ones a Study start picks, derive from the same read.
 * Nothing is written.
 */
import type { SpaceRecord, SpaceScope } from "../../shared/core/contracts.ts";
import { getGraph } from "../../shared/core/graph.ts";
import { collectAnswers, deriveProgress, factsByMessage, factsForAnswer, type AnsweredQuestion, type ProgressPayload } from "../../shared/core/progress.ts";
import { practiceOutcomes, type PracticeOutcome } from "../../shared/core/practice-outcomes.ts";
import { deadlineStudyTopicIds, factSpaceOrder, studyTopics, topicStudy, type StudyTopic } from "../../shared/core/study.ts";
import type { GraphContextPick } from "../../shared/core/native-messages.ts";
import { localDay } from "../../shared/core/today-note.ts";
import { planPositionLh } from "../../shared/core/plan-step-bar.ts";
import type { DeadlineSession } from "../../shared/core/continue-study.ts";
import type { HomeworkSession } from "../../shared/core/homework.ts";
import { sourceIdFor } from "./spaces.ts";
import { graphStoreFor, stores } from "./stores.ts";
import { topicGroupingRunning } from "./topics.ts";

/** Each lesson's graded answers, practice outcomes and (a Study session
 *  started from a deadline) its step bar's count while its record
 *  file is unchanged. Progress is re-read after every background update,
 *  and parsing every lesson each time grows with the term. Shared: never mutated. */
interface LessonReadout {
	answers: readonly AnsweredQuestion[];
	outcomes: readonly PracticeOutcome[];
	steps: { done: number; total: number } | null;
}
const readoutCache = new Map<string, { version: string } & LessonReadout>();

function lessonReadout(chatId: string): LessonReadout | null {
	const version = stores.chatStore.chatVersion(chatId);
	if (version === null) return null;
	const hit = readoutCache.get(chatId);
	if (hit?.version === version) return hit;
	const record = stores.chatStore.getChat(chatId);
	if (!record) return null;
	const readout = {
		version,
		answers: collectAnswers(chatId, record.messages),
		outcomes: practiceOutcomes(record.messages),
		steps: record.deadlineId && record.tree ? planPositionLh(record.tree, record.messages) : null,
	};
	readoutCache.set(chatId, readout);
	return readout;
}

/** The space's problems (practice and study) the learner solved only with hints. */
export function hintedProblems(spaceId: string): { statement: string; at: string }[] {
	return stores.chatStore
		.listChats()
		.filter((c) => c.spaceId === spaceId)
		.flatMap((c) => lessonReadout(c.id)?.outcomes ?? [])
		.filter((o) => o.outcome === "solvedWithHints")
		.map((o) => ({ statement: o.statement, at: o.at }));
}

/** The space's mistakes: answers given wrong and problems solved only
 *  with hints, each with the topics its facts are in (the cheat sheet's
 *  Watch out block). */
export function spaceMistakes(spaceId: string, progress: ProgressPayload): { text: string; kind: "wrong" | "hint"; at: string; topicIds: string[] }[] {
	const index = factsByMessage(getGraph(graphStoreFor(spaceId)).nodes);
	const topicOf = new Map(progress.facts.map((f) => [f.id, f.topicId]));
	const topicsOf = (factIds: readonly string[]) => [...new Set(factIds.map((id) => topicOf.get(id)).filter((t): t is string => !!t))];
	return stores.chatStore
		.listChats()
		.filter((c) => c.spaceId === spaceId)
		.flatMap((c) => {
			const readout = lessonReadout(c.id);
			if (!readout) return [];
			return [
				...readout.answers.filter((a) => a.outcome === "wrong").map((a) => ({ text: a.question, kind: "wrong" as const, at: a.answeredAt, topicIds: topicsOf(factsForAnswer(a, index)) })),
				...readout.outcomes.filter((o) => o.outcome === "solvedWithHints").map((o) => ({ text: o.statement, kind: "hint" as const, at: o.at, topicIds: topicsOf(o.targets) })),
			];
		});
}

/** Each fact's place in the space's order (core/study.ts factSpaceOrder). */
export function spaceOrderFor(spaceId: string, progress: ProgressPayload): Map<string, number> {
	return factSpaceOrder(progress.facts, progressFiles(stores.spaceStore.getSpace(spaceId)));
}

/** The space's files with the source id their facts are born under. */
function progressFiles(record: SpaceRecord | null) {
	return (record?.files ?? []).map((f) => ({ id: f.id, name: f.name, kind: f.kind, sourceId: f.sourceId ?? sourceIdFor(record!.id, f.id) }));
}

/** Everything the Overview and the Graph page need for one scope. Returns
 *  null when the space does not exist. */
export function progressFor(scope: SpaceScope, opts: { today?: string } = {}): ProgressPayload | null {
	const record = scope === null ? null : stores.spaceStore.getSpace(scope);
	if (scope !== null && !record) return null;
	const store = graphStoreFor(scope);
	const graph = getGraph(store);
	const chats = stores.chatStore.listChats();
	const known = new Set(chats.map((c) => c.id));
	for (const id of readoutCache.keys()) if (!known.has(id)) readoutCache.delete(id);
	const lessons = [];
	const deadlineSessions: DeadlineSession[] = [];
	const homeworkSessions: HomeworkSession[] = [];
	for (const c of chats) {
		if ((c.spaceId ?? null) !== scope) continue;
		if (c.kind === "homework" && c.deadlineId) homeworkSessions.push({ chatId: c.id, deadlineId: c.deadlineId, createdAt: c.createdAt });
		const readout = lessonReadout(c.id);
		if (!readout) continue;
		lessons.push({ id: c.id, title: c.title, kind: c.kind, updatedAt: c.updatedAt, answers: readout.answers });
		if (c.deadlineId && readout.steps) deadlineSessions.push({ chatId: c.id, deadlineId: c.deadlineId, createdAt: c.createdAt, ...readout.steps });
	}
	return deriveProgress({
		spaceId: scope,
		today: opts.today ?? localDay(),
		facts: graph.nodes,
		chains: graph.chains,
		topics: store.readTopics(),
		files: progressFiles(record),
		deadlines: record?.deadlines ?? [],
		lessons,
		deadlineSessions,
		homeworkSessions,
		grouping: topicGroupingRunning(scope),
	});
}

/** A study session's topics from its picked facts: grouped by space topic,
 *  in space order, each with its mode (core/study.ts). */
export function studyTopicsFor(scope: SpaceScope, factIds: readonly string[], freeTopic: string): StudyTopic[] {
	const progress = factIds.length > 0 ? progressFor(scope) : null;
	const record = scope === null ? null : stores.spaceStore.getSpace(scope);
	return studyTopics({
		factIds,
		topics: progress?.topics ?? [],
		spaceOrder: progress ? factSpaceOrder(progress.facts, progressFiles(record)) : new Map(),
		freeTopic,
	});
}

/** A study session on space topics: its topics (core/study.ts topicStudy)
 *  and their facts as the graph-context picks. */
interface TopicStudy {
	topics: StudyTopic[];
	picks: GraphContextPick[];
}

function topicStudyIn(scope: SpaceScope, progress: ProgressPayload, topicIds: readonly string[], studiedToday?: ReadonlySet<string>): TopicStudy {
	const record = scope === null ? null : stores.spaceStore.getSpace(scope);
	const topics = topicStudy({ topicIds, topics: progress.topics, facts: progress.facts, spaceOrder: factSpaceOrder(progress.facts, progressFiles(record)), studiedToday });
	const factById = new Map(progress.facts.map((f) => [f.id, f]));
	const picks = topics.flatMap((t) =>
		t.factIds.map((id) => {
			const f = factById.get(id)!;
			return { id, name: f.name, statement: f.statement };
		}),
	);
	return { topics, picks };
}

/** A Study start on some of the space's topics. */
export function topicStudyFor(scope: SpaceScope, topicIds: readonly string[]): TopicStudy {
	const progress = progressFor(scope);
	return progress ? topicStudyIn(scope, progress, topicIds) : { topics: [], picks: [] };
}

/** A Study start on a deadline: its topics for today (deadlineStudyTopicIds),
 *  the next ones that need work first. Null when the space has no such deadline. */
export function deadlineStudyFor(spaceId: string, deadlineId: string): (TopicStudy & { name: string }) | null {
	const progress = progressFor(spaceId);
	const deadline = progress?.deadlines.find((d) => d.id === deadlineId);
	if (!progress || !deadline) return null;
	const studied = studiedOn(spaceId, progress.today);
	return { name: deadline.name, ...topicStudyIn(spaceId, progress, deadlineStudyTopicIds(progress.today, deadline), studied) };
}

/** The plan nodes of the space's study sessions created on `day` (the learner's local day). */
function studiedOn(spaceId: string, day: string): Set<string> {
	const ids = new Set<string>();
	for (const c of stores.chatStore.listChats()) {
		if (c.kind !== "study" || c.spaceId !== spaceId || localDay(Date.parse(c.createdAt)) !== day) continue;
		for (const node of stores.chatStore.getChat(c.id)?.tree?.nodes ?? []) ids.add(node.id);
	}
	return ids;
}

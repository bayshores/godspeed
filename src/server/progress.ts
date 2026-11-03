/**
 * PROGRESS — the server half of GET /api/progress: reads one class scope's
 * graph, topic snapshot, files, deadlines and lessons, and hands them to the
 * pure derivation (core/progress.ts deriveProgress). A study session's
 * topics, and which ones a Study start picks, derive from the same read.
 * Nothing is written.
 */
import type { ClassRecord, ClassScope } from "../core/contracts.ts";
import { getGraph } from "../core/graph.ts";
import { collectAnswers, deriveProgress, type AnsweredQuestion, type ProgressPayload } from "../core/progress.ts";
import { practiceOutcomes, type PracticeOutcome } from "../core/practice-outcomes.ts";
import { deadlineStudyTopicIds, factClassOrder, studyTopics, topicStudy, type StudyTopic } from "../core/study.ts";
import type { GraphContextPick } from "../core/native-messages.ts";
import { localDay } from "../core/today-note.ts";
import { planPositionLh } from "../core/plan-step-bar.ts";
import type { DeadlineSession } from "../core/continue-study.ts";
import { sourceIdFor } from "./classes.ts";
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

/** The class's problems (practice and study) the learner solved only with hints. */
export function hintedProblems(classId: string): { statement: string; at: string }[] {
	return stores.chatStore
		.listChats()
		.filter((c) => c.classId === classId)
		.flatMap((c) => lessonReadout(c.id)?.outcomes ?? [])
		.filter((o) => o.outcome === "solvedWithHints")
		.map((o) => ({ statement: o.statement, at: o.at }));
}

/** The class's files with the source id their facts are born under. */
function progressFiles(record: ClassRecord | null) {
	return (record?.files ?? []).map((f) => ({ id: f.id, name: f.name, kind: f.kind, sourceId: f.sourceId ?? sourceIdFor(record!.id, f.id) }));
}

/** Everything the Overview and the Graph page need for one scope. Returns
 *  null when the class does not exist. */
export function progressFor(scope: ClassScope, opts: { today?: string } = {}): ProgressPayload | null {
	const record = scope === null ? null : stores.classStore.getClass(scope);
	if (scope !== null && !record) return null;
	const store = graphStoreFor(scope);
	const graph = getGraph(store);
	const chats = stores.chatStore.listChats();
	const known = new Set(chats.map((c) => c.id));
	for (const id of readoutCache.keys()) if (!known.has(id)) readoutCache.delete(id);
	const lessons = [];
	const deadlineSessions: DeadlineSession[] = [];
	for (const c of chats) {
		if ((c.classId ?? null) !== scope) continue;
		const readout = lessonReadout(c.id);
		if (!readout) continue;
		lessons.push({ id: c.id, title: c.title, kind: c.kind, updatedAt: c.updatedAt, answers: readout.answers });
		if (c.deadlineId && readout.steps) deadlineSessions.push({ chatId: c.id, deadlineId: c.deadlineId, createdAt: c.createdAt, ...readout.steps });
	}
	return deriveProgress({
		classId: scope,
		today: opts.today ?? localDay(),
		facts: graph.nodes,
		chains: graph.chains,
		topics: store.readTopics(),
		files: progressFiles(record),
		deadlines: record?.deadlines ?? [],
		lessons,
		deadlineSessions,
		grouping: topicGroupingRunning(scope),
	});
}

/** A study session's topics from its picked facts: grouped by class topic,
 *  in class order, each with its mode (core/study.ts). */
export function studyTopicsFor(scope: ClassScope, factIds: readonly string[], freeTopic: string): StudyTopic[] {
	const progress = factIds.length > 0 ? progressFor(scope) : null;
	const record = scope === null ? null : stores.classStore.getClass(scope);
	return studyTopics({
		factIds,
		topics: progress?.topics ?? [],
		classOrder: progress ? factClassOrder(progress.facts, progressFiles(record)) : new Map(),
		freeTopic,
	});
}

/** A study session on class topics: its topics (core/study.ts topicStudy)
 *  and their facts as the graph-context picks. */
interface TopicStudy {
	topics: StudyTopic[];
	picks: GraphContextPick[];
}

function topicStudyIn(scope: ClassScope, progress: ProgressPayload, topicIds: readonly string[], studiedToday?: ReadonlySet<string>): TopicStudy {
	const record = scope === null ? null : stores.classStore.getClass(scope);
	const topics = topicStudy({ topicIds, topics: progress.topics, facts: progress.facts, classOrder: factClassOrder(progress.facts, progressFiles(record)), studiedToday });
	const factById = new Map(progress.facts.map((f) => [f.id, f]));
	const picks = topics.flatMap((t) =>
		t.factIds.map((id) => {
			const f = factById.get(id)!;
			return { id, name: f.name, statement: f.statement };
		}),
	);
	return { topics, picks };
}

/** A Study start on some of the class's topics. */
export function topicStudyFor(scope: ClassScope, topicIds: readonly string[]): TopicStudy {
	const progress = progressFor(scope);
	return progress ? topicStudyIn(scope, progress, topicIds) : { topics: [], picks: [] };
}

/** A Study start on a deadline: its topics for today (deadlineStudyTopicIds),
 *  the next ones that need work first. Null when the class has no such deadline. */
export function deadlineStudyFor(classId: string, deadlineId: string): (TopicStudy & { name: string }) | null {
	const progress = progressFor(classId);
	const deadline = progress?.deadlines.find((d) => d.id === deadlineId);
	if (!progress || !deadline) return null;
	const studied = studiedOn(classId, progress.today);
	return { name: deadline.name, ...topicStudyIn(classId, progress, deadlineStudyTopicIds(progress.today, deadline), studied) };
}

/** The plan nodes of the class's study sessions created on `day` (the learner's local day). */
function studiedOn(classId: string, day: string): Set<string> {
	const ids = new Set<string>();
	for (const c of stores.chatStore.listChats()) {
		if (c.kind !== "study" || c.classId !== classId || localDay(Date.parse(c.createdAt)) !== day) continue;
		for (const node of stores.chatStore.getChat(c.id)?.tree?.nodes ?? []) ids.add(node.id);
	}
	return ids;
}

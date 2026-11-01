/**
 * PROGRESS — the server half of GET /api/progress: reads one class scope's
 * graph, topic snapshot, files, deadlines and lessons, and hands them to the
 * pure derivation (core/progress.ts deriveProgress). Nothing is written.
 */
import type { ClassScope } from "../core/contracts.ts";
import { getGraph } from "../core/graph.ts";
import { collectAnswers, deriveProgress, type AnsweredQuestion, type ProgressPayload } from "../core/progress.ts";
import { localDay } from "../core/today-note.ts";
import { sourceIdFor } from "./classes.ts";
import { graphStoreFor, stores } from "./stores.ts";
import { topicGroupingRunning } from "./topics.ts";

/** Each lesson's graded answers while its record file is unchanged.
 *  Progress is re-read after every background update, and parsing every
 *  lesson each time grows with the term. Answers are shared: never mutated. */
const answersCache = new Map<string, { version: string; answers: readonly AnsweredQuestion[] }>();

function lessonAnswers(chatId: string): readonly AnsweredQuestion[] | null {
	const version = stores.chatStore.chatVersion(chatId);
	if (version === null) return null;
	const hit = answersCache.get(chatId);
	if (hit?.version === version) return hit.answers;
	const record = stores.chatStore.getChat(chatId);
	if (!record) return null;
	const answers = collectAnswers(chatId, record.messages);
	answersCache.set(chatId, { version, answers });
	return answers;
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
	for (const id of answersCache.keys()) if (!known.has(id)) answersCache.delete(id);
	const lessons = chats
		.filter((c) => (c.classId ?? null) === scope)
		.flatMap((c) => {
			const answers = lessonAnswers(c.id);
			return answers ? [{ id: c.id, title: c.title, kind: c.kind, updatedAt: c.updatedAt, answers }] : [];
		});
	return deriveProgress({
		classId: scope,
		today: opts.today ?? localDay(),
		facts: graph.nodes,
		chains: graph.chains,
		topics: store.readTopics(),
		files: (record?.files ?? []).map((f) => ({ id: f.id, name: f.name, kind: f.kind, sourceId: f.sourceId ?? sourceIdFor(record!.id, f.id) })),
		deadlines: record?.deadlines ?? [],
		lessons,
		grouping: topicGroupingRunning(scope),
	});
}

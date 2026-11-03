/**
 * PROGRESS — the server half of GET /api/progress: reads one class scope's
 * graph, topic snapshot, files, deadlines and lessons, and hands them to the
 * pure derivation (core/progress.ts deriveProgress). Nothing is written.
 */
import type { ClassScope } from "../core/contracts.ts";
import { getGraph } from "../core/graph.ts";
import { collectAnswers, deriveProgress, type AnsweredQuestion, type ProgressPayload } from "../core/progress.ts";
import { practiceOutcomes, type PracticeOutcome } from "../core/practice-outcomes.ts";
import { localDay } from "../core/today-note.ts";
import { sourceIdFor } from "./classes.ts";
import { graphStoreFor, stores } from "./stores.ts";
import { topicGroupingRunning } from "./topics.ts";

/** Each lesson's graded answers and practice outcomes while its record
 *  file is unchanged. Progress is re-read after every background update,
 *  and parsing every lesson each time grows with the term. Shared: never mutated. */
interface LessonReadout {
	answers: readonly AnsweredQuestion[];
	outcomes: readonly PracticeOutcome[];
}
const readoutCache = new Map<string, { version: string } & LessonReadout>();

function lessonReadout(chatId: string): LessonReadout | null {
	const version = stores.chatStore.chatVersion(chatId);
	if (version === null) return null;
	const hit = readoutCache.get(chatId);
	if (hit?.version === version) return hit;
	const record = stores.chatStore.getChat(chatId);
	if (!record) return null;
	const readout = { version, answers: collectAnswers(chatId, record.messages), outcomes: practiceOutcomes(record.messages) };
	readoutCache.set(chatId, readout);
	return readout;
}

/** The class's practice problems the learner solved only with hints. */
export function hintedProblems(classId: string): { statement: string; at: string }[] {
	return stores.chatStore
		.listChats()
		.filter((c) => c.classId === classId && c.kind === "practice")
		.flatMap((c) => lessonReadout(c.id)?.outcomes ?? [])
		.filter((o) => o.outcome === "solvedWithHints")
		.map((o) => ({ statement: o.statement, at: o.at }));
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
	const lessons = chats
		.filter((c) => (c.classId ?? null) === scope)
		.flatMap((c) => {
			const readout = lessonReadout(c.id);
			return readout ? [{ id: c.id, title: c.title, kind: c.kind, updatedAt: c.updatedAt, answers: readout.answers }] : [];
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

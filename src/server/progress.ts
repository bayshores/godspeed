/**
 * PROGRESS — the server half of GET /api/progress (redesign plan,
 * owner-approved 2026-10-27): reads one class scope's graph, topic
 * snapshot, files, exams and lessons, and hands them to the pure
 * derivation (core/progress.ts deriveProgress). Nothing is written.
 */
import type { ClassScope } from "../core/contracts.ts";
import { getGraph } from "../core/graph.ts";
import { deriveProgress, type ProgressPayload } from "../core/progress.ts";
import { sourceIdFor } from "./classes.ts";
import { graphStoreFor, stores } from "./stores.ts";
import { topicGroupingRunning } from "./topics.ts";

/** This computer's calendar day, YYYY-MM-DD (the app runs locally, so the
 *  server's day is the learner's). */
export function localToday(now = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Everything the Overview and the Graph page need for one scope. Returns
 *  null when the class does not exist. */
export function progressFor(scope: ClassScope, opts: { today?: string } = {}): ProgressPayload | null {
	const record = scope === null ? null : stores.classStore.getClass(scope);
	if (scope !== null && !record) return null;
	const store = graphStoreFor(scope);
	const graph = getGraph(store);
	const lessons = stores.chatStore
		.listChats()
		.filter((c) => (c.classId ?? null) === scope)
		.map((c) => stores.chatStore.getChat(c.id))
		.filter((r): r is NonNullable<typeof r> => r !== null)
		.map((r) => ({ id: r.id, title: r.title, kind: r.kind, updatedAt: r.updatedAt, messages: r.messages }));
	return deriveProgress({
		classId: scope,
		today: opts.today ?? localToday(),
		facts: graph.nodes,
		chains: graph.chains,
		topics: store.readTopics(),
		files: (record?.files ?? []).map((f) => ({ id: f.id, name: f.name, kind: f.kind, sourceId: f.sourceId ?? sourceIdFor(record!.id, f.id) })),
		exams: record?.exams ?? [],
		lessons,
		grouping: topicGroupingRunning(scope),
	});
}

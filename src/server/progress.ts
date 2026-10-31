/**
 * PROGRESS — the server half of GET /api/progress: reads one class scope's
 * graph, topic snapshot, files, deadlines and lessons, and hands them to the
 * pure derivation (core/progress.ts deriveProgress). Nothing is written.
 */
import type { ClassScope } from "../core/contracts.ts";
import { getGraph } from "../core/graph.ts";
import { deriveProgress, type ProgressPayload } from "../core/progress.ts";
import { localDay } from "../core/today-note.ts";
import { sourceIdFor } from "./classes.ts";
import { graphStoreFor, stores } from "./stores.ts";
import { topicGroupingRunning } from "./topics.ts";

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

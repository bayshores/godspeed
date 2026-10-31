/**
 * TOPIC GROUPING — scheduling and running the topic grouper.
 *
 *  - After an extraction ends in a class graph (onGraphWritten), and when a
 *    class's file queue drains, scheduleTopicGrouping(classId) runs:
 *    DEBOUNCED (20 s) and SINGLE-FLIGHT per class (a request while a run is
 *    going queues exactly one more run after it).
 *  - A run is skipped when the graph has fewer than 4 facts, when the
 *    knowledge graph is off, or (for scheduled runs) when the class still
 *    has files waiting or being read — grouping re-reads the whole graph,
 *    so an import of many files groups once, at the end — or when the fact
 *    set is exactly the one the last snapshot grouped.
 *  - The run shows in the activity dock (the extraction registry, kind
 *    "topics", label "Topic grouping · <class>"); the dock's abort stops it.
 *  - It runs on the outside agent (MCP) as a labeled work item.
 *  - Result: one full snapshot appended to the graph's topics.jsonl.
 *
 * groupTopicsNow(scope) is the manual trigger (for the UI / later MCP).
 */
import { abortExtraction, finishBackgroundGraphRun, startBackgroundGraphRun } from "../agent/subagents/extraction.ts";
import { groupTopics } from "../agent/subagents/topic-grouper.ts";
import { withBgLlmSlot } from "../agent/subagents/bg-llm-semaphore.ts";
import { agentEngine, type PiEngine } from "../agent/models.ts";
import type { ClassScope } from "../core/contracts.ts";
import { getGraph } from "../core/graph.ts";
import { MIN_FACTS_FOR_TOPICS, resolveTopics, sameFactSet } from "../core/topics.ts";
import { effectiveSettings, graphStoreFor, stores } from "./stores.ts";

/** How long the scheduler waits for more graph writes before running. */
const TOPIC_GROUPING_DEBOUNCE_MS = 20_000;

type TopicGroupingOutcome =
	| { status: "grouped"; topics: number; facts: number }
	| { status: "queued" }
	| { status: "skipped"; reason: "too_few_facts" | "unchanged" | "graph_off" | "no_class" | "files_waiting" }
	| { status: "aborted" }
	| { status: "failed"; error: string };

/** Test seams: a scripted engine (in place of the outside agent),
 *  and permission to schedule under NODE_ENV=test (off by default so the
 *  real pipeline's hook never leaves timers in unrelated tests). */
export const topicGroupingSeams: { engine?: PiEngine; enabledInTests?: boolean; debounceMs?: number } = {};

interface TopicGroupingState {
	timers: Map<string, ReturnType<typeof setTimeout>>;
	running: Map<string, Promise<TopicGroupingOutcome>>;
	/** Scopes asked for again while running: one more run follows. */
	again: Set<string>;
}

/** globalThis: Next can load this module more than once (the registry idiom). */
function state(): TopicGroupingState {
	const g = globalThis as typeof globalThis & { __lhTopicGrouping?: TopicGroupingState };
	return (g.__lhTopicGrouping ??= { timers: new Map(), running: new Map(), again: new Set() });
}

const keyOf = (scope: ClassScope) => scope ?? "none";
const scopeOf = (key: string): ClassScope => (key === "none" ? null : key);

/** The dock / abort key of a scope's grouping run. */
export function topicRunKey(scope: ClassScope): string {
	return `topics:${keyOf(scope)}`;
}

/** True while a grouping run for the scope is going. */
export function topicGroupingRunning(scope: ClassScope): boolean {
	return state().running.has(keyOf(scope));
}

/** Debounced, single-flight request for a grouping run. */
export function scheduleTopicGrouping(scope: ClassScope, delayMs = topicGroupingSeams.debounceMs ?? TOPIC_GROUPING_DEBOUNCE_MS): void {
	if (process.env.NODE_ENV === "test" && !topicGroupingSeams.enabledInTests) return;
	const s = state();
	const key = keyOf(scope);
	const prev = s.timers.get(key);
	if (prev) clearTimeout(prev);
	const timer = setTimeout(() => {
		s.timers.delete(key);
		void runSingleFlight(key, false);
	}, delayMs);
	timer.unref?.();
	s.timers.set(key, timer);
}

/** The manual trigger: run now (a pending debounce is folded in). By
 *  default it regroups even when the fact set is unchanged. While a run is
 *  going, one more is queued after it ({status: "queued"}). */
export function groupTopicsNow(scope: ClassScope, opts: { force?: boolean } = {}): Promise<TopicGroupingOutcome> {
	const s = state();
	const key = keyOf(scope);
	const timer = s.timers.get(key);
	if (timer) {
		clearTimeout(timer);
		s.timers.delete(key);
	}
	return runSingleFlight(key, opts.force ?? true);
}

/** Drop a pending run and stop a running one (a class is being deleted). */
export function cancelTopicGrouping(scope: ClassScope): void {
	const s = state();
	const key = keyOf(scope);
	const timer = s.timers.get(key);
	if (timer) clearTimeout(timer);
	s.timers.delete(key);
	s.again.delete(key);
	abortExtraction(topicRunKey(scope));
}

/** Resolves when no grouping run for the scope is going (tests). */
export async function topicGroupingIdle(scope: ClassScope): Promise<void> {
	for (;;) {
		const running = state().running.get(keyOf(scope));
		if (!running) return;
		await running.catch(() => {});
	}
}

function runSingleFlight(key: string, force: boolean): Promise<TopicGroupingOutcome> {
	const s = state();
	if (s.running.has(key)) {
		s.again.add(key);
		return Promise.resolve({ status: "queued" });
	}
	const run = groupOnce(scopeOf(key), force)
		.catch((err: unknown): TopicGroupingOutcome => {
			console.error(`[topics ${key}] grouping failed:`, err);
			return { status: "failed", error: err instanceof Error ? err.message : String(err) };
		})
		.finally(() => {
			s.running.delete(key);
			if (s.again.delete(key)) void runSingleFlight(key, false);
		});
	s.running.set(key, run);
	return run;
}

function backgroundEngine(): PiEngine {
	return topicGroupingSeams.engine ?? agentEngine();
}

async function groupOnce(scope: ClassScope, force: boolean): Promise<TopicGroupingOutcome> {
	const record = scope === null ? null : stores.classStore.getClass(scope);
	const className = scope === null ? "No class" : record?.name;
	if (className === undefined) return { status: "skipped", reason: "no_class" };
	if (!effectiveSettings().graph.enabled) return { status: "skipped", reason: "graph_off" };
	if (!force && record?.files.some((f) => f.status === "pending" || f.status === "extracting")) {
		return { status: "skipped", reason: "files_waiting" };
	}
	const store = graphStoreFor(scope);
	const graph = getGraph(store);
	const facts = graph.nodes;
	if (facts.length < MIN_FACTS_FOR_TOPICS) return { status: "skipped", reason: "too_few_facts" };
	const factIds = facts.map((f) => f.id);
	const last = store.readTopics();
	if (!force && sameFactSet(last, factIds)) return { status: "skipped", reason: "unchanged" };
	const engine = backgroundEngine();

	const runKey = topicRunKey(scope);
	const controller = startBackgroundGraphRun(runKey, `Topic grouping · ${className}`);
	const t0 = performance.now();
	try {
		const current = resolveTopics(last, factIds).filter((t) => !t.ungrouped);
		const topics = await withBgLlmSlot(controller.signal, () =>
			groupTopics({
				className,
				facts: facts.map((f) => ({ id: f.id, name: f.name, statement: f.statement })),
				chains: graph.chains,
				current: current.map(({ id, name, members }) => ({ id, name, members })),
				engine,
				signal: controller.signal,
			}),
		);
		// A class deleted mid-run: never recreate its folder.
		if (scope !== null && !stores.classStore.getClass(scope)) return { status: "aborted" };
		store.appendTopics({ at: new Date().toISOString(), topics });
		console.info(`[topics ${keyOf(scope)}] ${topics.length} topics over ${facts.length} facts (${Math.round(performance.now() - t0)}ms)`);
		return { status: "grouped", topics: topics.length, facts: facts.length };
	} catch (err) {
		if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) return { status: "aborted" };
		throw err;
	} finally {
		finishBackgroundGraphRun(runKey);
	}
}

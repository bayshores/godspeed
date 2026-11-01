import type { ExtractionStageUsage } from "../../core/contracts.ts";
import { emit } from "../../core/events.ts";

/**
 * The registry of running graph jobs (extraction runs and the topic
 * grouper): what the activity dock lists and what its abort button stops.
 */

/** The pipeline phases, in order — what the activity dock shows.
 *  "waiting": queued behind another job's extract + merge (the graph lock).
 *  "grouping": a topic-grouping run (startBackgroundGraphRun). */
export type ExtractionPhase = "waiting" | "extracting" | "merging" | "grouping";

/** One in-flight pipeline run. Module-level: one process, one registry.
 *  Exported for the status payload's consumer typing (the dock). */
export interface RunningExtraction {
	/** The SOURCE id (chat id / notes src id) — the payload's identity and
	 *  the abort key. The registry KEY adds "#i" for chunk jobs (a
	 *  multi-chunk source owns several entries); this field stays the
	 *  source id so the feed's reveal logic and abort stay source-scoped. */
	chatId: string;
	/** PER-CHUNK JOBS: which chunk of how many this
	 *  job is — present only when the source fanned out (n > 1). Drives
	 *  the feed row's "· i/N" suffix. */
	part?: { i: number; n: number };
	/** Which front door the run came through — label + usage-persistence
	 *  depend on it (chats log usage on their chat record; notes on the
	 *  source record). */
	kind: "chat" | "notes" | "topics";
	/** Display label (the file path for notes imports); the activity feed
	 *  falls back to the chat store for chat runs. */
	label?: string;
	phase: ExtractionPhase;
	startedAt: number;
	/** Live per-stage usage, accumulated per step (the activity dock
	 *  reads it through /api/activity). */
	usage: {
		extractor?: ExtractionStageUsage;
	};
	/** True-cancellation handle (the dock's abort button): one controller per
	 *  run, shared across phases; abort() cancels the in-flight model call. */
	controller: AbortController;
}

interface LhExtractionGlobal {
	__lhExtractionRuns?: {
		/** In-flight pipeline runs, keyed chatId (chat) / src id (notes). */
		running: Map<string, RunningExtraction>;
		/** The single-flight guard, shared by every pipeline instance. */
		inFlight: Set<string>;
		/** Last minted startedAt — kept monotonic so two runs starting in the
		 *  same millisecond never collide on the usage idempotency key. */
		lastStartedAt: number;
	};
}

/** THE RUN REGISTRIES live on globalThis, not module level: Next dev
 *  compiles each route entry as its own module instance, so a
 *  module-level Map is a different object in the /api/activity route than
 *  in the pipeline's chat-handler instance. One process, one truth (the
 *  same idiom as the turn, wake, and abort registries); it also makes the
 *  single-flight guard cross route instances. */
export function runs(): NonNullable<LhExtractionGlobal["__lhExtractionRuns"]> {
	const g = globalThis as typeof globalThis & LhExtractionGlobal;
	return (g.__lhExtractionRuns ??= { running: new Map(), inFlight: new Set(), lastStartedAt: 0 });
}

/** In-flight pipeline runs (oldest first), shown in /api/activity. */
export function extractionStatuses(): RunningExtraction[] {
	return [...runs().running.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/** A non-extraction background graph job (the topic grouper) joins the
 *  same registry so the activity dock shows it and
 *  its abort button works (abortExtraction by `key`). One entry per key;
 *  a second start while one is registered returns the running controller.
 *  Call finishBackgroundGraphRun on every exit. */
export function startBackgroundGraphRun(key: string, label: string): AbortController {
	const R = runs();
	const prev = R.running.get(key);
	if (prev) return prev.controller;
	R.lastStartedAt = Math.max(Date.now(), R.lastStartedAt + 1);
	const controller = new AbortController();
	R.running.set(key, { chatId: key, kind: "topics", label, phase: "grouping", startedAt: R.lastStartedAt, usage: {}, controller });
	emit("activity-changed", {});
	return controller;
}

export function finishBackgroundGraphRun(key: string): void {
	if (runs().running.delete(key)) emit("activity-changed", {});
}

/** True cancellation of the in-flight run for a chat (the dock's abort
 *  button): the pending model call receives the signal and is cancelled,
 *  and the run ends like a failure:
 *  nothing merged, nothing checkpointed, partial usage still persisted.
 *  Returns false when no run is in flight (idempotent no-op). */
export function abortExtraction(chatId: string): boolean {
	// A source may own several registry
	// entries (one per chunk/batch) — aborting the source aborts EVERY
	// job of its fan-out.
	let found = false;
	for (const run of runs().running.values()) {
		if (run.chatId !== chatId) continue;
		run.controller.abort();
		found = true;
	}
	return found;
}

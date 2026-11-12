/**
 * The agent requests a prep has out: its sheet and, per mock, the
 * questions or the grades. One at a time per key; each start and end goes
 * out as "prep-changed", and the last failure is kept for Try again.
 */
import { emit } from "../../shared/core/events.ts";
import type { PiEngine } from "../agent/models.ts";

/** Test seam: a scripted engine in place of the outside agent. */
export const prepSeams: { engine?: PiEngine } = {};

interface PrepRuns {
	runs: Map<string, AbortController>;
	/** Why each key's last request failed. */
	failed: Map<string, string>;
}

/** globalThis: Next can load this module more than once. */
function state(): PrepRuns {
	const g = globalThis as typeof globalThis & { __lhPrepRuns?: PrepRuns };
	return (g.__lhPrepRuns ??= { runs: new Map(), failed: new Map() });
}

/** The key of a mock's request (a prep's sheet is keyed by its space id). */
export const mockRunKey = (spaceId: string, mockId: string) => `${spaceId}/${mockId}`;

export const isRunning = (key: string) => state().runs.has(key);
export const runError = (key: string) => state().failed.get(key);

/** Start `work` under `key`; false when that key's request is still out. */
export function startRun(spaceId: string, key: string, work: (signal: AbortSignal) => Promise<void>): boolean {
	const s = state();
	if (s.runs.has(key)) return false;
	const controller = new AbortController();
	s.runs.set(key, controller);
	s.failed.delete(key);
	emit("prep-changed", { spaceId });
	void work(controller.signal)
		.catch((err: unknown) => {
			if (controller.signal.aborted) return;
			console.error(`[prep ${key}] the request failed:`, err);
			s.failed.set(key, err instanceof Error ? err.message : "the request failed");
		})
		.finally(() => {
			// A cancelled run may already have been replaced.
			if (s.runs.get(key) === controller) s.runs.delete(key);
			emit("prep-changed", { spaceId });
		});
	return true;
}

/** Stop one key's request and forget its failure. */
export function cancelRun(key: string): void {
	const s = state();
	s.runs.get(key)?.abort();
	s.runs.delete(key);
	s.failed.delete(key);
}

/** Stop everything a deleted prep had out. */
export function cancelPrepRuns(spaceId: string): void {
	const s = state();
	for (const key of [...s.runs.keys(), ...s.failed.keys()]) {
		if (key === spaceId || key.startsWith(`${spaceId}/`)) cancelRun(key);
	}
}

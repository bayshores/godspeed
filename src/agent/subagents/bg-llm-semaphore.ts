/**
 * THE SHARED BACKGROUND-LLM SEMAPHORE (owner ruling, 2026-09-29): ONE
 * process-wide pool of 3 permits for ALL background LLM jobs — extraction
 * chunks. Total background
 * LLM concurrency is bounded at 3, whoever is calling: no subsystem gets
 * a private lane past the provider-facing stance.
 *
 * Extraction owned this gate alone first (owner, 2026-09-28: at most 3
 * concurrent extractor calls).
 * the ruling then unified them — this module is the single truth, so
 * extraction chunks are the only holders.
 *
 * FIFO; abort-aware (a queued caller that aborts marks its ticket dead —
 * the permit handoff skips it and hands to the next waiter).
 *
 * FRESH-TAKE / HANDED-OFF-PERMIT discipline (the double-count deadlock
 * lesson, extraction 2026-09-28): fresh takers increment `active`
 * themselves; a HANDED-OFF permit does not (the releaser left `active`
 * untouched for the inheritor) — counting both sides is how a semaphore
 * slowly deadlocks at 3-with-empty-queue.
 *
 * The audit side needs no slot: audits serialize behind their own global
 * lock, so by the time a job releases its permit the audit queue is the
 * only remaining throttle.
 */

/** Total background LLM concurrency, process-wide, across ALL subsystems
 *  (owner ruling 2026-09-29: one shared pool — extraction chunks +
 *  extraction chunks). */
const PERMIT_COUNT = 3;

interface LlmSlots {
	active: number;
	queue: { resolve: () => void; dead: boolean }[];
}

interface LhLlmSemaphoreGlobal {
	__lhLlmSlots?: LlmSlots;
}

/** The process's single permit pool (globalThis — Next dev compiles each
 *  route entry as its own module instance; a module-level object would
 *  split the pool per route. One process, one truth). */
function bgLlmSlots(): LlmSlots {
	const g = globalThis as typeof globalThis & LhLlmSemaphoreGlobal;
	return (g.__lhLlmSlots ??= { active: 0, queue: [] });
}

/** Run `critical` under one permit of the shared pool. `signal` (the
 *  caller's row/abort controller) kills a queued ticket: it marks itself
 *  dead and rejects AbortError — the handoff skips it. */
export async function withBgLlmSlot<T>(
	signal: AbortSignal | undefined,
	critical: () => Promise<T>,
): Promise<T> {
	const slots = bgLlmSlots();
	let freshTake = true;
	if (slots.active >= PERMIT_COUNT) {
		freshTake = false;
		await new Promise<void>((resolve, reject) => {
			const ticket: { resolve: () => void; dead: boolean } = { resolve, dead: false };
			slots.queue.push(ticket);
			if (!signal) return;
			const die = () => {
				ticket.dead = true; // the permit handoff must skip us
				const err = new Error("background LLM job aborted while queued for a permit");
				err.name = "AbortError";
				reject(err);
			};
			if (signal.aborted) die();
			else signal.addEventListener("abort", die, { once: true });
		});
	}
	if (freshTake) slots.active++;
	try {
		return await critical();
	} finally {
		// Permit handoff: a waiting ticket inherits the permit directly
		// (active stays); dead tickets are skipped — their job already
		// left through the abort path.
		for (;;) {
			const next = slots.queue.shift();
			if (!next) {
				slots.active--;
				break;
			}
			if (next.dead) continue;
			next.resolve();
			break;
		}
	}
}

/**
 * node:test's fake setTimeout, stepped by hand. The wake pipeline waits on
 * fixed timers (400 ms polls, a 750 ms grace after the gates open, a 409
 * backoff ramp); on the fake clock its events keep their order without
 * seconds of real waiting.
 */
import { afterEach, beforeEach, mock } from "node:test";

const STEP_MS = 25;

/** Runs every test in the enclosing describe (or file) on the fake clock. */
export function useFakeClock(): void {
	beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
	afterEach(() => mock.timers.reset());
}

/** Moves fake time forward, letting promise callbacks run after each step. */
export async function advance(ms: number): Promise<void> {
	for (let t = 0; t < ms; t += STEP_MS) {
		mock.timers.tick(STEP_MS);
		await new Promise((resolve) => setImmediate(resolve));
	}
}

/** Steps fake time until `cond` holds. Past `limitMs` of fake time it stops
 *  ticking and only yields, for up to 10 s of real time: real I/O on a slow
 *  machine can lag far behind a fast fake clock. */
export async function advanceUntil(cond: () => boolean, what = "condition", limitMs = 30_000): Promise<void> {
	const realStart = performance.now();
	for (let t = 0; !cond(); t += STEP_MS) {
		if (t <= limitMs) {
			await advance(STEP_MS);
			continue;
		}
		if (performance.now() - realStart > 10_000) throw new Error(`timeout waiting for ${what}`);
		await new Promise((resolve) => setImmediate(resolve));
	}
}

/** Awaits a promise whose work waits on the fake clock. */
export async function settle<T>(promise: Promise<T>): Promise<T> {
	let done = false;
	promise.then(() => (done = true), () => (done = true));
	await advanceUntil(() => done, "the promise to settle");
	return promise;
}

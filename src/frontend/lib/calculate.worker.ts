/**
 * The calculator's worker: the Compute Engine works here, off the page's
 * thread, so a huge calculation never freezes typing (the page restarts
 * a worker that takes too long, calculator-client.ts).
 */
import { ComputeEngine } from "@cortex-js/compute-engine";
import type { Calculation } from "@/shared/core";
import { calculate } from "./calculate";

const ce = new ComputeEngine();
const scope = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; calc: Calculation }>) => void) | null; postMessage(message: unknown): void };

scope.onmessage = (e) => {
	let answer = null;
	try {
		answer = calculate(ce, e.data.calc);
	} catch {
		answer = null;
	}
	scope.postMessage({ id: e.data.id, answer });
};
scope.postMessage({ ready: true });

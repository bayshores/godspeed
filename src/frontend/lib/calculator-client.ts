/**
 * The page's side of the calculator worker: one worker, started on the
 * first calculation. A calculation that takes too long gets no answer and
 * the worker is restarted, so the next one starts fresh.
 */
import type { CalcAnswer, Calculation } from "@/shared/core";

/** Loading the engine on first use takes longer than any calculation should. */
const LOAD_MS = 10_000;
const WORK_MS = 2_000;

let worker: Worker | null = null;
let ready = false;
let nextId = 0;
const waiting = new Map<number, (answer: CalcAnswer | null) => void>();

function start(): Worker {
	const w = new Worker(new URL("./calculate.worker.ts", import.meta.url), { type: "module" });
	w.onmessage = (e: MessageEvent<{ ready?: boolean; id?: number; answer?: CalcAnswer | null }>) => {
		if (e.data.ready) ready = true;
		if (e.data.id === undefined) return;
		waiting.get(e.data.id)?.(e.data.answer ?? null);
	};
	w.onerror = () => restart();
	return w;
}

function restart(): void {
	worker?.terminate();
	worker = null;
	ready = false;
	for (const answer of waiting.values()) answer(null);
	waiting.clear();
}

/** The answer, or null (none, or it took too long). */
export function workOut(calc: Calculation): Promise<CalcAnswer | null> {
	worker ??= start();
	const w = worker;
	const id = ++nextId;
	return new Promise((resolve) => {
		const timer = setTimeout(restart, ready ? WORK_MS : LOAD_MS);
		waiting.set(id, (answer) => {
			clearTimeout(timer);
			waiting.delete(id);
			resolve(answer);
		});
		w.postMessage({ id, calc });
	});
}

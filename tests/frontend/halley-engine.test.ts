/**
 * Halley's animation loop: it stops once Halley rests, after a flight and
 * after the mouse moves, instead of running every frame forever. Resting on
 * a goal that can move, only a 250 ms timer is left.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

type Frame = (now: number) => void;
let queue: Frame[] = [];
let clock = 0;
/** Pending timers by id (only the engine's watch timer uses them). */
const timers = new Map<number, () => void>();
let nextTimer = 1;
const listeners = new Map<string, (e: unknown) => void>();
Object.assign(globalThis, {
	window: {
		innerWidth: 1200,
		innerHeight: 800,
		addEventListener: (type: string, fn: (e: unknown) => void) => listeners.set(type, fn),
		removeEventListener: (type: string) => listeners.delete(type),
	},
	requestAnimationFrame: (fn: Frame) => queue.push(fn),
	cancelAnimationFrame: () => {
		queue = [];
	},
	setTimeout: (fn: () => void) => {
		timers.set(nextTimer, fn);
		return nextTimer++;
	},
	clearTimeout: (id: number | undefined) => {
		if (id !== undefined) timers.delete(id);
	},
});
Object.defineProperty(globalThis, "performance", { value: { now: () => clock }, configurable: true });

const { HalleyEngine } = await import("../../src/frontend/components/halley/engine.ts");

function stub(): HTMLElement {
	return {
		style: {},
		offsetWidth: 100,
		offsetHeight: 30,
		addEventListener() {},
		removeEventListener() {},
		toggleAttribute() {},
		setAttribute() {},
		getAttribute: () => "",
		setPointerCapture() {},
	} as unknown as HTMLElement;
}

/** Run queued frames 1/60 s apart; the number run before the queue drained. */
function drain(limit = 5000): number {
	let n = 0;
	while (queue.length && n < limit) {
		const fn = queue.shift()!;
		clock += 1000 / 60;
		fn(clock);
		n++;
	}
	return n;
}

/** Fire every pending timer once (250 ms passing). */
function tick(): void {
	const due = [...timers.values()];
	timers.clear();
	for (const fn of due) fn();
}

function engine() {
	queue = [];
	timers.clear();
	const parts = { root: stub(), look: stub(), bubble: stub(), trail: stub(), gradient: stub() };
	return new HalleyEngine(parts as never, {
		home: () => ({ spot: { x: 20, y: 700 }, up: { x: 20, y: 660 }, size: 48, edge: 740 }),
		area: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
		lifted: () => false,
		reduceMotion: () => false,
		eyesStill: () => false,
		onCorner: () => {},
	});
}

describe("HalleyEngine loop", () => {
	it("stops after the first placement", () => {
		engine();
		assert.ok(drain() < 5000);
		assert.equal(queue.length, 0);
	});

	it("stops after flying somewhere and back home", () => {
		const e = engine();
		drain();
		e.flyTo({ x: 500, y: 400 });
		assert.ok(drain() < 5000);
		e.goHome();
		assert.ok(drain() < 5000);
		assert.equal(queue.length, 0);
	});

	it("keeps following a moving goal after it arrives", () => {
		const e = engine();
		drain();
		let row = { x: 500, y: 400 };
		e.flyTo(() => row);
		assert.ok(drain() < 5000);
		row = { x: 500, y: 200 };
		tick();
		assert.equal(queue.length, 1, "the timer sees the row moved and flies again");
		assert.ok(drain() < 5000);
		const { left, top, width } = e.box();
		assert.deepEqual({ x: left + width / 2, y: top + width / 2 }, row);
		e.goHome();
		assert.ok(drain() < 5000);
		assert.equal(queue.length, 0);
	});

	it("rests on a function goal with only a timer left", () => {
		const e = engine();
		drain();
		e.flyTo(() => ({ x: 500, y: 400 }));
		assert.ok(drain() < 5000, "the frame loop stops at rest");
		assert.equal(queue.length, 0);
		assert.equal(timers.size, 1);
		tick();
		assert.equal(queue.length, 0, "a goal that has not moved wakes no frames");
		assert.equal(timers.size, 1, "and the timer checks again");
	});

	it("clears the timer when Halley goes home or is destroyed", () => {
		const e = engine();
		drain();
		e.flyTo(() => ({ x: 500, y: 400 }));
		drain();
		e.goHome();
		assert.equal(timers.size, 0);
		drain();
		e.flyTo(() => ({ x: 300, y: 300 }));
		drain();
		assert.equal(timers.size, 1);
		e.destroy();
		assert.equal(timers.size, 0);
	});

	it("stops after a burst of mouse movement", () => {
		engine();
		drain();
		const move = listeners.get("pointermove")!;
		for (let i = 0; i < 20; i++) {
			move({ clientX: 300 + i * 10, clientY: 300 });
			drain(1);
		}
		assert.ok(drain() < 5000);
		assert.equal(queue.length, 0);
	});
});

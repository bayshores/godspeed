/**
 * Halley's animation loop: it stops once Halley rests, after a flight and
 * after the mouse moves, instead of running every frame forever.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

type Frame = (now: number) => void;
let queue: Frame[] = [];
let clock = 0;
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
});
Object.defineProperty(globalThis, "performance", { value: { now: () => clock }, configurable: true });

const { HalleyEngine } = await import("../src/components/halley/engine.ts");

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

function engine() {
	queue = [];
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

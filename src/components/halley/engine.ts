/**
 * Halley's motion (browser only). One requestAnimationFrame loop moves the
 * dot with the prototype's spring, draws the comet trail from the last
 * 130 ms of positions while it flies, leans the eyes toward where it is
 * heading (or toward the mouse at rest), and keeps the bubble above it.
 * At home it peeks over the edge and rises out of it on hover.
 * The loop stops whenever Halley rests, and starts again on demand.
 *
 * Reduced motion: it jumps instead of flying and draws no trail.
 */
import {
	FLYING_SPEED,
	SIZE,
	nearestCorner,
	pruneTrail,
	settled,
	springStep,
	trailShape,
	type Box,
	type Corner,
	type Point,
	type TrailPoint,
} from "./geometry";

interface EngineParts {
	root: HTMLElement;
	look: SVGGElement;
	bubble: HTMLElement;
	trail: SVGPathElement;
	gradient: SVGLinearGradientElement;
}

export interface Home {
	/** Top-left of the resting spot (peeking over the edge). */
	spot: Point;
	/** Top-left when risen fully out of the edge. */
	up: Point;
	size: number;
	/** The edge it peeks over: what is below it is hidden. */
	edge: number;
}

interface EngineHooks {
	home: () => Home;
	/** The area it rests in (for corner snapping). */
	area: () => Box;
	/** Risen for something besides hover (the bubble, the panel). */
	lifted: () => boolean;
	reduceMotion: () => boolean;
	/** Eyes stay still (sleepy, dizzy). */
	eyesStill: () => boolean;
	onCorner: (corner: Corner) => void;
}

const STEP_MS = 1000 / 60;
const DRAG_START_PX = 4;
/** How far the halo reaches past the dot (kept clear of the clip). */
const HALO_PX = 40;

export class HalleyEngine {
	private p: Point = { x: -200, y: -200 };
	private v: Point = { x: 0, y: 0 };
	private size = SIZE;
	/** Center to fly to (or a function that says, each frame, so a target
	 *  that moves while Halley flies is still met); null = home. */
	private goal: Point | (() => Point) | null = null;
	/** At home and settled: follows the home spot exactly (scrolling). */
	private locked = false;
	private placed = false;
	private hist: TrailPoint[] = [];
	private raf = 0;
	private last = 0;
	private mouse: Point | null = null;
	private point: Point | null = null;
	private drag: { start: Point; grab: Point; moved: boolean; id: number } | null = null;
	private dragClick = false;
	private bubbleOn = false;
	private hover = false;
	private risen = false;

	constructor(
		private parts: EngineParts,
		private hooks: EngineHooks,
	) {
		parts.root.addEventListener("pointerdown", this.onDown);
		parts.root.addEventListener("pointerenter", this.onEnter);
		window.addEventListener("pointermove", this.onMove, { passive: true });
		window.addEventListener("pointerup", this.onUp);
		window.addEventListener("pointercancel", this.onUp);
		this.kick();
	}

	destroy(): void {
		cancelAnimationFrame(this.raf);
		this.parts.root.removeEventListener("pointerdown", this.onDown);
		this.parts.root.removeEventListener("pointerenter", this.onEnter);
		window.removeEventListener("pointermove", this.onMove);
		window.removeEventListener("pointerup", this.onUp);
		window.removeEventListener("pointercancel", this.onUp);
	}

	/** Fly so Halley's center lands on `center`. */
	flyTo(center: Point | (() => Point)): void {
		this.goal = center;
		this.hover = false;
		this.locked = false;
		this.kick();
	}

	/** Fly back to the resting spot. */
	goHome(): void {
		this.goal = null;
		this.point = null;
		this.locked = false;
		this.kick();
	}

	/** Point the eyes this way (a unit vector), or stop pointing. */
	pointAt(dir: Point | null): void {
		this.point = dir;
		this.kick();
	}

	/** The home spot moved (resize, scroll, sidebar, banner). */
	refresh(): void {
		this.kick();
	}

	isHome(): boolean {
		return this.goal === null;
	}

	/** Halley's current box on screen. */
	box(): Box {
		return { left: this.p.x, top: this.p.y, width: this.size, height: this.size };
	}

	setBubble(on: boolean): void {
		this.bubbleOn = on;
		this.kick();
	}

	/** True once after a drag ended (the click that follows is not a click). */
	consumeDragClick(): boolean {
		const was = this.dragClick;
		this.dragClick = false;
		return was;
	}

	private kick = (): void => {
		if (this.raf) return;
		this.last = performance.now();
		this.raf = requestAnimationFrame(this.frame);
	};

	private frame = (now: number): void => {
		this.raf = 0;
		const { root, look, bubble } = this.parts;
		const home = this.hooks.home();
		if (home.size !== this.size) {
			this.size = home.size;
			root.style.width = root.style.height = `${home.size}px`;
		}
		const half = this.size / 2;
		const goal = typeof this.goal === "function" ? this.goal() : this.goal;
		const risen = this.hover || this.hooks.lifted();
		// Rising or sinking is a move: the spring carries it.
		if (risen !== this.risen) {
			this.risen = risen;
			this.locked = false;
		}
		const target = goal ? { x: goal.x - half, y: goal.y - half } : risen ? home.up : home.spot;
		const reduce = this.hooks.reduceMotion();

		if (this.drag?.moved && this.mouse) {
			this.p = { x: this.mouse.x - this.drag.grab.x, y: this.mouse.y - this.drag.grab.y };
			this.v = { x: 0, y: 0 };
		} else if (!this.placed || reduce || (this.locked && !this.goal)) {
			this.p = { ...target };
			this.v = { x: 0, y: 0 };
			this.placed = true;
		} else {
			const steps = Math.max(1, Math.min(4, Math.round((now - this.last) / STEP_MS)));
			for (let i = 0; i < steps; i++) {
				const next = springStep(this.p, this.v, target);
				this.p = next.p;
				this.v = next.v;
			}
		}
		this.last = now;
		const atRest = settled(this.p, this.v, target);
		if (atRest && !this.drag?.moved) {
			this.p = { ...target };
			this.v = { x: 0, y: 0 };
			if (!this.goal) this.locked = true;
		}

		const speed = Math.hypot(this.v.x, this.v.y);
		const flying = speed > FLYING_SPEED || !!this.drag?.moved;
		root.style.transform = `translate(${round(this.p.x)}px, ${round(this.p.y)}px)`;
		root.toggleAttribute("data-flying", flying);
		// At home, the part below the edge is hidden, so it peeks out of it.
		const hidden = this.goal || this.drag?.moved ? 0 : Math.max(0, round(this.p.y + this.size - home.edge));
		root.style.clipPath = hidden ? `inset(-${HALO_PX}px -${HALO_PX}px ${hidden}px -${HALO_PX}px)` : "";

		// The eyes: lean into the flight, point at an off-screen target, or
		// follow the mouse a little at rest.
		let lx = 0;
		let ly = 0;
		if (this.hooks.eyesStill()) {
			lx = ly = 0;
		} else if (flying) {
			lx = clamp(this.v.x / 18) * 14;
			ly = clamp(this.v.y / 18) * 10;
		} else if (this.point) {
			lx = this.point.x * 14;
			ly = this.point.y * 10;
		} else if (this.mouse) {
			const cx = this.p.x + half;
			const cy = this.p.y + half;
			lx = clamp((this.mouse.x - cx) / 400) * 12;
			ly = clamp((this.mouse.y - cy) / 400) * 9;
		}
		look.style.transform = `translate(${round(lx)}px, ${round(ly)}px)`;

		// The trail: recent centers, only while flying. Resting adds none, so
		// the old ones age out and the loop can stop.
		const head = { x: this.p.x + half, y: this.p.y + half, t: now };
		if (!reduce && !this.drag?.moved && !atRest) this.hist.push(head);
		pruneTrail(this.hist, now);
		const shape = reduce || this.drag?.moved ? null : trailShape(this.hist, half);
		this.drawTrail(shape);

		// The bubble sits above Halley, on screen.
		if (this.bubbleOn) {
			const bw = bubble.offsetWidth;
			const bh = bubble.offsetHeight;
			let bx = this.p.x;
			if (bx + bw > window.innerWidth - 8) bx = this.p.x + this.size - bw;
			bx = Math.max(8, Math.min(bx, window.innerWidth - bw - 8));
			let by = this.p.y - bh - 9;
			if (by < 8) by = this.p.y + this.size + 9;
			bubble.style.transform = `translate(${round(bx)}px, ${round(by)}px)`;
		}

		// A function goal re-aims each frame (its row may move), so it keeps the loop alive.
		const keepGoing =
			!atRest || !!this.drag?.moved || this.hist.length > 1 || typeof this.goal === "function" || (!this.locked && !this.goal);
		if (keepGoing) this.kick();
	};

	private drawTrail(shape: ReturnType<typeof trailShape>): void {
		const { trail, gradient } = this.parts;
		if (!shape) {
			if (trail.getAttribute("d")) trail.setAttribute("d", "");
			return;
		}
		trail.setAttribute("d", shape.d);
		gradient.setAttribute("x1", String(shape.from.x));
		gradient.setAttribute("y1", String(shape.from.y));
		gradient.setAttribute("x2", String(shape.to.x));
		gradient.setAttribute("y2", String(shape.to.y));
	}

	// ─── hovering: it rises out of the edge ──────────────────────────────────

	private onEnter = (): void => {
		if (this.goal) return;
		this.hover = true;
		this.kick();
	};

	/** Still hovering: over the dot or the column below it down to the edge,
	 *  so rising away from a pointer low in the peek does not drop it. */
	private stillOver(x: number, y: number): boolean {
		const edge = this.hooks.home().edge;
		return x >= this.p.x && x <= this.p.x + this.size && y >= this.p.y && y <= Math.max(edge, this.p.y + this.size);
	}

	// ─── dragging to a corner ─────────────────────────────────────────────────

	private onDown = (e: PointerEvent): void => {
		if (e.button !== 0 || this.goal) return;
		this.drag = { start: { x: e.clientX, y: e.clientY }, grab: { x: e.clientX - this.p.x, y: e.clientY - this.p.y }, moved: false, id: e.pointerId };
	};

	private onMove = (e: PointerEvent): void => {
		this.mouse = { x: e.clientX, y: e.clientY };
		if (this.hover && !this.drag?.moved && !this.stillOver(e.clientX, e.clientY)) this.hover = false;
		if (this.drag && !this.drag.moved && Math.hypot(e.clientX - this.drag.start.x, e.clientY - this.drag.start.y) > DRAG_START_PX) {
			this.drag.moved = true;
			this.locked = false;
			try {
				this.parts.root.setPointerCapture(this.drag.id);
			} catch {
				/* the pointer is already gone */
			}
		}
		this.kick();
	};

	private onUp = (): void => {
		const drag = this.drag;
		this.drag = null;
		if (!drag?.moved) return;
		this.dragClick = true;
		const center = { x: this.p.x + this.size / 2, y: this.p.y + this.size / 2 };
		this.hooks.onCorner(nearestCorner(center, this.hooks.area()));
		this.locked = false;
		this.hist = [];
		this.kick();
	};
}

function clamp(n: number): number {
	return Math.max(-1, Math.min(1, n));
}

function round(n: number): number {
	return Math.round(n * 10) / 10;
}

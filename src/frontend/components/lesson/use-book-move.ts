import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";

/** The app's curves for a thing that enters and one that leaves (--lh-ease-out, --lh-ease-in). */
const OUT = "cubic-bezier(0.2, 0, 0, 1)";
const IN = "cubic-bezier(0.4, 0, 1, 1)";
/** The kept task leaving the right page before the book shuts (--lh-dur-fast). */
const LEAVE_MS = 110;
/** The two pages sliding apart or together. */
const SLIDE_MS = 240;
/** The right page rising out of the strip, or sinking into it. */
const RISE_MS = 220;

/** Where the book's pieces stand, to move them from there once the page is laid out anew. */
interface Shot {
	room: string;
	beside: boolean;
	text: DOMRect;
	/** The top of what the learner last sent, which stands under any card filed with the move; else the text's. */
	anchor: number;
	turn: DOMRect;
	box: DOMRect | null;
	/** The page's window, which ends above "Your turn" while that is pinned under it. */
	foot: number;
}

const TEXT = "[data-testid=lesson-reading]";
const LEARNER = "[data-testid=user-message], [data-testid=go-ahead-mark]";
const SHEET = "[data-testid=your-turn]";
const BOX = "[data-testid=composer]";
const BOX_KEYS = "[data-testid=composer-keys]";

/** The writing box of "Your turn", and what the sheet holds above and under it. */
function turnParts(turn: HTMLElement): { box: HTMLElement | null; above: HTMLElement[]; below: HTMLElement[] } {
	const sheet = turn.querySelector<HTMLElement>(SHEET);
	const parts = sheet ? ([...sheet.children] as HTMLElement[]) : [];
	const at = parts.findIndex((part) => part.matches(BOX));
	if (at < 0) return { box: null, above: parts, below: [] };
	return { box: parts[at]!, above: parts.slice(0, at), below: parts.slice(at + 1) };
}

/**
 * THE BOOK'S MOVE, in a room wide enough for both pages (LessonScroll). The page is laid out
 * open or shut at once, and its pieces are moved from where they stood, in two steps that never
 * cross:
 * - opening: the text's page slides left while the strip under it slides right, then the
 *   strip rises into the right page and the text's page reaches down to the window's foot;
 * - shutting: the kept task fades from the right page first (`shutting`, then `onShut` lays
 *   the page out shut), the right page sinks into the strip while the text's page ends above
 *   it, then the two slide together.
 * The writing box travels with its sheet the whole way and keeps the keyboard. Nothing is
 * scaled, so no line wraps anew. The page holds still until the move ends (`onMove`). With
 * reduced motion, in a narrow room, or when the room changes size, the page is laid out at once.
 */
export function useBookMove({
	roomRef,
	columnRef,
	turnRef,
	footRef,
	beside,
	open,
	shutting,
	onShut,
	onMove,
	onPlace,
	onRest,
}: {
	roomRef: RefObject<HTMLElement | null>;
	columnRef: RefObject<HTMLElement | null>;
	turnRef: RefObject<HTMLElement | null>;
	/** The room "Your turn" is pinned in, under the page's window. */
	footRef: RefObject<HTMLElement | null>;
	/** The page is being laid out with its two sheets side by side where there is room. */
	beside: boolean;
	/** The book lies open (useBook), also where the page cannot lay it out so. */
	open: boolean;
	shutting: boolean;
	onShut: () => void;
	/** The pages move for this long from now. */
	onMove: (ms: number) => void;
	/** The page is laid out anew and takes its rest there; `spare` is the room its window loses while the pages move. */
	onPlace: (spare: number) => void;
	/** The pages stand where the page laid them out. */
	onRest: () => void;
}) {
	const moving = useRef<{ parts: Animation[]; ghost: HTMLElement | null; undo: () => void } | null>(null);
	const stop = () => {
		const move = moving.current;
		moving.current = null;
		for (const part of move?.parts ?? []) part.cancel();
		move?.ghost?.remove();
		move?.undo();
	};
	const shoot = (): Shot | null => {
		const room = roomRef.current;
		const column = columnRef.current;
		const turn = turnRef.current;
		const text = column?.querySelector(TEXT);
		const view = column?.closest(".lh-lesson-window");
		if (!room || !column || !turn || !text || !view) return null;
		return {
			room: `${room.clientWidth} ${room.clientHeight}`,
			beside: getComputedStyle(column).display === "grid",
			text: text.getBoundingClientRect(),
			anchor: ([...text.querySelectorAll(LEARNER)].at(-1) ?? text).getBoundingClientRect().top,
			turn: turn.getBoundingClientRect(),
			box: turn.querySelector(BOX)?.getBoundingClientRect() ?? null,
			foot: view.getBoundingClientRect().bottom,
		};
	};

	const run = (was: Shot) => {
		const turn = turnRef.current;
		const text = columnRef.current?.querySelector<HTMLElement>(TEXT);
		const foot = footRef.current;
		const under = foot?.parentElement;
		if (!turn || !text || !foot || !under) return onRest();
		// Shutting, the page's window is as high as it was until the right page has sunk into the strip.
		onPlace(was.beside ? foot.offsetHeight : 0);
		const now = shoot();
		if (!now) return onRest();
		const { box, above, below } = turnParts(turn);
		const slideX = was.text.left - now.text.left;
		// The text's lines travel with the foot of their page: down as it reaches the window's foot, up as it ends above the strip.
		const slideY = was.anchor - now.anchor;
		const dx = was.turn.left - now.turn.left;
		const dy = was.turn.bottom - now.turn.bottom;
		const lift = was.box && now.box ? was.box.top - now.box.top - dy : 0;
		const tall = Math.abs(now.turn.height - was.turn.height);
		const widthFrom = `${was.turn.width}px`;
		const widthTo = `${now.turn.width}px`;
		const parts: Animation[] = [];
		let ghost: HTMLElement | null = null;
		let undo = () => {};
		if (now.beside) {
			const duration = SLIDE_MS + RISE_MS;
			const offset = SLIDE_MS / duration;
			// The text's page ends where its window did until the strip has left from under it.
			const band = `inset(0 0 ${Math.max(0, now.text.bottom + slideY - was.foot)}px 0)`;
			const strip = `inset(${tall}px 0 0 0)`;
			parts.push(
				text.animate(
					[
						{ transform: `translate(${slideX}px, ${slideY}px)`, clipPath: band, easing: OUT },
						{ offset, transform: `translateY(${slideY}px)`, clipPath: band, easing: OUT },
						{ transform: "none", clipPath: "inset(0)" },
					],
					duration,
				),
				turn.animate(
					[
						{ transform: `translate(${dx}px, ${dy}px)`, width: widthFrom, clipPath: strip, easing: OUT },
						{ offset, transform: `translate(0, ${dy}px)`, width: widthTo, clipPath: strip, easing: OUT },
						{ transform: "none", width: widthTo, clipPath: "inset(0)" },
					],
					duration,
				),
			);
			// What is moved inside the sheet makes no room to scroll into under it.
			turn.style.overflow = "clip";
			undo = () => (turn.style.overflow = "");
			// The box stays the size it had in the strip while it slides, its keys right under its text, then grows to the
			// size the task asks for as the page rises.
			const grow = was.box && now.box ? Math.max(0, now.box.height - was.box.height) : 0;
			const lifted = `translateY(${lift}px)`;
			const low = `inset(0 0 ${grow}px 0)`;
			if (box) parts.push(box.animate([{ transform: lifted, clipPath: low }, { offset, transform: lifted, clipPath: low, easing: OUT }, { transform: "none", clipPath: "inset(0)" }], duration));
			const keys = grow > 0 ? box?.querySelector<HTMLElement>(BOX_KEYS) : null;
			if (keys) parts.push(keys.animate([{ transform: `translateY(${-grow}px)` }, { offset, transform: `translateY(${-grow}px)`, easing: OUT }, { transform: "none" }], duration));
			for (const part of above) parts.push(part.animate([{ opacity: 0 }, { offset, opacity: 0, easing: OUT }, { opacity: 1 }], duration));
			// What stands under the box comes up with it.
			for (const part of below) parts.push(part.animate([{ opacity: 0, transform: lifted }, { offset, opacity: 0, transform: lifted, easing: OUT }, { opacity: 1, transform: "none" }], duration));
		} else {
			const duration = RISE_MS + SLIDE_MS;
			const offset = RISE_MS / duration;
			// The right page's sheet, sinking into the strip that now stands at its foot.
			const base = under.getBoundingClientRect();
			ghost = Object.assign(document.createElement("div"), { className: "lh-sheet pointer-events-none absolute" });
			Object.assign(ghost.style, { left: `${was.turn.left - base.left}px`, top: `${was.turn.top - base.top}px`, width: widthFrom, height: `${was.turn.height}px` });
			under.prepend(ghost);
			parts.push(
				// It ends as the strip's own shape, with the strip over it, and goes there.
				ghost.animate([{ clipPath: "inset(0)" }, { clipPath: `inset(${tall}px 0 0 0)` }], { duration: RISE_MS, easing: OUT, fill: "forwards" }),
				// The page's window keeps its height, then ends above the strip as the right page sinks.
				foot.animate([{ marginTop: `-${foot.offsetHeight}px`, easing: OUT }, { offset, marginTop: "0px" }, { marginTop: "0px" }], duration),
				text.animate([{ transform: `translate(${slideX}px, ${slideY}px)`, easing: OUT }, { offset, transform: `translateX(${slideX}px)`, easing: OUT }, { transform: "none" }], duration),
				turn.animate(
					[
						{ transform: `translate(${dx}px, ${dy}px)`, width: widthFrom, easing: OUT },
						{ offset, transform: `translateX(${dx}px)`, width: widthFrom, easing: OUT },
						{ transform: "none", width: widthTo },
					],
					duration,
				),
			);
			// The box and what stands under it stay in sight and go down together.
			for (const part of box ? [box, ...below] : []) parts.push(part.animate([{ transform: `translateY(${lift}px)`, easing: OUT }, { offset, transform: "none" }, { transform: "none" }], duration));
			for (const part of above) parts.push(part.animate([{ opacity: 0, easing: OUT }, { offset, opacity: 1 }, { opacity: 1 }], duration));
		}
		const move = { parts, ghost, undo };
		moving.current = move;
		parts[0]?.finished.then(() => ghost?.remove(), () => {});
		const ended = () => {
			if (moving.current !== move) return;
			moving.current = null;
			undo();
			onRest();
		};
		Promise.all(parts.map((part) => part.finished)).then(ended, ended);
	};

	// Where the pieces stand is read while the page is still laid out the old way, as the drawing that lays it out anew begins.
	const laid = useRef(beside);
	const before = useRef<Shot | null>(null);
	if (laid.current !== beside) {
		laid.current = beside;
		before.current = moving.current ? null : shoot();
	}
	const shown = useRef<string | null>(null);
	useLayoutEffect(() => {
		const was = before.current;
		before.current = null;
		// The page as it opens was laid out once and has nothing to rest from: saying so would have it glide to its place.
		const state = `${beside} ${open}`;
		const opening = shown.current === null || shown.current === state;
		shown.current = state;
		if (opening) return;
		// A move on its way ends where the page now is.
		stop();
		const now = was && !prefersReducedMotion() && typeof turnRef.current?.animate === "function" ? shoot() : null;
		// In a narrow room, or with nothing that changed sides, the page is laid out and that is all.
		if (!was || !now || now.beside === was.beside || now.room !== was.room) return onRest();
		// Said before anything else places the page, so it holds still from this drawing on.
		onMove(SLIDE_MS + RISE_MS);
		// What "Your turn" holds in its new place is drawn by the drawing this one starts (the page saying where it stands).
		queueMicrotask(() => run(was));
	}, [beside, open]);

	// A room that changes size lays the page out anew: a move on its way ends there.
	useEffect(() => {
		const room = roomRef.current;
		if (!room || typeof ResizeObserver === "undefined") return;
		let size = `${room.clientWidth} ${room.clientHeight}`;
		const ro = new ResizeObserver(() => {
			const now = `${room.clientWidth} ${room.clientHeight}`;
			if (now !== size && moving.current) {
				stop();
				onRest();
			}
			size = now;
		});
		ro.observe(room);
		return () => {
			ro.disconnect();
			stop();
		};
		// The refs hold for the page's life.
	}, []);

	// The kept task fades from the right page, then the page is laid out shut.
	useLayoutEffect(() => {
		if (!shutting) return;
		const turn = turnRef.current;
		const column = columnRef.current;
		const beside = column !== null && getComputedStyle(column).display === "grid";
		if (!turn || !beside || prefersReducedMotion() || typeof turn.animate !== "function") {
			onShut();
			return;
		}
		// The page holds still from the reply's landing on.
		onMove(LEAVE_MS + RISE_MS + SLIDE_MS);
		// The box and the keys under it stay: the strip holds them too.
		const fades = turnParts(turn).above.map((part) => part.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LEAVE_MS, easing: IN, fill: "forwards" }));
		let live = true;
		const gone = () => {
			if (live) onShut();
		};
		Promise.all(fades.map((fade) => fade.finished)).then(gone, gone);
		return () => {
			live = false;
			// After the drawing that ends the fade, before its frame: the strip's own parts fade in from there.
			queueMicrotask(() => fades.forEach((fade) => fade.cancel()));
		};
	}, [shutting, onShut]);
}

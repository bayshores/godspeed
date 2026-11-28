import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { glideSheetAround } from "@/frontend/components/use-sheet-glide";
import { ditherEnds } from "@/frontend/lib/dither";
import { cn } from "@/frontend/lib/utils";
import { foldRoom } from "./turn-fold-model";
import { TurnPlaceContext } from "./turn-place";

/** The height the problem gets folded, pinned over the text (foldRoom), read from the page: the room under the step
 *  line, less the task's other parts, the pin's own padding and the writing row. */
function roomFolded(el: HTMLElement): number | null {
	const top = el.closest<HTMLElement>(".lh-turn-top");
	const task = el.closest<HTMLElement>(".lh-turn-task");
	if (!top?.parentElement || !task) return null;
	const row = top.parentElement.querySelector<HTMLElement>(":scope > .lh-turn-foot");
	return foldRoom(top.parentElement.clientHeight, top.offsetHeight - el.offsetHeight + (row?.offsetHeight ?? 0));
}

/** Where the part being worked on lies in the box, when the problem's text marks one: its first block to the last
 *  before the next part's. */
function partSpan(el: HTMLElement): { top: number; height: number } | null {
	const start = el.querySelector<HTMLElement>('[data-testid="problem-statement"] [data-part-current]');
	if (!start) return null;
	let last: Element = start;
	for (let next = start.nextElementSibling; next && !next.hasAttribute("data-part-head"); next = next.nextElementSibling) last = next;
	const top = start.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
	return { top, height: last.getBoundingClientRect().bottom - start.getBoundingClientRect().top + HANG };
}

/** A last-line fraction's denominator hangs this far below its line box. */
const HANG = 6;

/** Room kept above the part, so the fade at the top of the box does not cover its first line. */
const LEAD = 32;

/** Brings the start of the part the learner is on to the top of the box the task scrolls in:
 *  glided to when he moves on to it (`moved`), there at once otherwise. Where the box is not cut,
 *  the page itself rests on the part. */
export function restOnPart(start: HTMLElement, moved: boolean) {
	const box = start.closest<HTMLElement>(".lh-turn-scroll");
	if (!box || box.scrollHeight <= box.clientHeight) return;
	box.scrollTo({ top: box.scrollTop + start.getBoundingClientRect().top - box.getBoundingClientRect().top - LEAD, behavior: moved && !prefersReducedMotion() ? "smooth" : "auto" });
}

/**
 * The question or problem in the turn's task: beside the lesson text, or
 * pinned over it, it is the one part that shrinks to fit and scrolls in its own box
 * (.lh-turn-scroll). An end that cuts content off dissolves in the app's
 * dither, so a long problem never looks finished where the box ends. A problem
 * that can fold (`folded` given) is cut to its folded height while folded,
 * and `onLong` hears whether it is longer than that height. A long problem
 * whose text marks the part being worked on shows that part alone while folded.
 */
export function TurnScroll({ className, folded, onLong, children }: { className?: string; folded?: boolean; onLong?: (long: boolean) => void; children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	const [cut, setCut] = useState({ start: false, end: false });
	const [foldedRoom, setFoldedRoom] = useState<number | null>(null);
	// The part shown alone: its height, which the box takes while it rests on the part's first line.
	const [partRoom, setPartRoom] = useState<number | null>(null);
	const folds = folded !== undefined;
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const start = el.scrollTop > 1;
			const end = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
			setCut((c) => (c.start === start && c.end === end ? c : { start, end }));
			const room = folds ? roomFolded(el) : null;
			setFoldedRoom(room);
			const long = room !== null && el.scrollHeight > room + 1;
			onLong?.(long);
			// A part he opened by hand stays in reach: the folded problem then scrolls whole.
			const part = long && folded && !el.querySelector("[data-part-head][aria-expanded=true]") ? partSpan(el) : null;
			setPartRoom(part && room !== null ? Math.min(room, Math.ceil(part.height)) : null);
			if (part && Math.abs(el.scrollTop - part.top) > 1) el.scrollTop = part.top;
		};
		measure();
		el.addEventListener("scroll", measure, { passive: true });
		const resized = new ResizeObserver(measure);
		resized.observe(el);
		// The folded height follows the room and the task's other parts, which change while the cut box holds its size.
		const sheet = folds ? el.closest(".lh-turn-task") : null;
		const room = folds ? el.closest(".lh-turn-top")?.parentElement : null;
		if (sheet) resized.observe(sheet);
		if (room) resized.observe(room);
		// A part that opens or math that draws late changes the height inside, not the box's.
		const changed = new MutationObserver(measure);
		changed.observe(el, { childList: true, subtree: true, attributes: true });
		return () => {
			el.removeEventListener("scroll", measure);
			resized.disconnect();
			changed.disconnect();
		};
	}, [folds, folded, onLong]);
	// Folding changes the task's height at once: its glide starts from here, before the frame is drawn.
	const wasFolded = useRef(folded);
	useLayoutEffect(() => {
		if (wasFolded.current !== folded && ref.current) glideSheetAround(ref.current);
		wasFolded.current = folded;
	}, [folded]);
	// Beside the text the problem is moved to the page's left part once it is drawn: it opens there resting on the part.
	const place = useContext(TurnPlaceContext);
	useLayoutEffect(() => {
		const start = place === "left" ? ref.current?.querySelector<HTMLElement>("[data-part-current]") : null;
		if (start) restOnPart(start, false);
	}, [place]);
	// A problem is first drawn whole and cut after, so the cut box takes its place on the part itself.
	const cutFolded = folded === true && foldedRoom !== null && partRoom === null;
	useLayoutEffect(() => {
		const start = cutFolded ? ref.current?.querySelector<HTMLElement>("[data-part-current]") : null;
		if (start) restOnPart(start, false);
	}, [cutFolded]);
	// A part shown alone is whole, so nothing of it fades.
	const fade = partRoom !== null ? null : cut.start && cut.end ? "both" : cut.end ? "end" : cut.start ? "start" : null;
	const max = partRoom ?? (folded ? foldedRoom : null);
	return (
		<div
			ref={ref}
			data-part-alone={partRoom !== null || undefined}
			style={{ ...(max !== null && { maxHeight: max }), ...(fade && ditherEnds(fade)) }}
			className={cn("lh-turn-scroll flex min-h-0 flex-col gap-7 empty:hidden", className)}
		>
			{children}
		</div>
	);
}

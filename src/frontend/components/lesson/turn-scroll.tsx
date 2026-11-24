import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { glideSheetAround } from "@/frontend/components/use-sheet-glide";
import { cn } from "@/frontend/lib/utils";
import { foldRoom } from "./turn-fold-model";

const CUT = {
	end: "[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]",
	start: "[mask-image:linear-gradient(to_top,black_calc(100%-24px),transparent)]",
	both: "[mask-image:linear-gradient(to_bottom,transparent,black_24px,black_calc(100%-24px),transparent)]",
};

/** The height the problem gets folded, pinned over the text (foldRoom), read from the page: the room under the step
 *  line, less the task's other parts, the pin's own padding and the writing row. */
function roomFolded(el: HTMLElement): number | null {
	const top = el.closest<HTMLElement>(".lh-turn-top");
	const task = el.closest<HTMLElement>(".lh-turn-task");
	if (!top?.parentElement || !task) return null;
	const row = top.parentElement.querySelector<HTMLElement>(":scope > .lh-turn-foot");
	return foldRoom(top.parentElement.clientHeight, top.offsetHeight - el.offsetHeight + (row?.offsetHeight ?? 0));
}

/**
 * The question or problem in the turn's task: beside the lesson text, or
 * pinned over it, it is the one part that shrinks to fit and scrolls in its own box
 * (.lh-turn-scroll). An end that cuts content off fades, as the tab strip's
 * does, so a long problem never looks finished where the box ends. A problem
 * that can fold (`folded` given) is cut to its folded height while folded,
 * and `onLong` hears whether it is longer than that height.
 */
export function TurnScroll({ className, folded, onLong, children }: { className?: string; folded?: boolean; onLong?: (long: boolean) => void; children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	const [cut, setCut] = useState({ start: false, end: false });
	const [foldedRoom, setFoldedRoom] = useState<number | null>(null);
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
			onLong?.(room !== null && el.scrollHeight > room + 1);
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
	}, [folds, onLong]);
	// Folding changes the task's height at once: its glide starts from here, before the frame is drawn.
	const wasFolded = useRef(folded);
	useLayoutEffect(() => {
		if (wasFolded.current !== folded && ref.current) glideSheetAround(ref.current);
		wasFolded.current = folded;
	}, [folded]);
	const fade = cut.start && cut.end ? CUT.both : cut.end ? CUT.end : cut.start ? CUT.start : undefined;
	return (
		<div ref={ref} style={folded && foldedRoom !== null ? { maxHeight: foldedRoom } : undefined} className={cn("lh-turn-scroll flex min-h-0 flex-col gap-7 empty:hidden", fade, className)}>
			{children}
		</div>
	);
}

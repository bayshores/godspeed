import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/frontend/lib/utils";

const CUT = {
	end: "[mask-image:linear-gradient(to_bottom,black_calc(100%-24px),transparent)]",
	start: "[mask-image:linear-gradient(to_top,black_calc(100%-24px),transparent)]",
	both: "[mask-image:linear-gradient(to_bottom,transparent,black_24px,black_calc(100%-24px),transparent)]",
};

/**
 * The question or problem in "Your turn": beside the lesson text it is the
 * one part that shrinks to fit the window and scrolls in its own box
 * (.lh-turn-scroll). An end that cuts content off fades, as the tab strip's
 * does, so a long problem never looks finished where the box ends.
 */
export function TurnScroll({ className, children }: { className?: string; children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	const [cut, setCut] = useState({ start: false, end: false });
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const start = el.scrollTop > 1;
			const end = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
			setCut((c) => (c.start === start && c.end === end ? c : { start, end }));
		};
		measure();
		el.addEventListener("scroll", measure, { passive: true });
		const resized = new ResizeObserver(measure);
		resized.observe(el);
		// A part that opens or math that draws late changes the height inside, not the box's.
		const changed = new MutationObserver(measure);
		changed.observe(el, { childList: true, subtree: true, attributes: true });
		return () => {
			el.removeEventListener("scroll", measure);
			resized.disconnect();
			changed.disconnect();
		};
	}, []);
	const fade = cut.start && cut.end ? CUT.both : cut.end ? CUT.end : cut.start ? CUT.start : undefined;
	return (
		<div ref={ref} className={cn("lh-turn-scroll flex min-h-0 flex-col gap-7 empty:hidden", fade, className)}>
			{children}
		</div>
	);
}

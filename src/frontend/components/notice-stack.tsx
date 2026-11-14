import { useLayoutEffect, useRef, type ReactNode } from "react";
import { shownNotices } from "./notice-stack-model";

/** The stack's element id: the notices outside it portal into it. */
export const NOTICE_STACK_ID = "lh-notices";

/** The bottom-right corner the notices (update, restart, deadline done,
 *  quiet space, files, rules) stack in, so they never cover each other.
 *  A few show at once; the rest are hidden (from screen readers too)
 *  until one closes. Portaled notices land here outside React's view, so
 *  the stack watches its own children. */
export function NoticeStack({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const stack = ref.current!;
		const fit = () => {
			const cards = [...stack.children];
			const shown = shownNotices(cards.map((card) => card.getAttribute("data-notice")));
			// Only real changes, so the observer is not woken again for nothing.
			cards.forEach((card, i) => {
				if (card.hasAttribute("hidden") === shown[i]) card.toggleAttribute("hidden", !shown[i]);
			});
		};
		fit();
		const observer = new MutationObserver(fit);
		observer.observe(stack, { childList: true });
		return () => observer.disconnect();
	}, []);
	return (
		<div
			ref={ref}
			id={NOTICE_STACK_ID}
			className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2 *:pointer-events-auto *:data-[notice=first]:order-first"
		>
			{children}
		</div>
	);
}

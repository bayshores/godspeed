import { useLayoutEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { keyboardFocus } from "@/frontend/components/focus-hygiene";
import { PRESENT_MS } from "@/frontend/components/notice-stack-model";
import { holdNotices, useNotices } from "@/frontend/components/notice-store";
import { usePresence } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import { BARS } from "./bar-look";

/** Where the notices outside the panel portal into. */
export const NOTICE_STACK_ID = "lh-notices";

/** Where a notice card shows: the notice stack, or the page body when
 *  there is none (as in tests). */
export function InNoticeStack({ children }: { children: ReactNode }) {
	return createPortal(children, document.getElementById(NOTICE_STACK_ID) ?? document.body);
}

/** With no pill on screen (the first steps): the window's top right corner. */
const FLOATING = { top: 12, right: 16, least: 0, hang: false };

/** The pill on screen: a page's own bar hides the app's. */
function visiblePill(): Element | null {
	for (const pill of document.querySelectorAll<HTMLElement>("[data-live-pill]")) if (pill.offsetParent) return pill;
	return null;
}

/**
 * The pill's panel, one for the whole window: it hangs from the top bar
 * under the pill and holds the notices (update, restart, files, rules, a
 * quiet space, a deadline that didn't save). It is open while a notice
 * shows by itself or the folded ones were asked for; time stands still
 * while the pointer or keyboard focus is on the panel (a clicked key keeps
 * focus but holds nothing), and a bar along its foot drains with the time left.
 */
export function PillPanel({ children }: { children: ReactNode }) {
	const { up, drain } = useNotices();
	const held = useRef({ pointer: false, focus: false });
	const hold = (part: "pointer" | "focus", on: boolean) => {
		held.current[part] = on;
		holdNotices(held.current.pointer || held.current.focus);
	};
	const presence = usePresence(up);
	const { pathname } = useLocation();
	const [at, setAt] = useState(FLOATING);
	useLayoutEffect(() => {
		if (!up) return;
		const place = () => {
			const pill = visiblePill();
			const bar = pill?.closest(BARS);
			setAt(
				pill && bar
					? {
							top: bar.getBoundingClientRect().bottom,
							right: window.innerWidth - pill.getBoundingClientRect().right,
							least: pill.getBoundingClientRect().width,
							hang: true,
						}
					: FLOATING,
			);
		};
		place();
		// The bar gains a line when a page puts its words in it in a narrow window; the line is padding.
		const bar = visiblePill()?.closest(BARS);
		const grown = new ResizeObserver(place);
		if (bar) grown.observe(bar, { box: "border-box" });
		window.addEventListener("resize", place);
		return () => {
			grown.disconnect();
			window.removeEventListener("resize", place);
		};
	}, [up, pathname]);
	return (
		<div
			data-testid="pill-panel"
			data-lh-menu=""
			data-state={presence.state}
			inert={!up}
			style={{ top: at.top, right: at.right }}
			// Over the teacher's window (z-41), under dialogs (z-50): a dialog is modal, so notices wait under its dim.
			className={cn("fixed z-[45]", at.hang && "lh-hang", !presence.mounted && "invisible")}
			onPointerEnter={() => hold("pointer", true)}
			onPointerLeave={() => hold("pointer", false)}
			onPointerDown={() => hold("focus", false)}
			onFocus={() => keyboardFocus() && hold("focus", true)}
			onBlur={(e: FocusEvent<HTMLElement>) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) hold("focus", false);
			}}
		>
			{/* As wide as what it holds, up to 400px: a card the pill already titled may be only its buttons. Never narrower than the pill it hangs from.
			    As tall as the room under the bar; floating with no bar, the bar's one line stays a top margin. */}
			<div
				data-state={presence.state}
				style={{ minWidth: at.least }}
				className={cn("lh-popup flex max-h-[calc(100dvh-var(--lh-bar-h)-1rem)] w-max max-w-[min(400px,calc(100vw-2rem))] flex-col overflow-y-auto", at.hang ? "lh-hang-body" : "lh-pop rounded-[14px]")}>
				<div id={NOTICE_STACK_ID} tabIndex={-1} className="lh-notices flex flex-col outline-none">
					{children}
				</div>
				{drain && <NoticeDrain left={drain.left} held={drain.held} />}
			</div>
		</div>
	);
}

/** The time left before the notices fold, along the panel's foot; it stops while held. */
function NoticeDrain({ left, held }: { left: number; held: boolean }) {
	return (
		<div aria-hidden data-testid="notice-drain" className="lh-drain sticky bottom-0 h-1 shrink-0">
			<div
				key={left}
				data-held={held ? "" : undefined}
				className="h-full origin-left bg-edge"
				style={{ transform: `scaleX(${Math.min(1, left / PRESENT_MS)})`, "--lh-drain-ms": `${left}ms` } as React.CSSProperties}
			/>
		</div>
	);
}

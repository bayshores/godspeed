import { useLayoutEffect, useState, type FocusEvent, type ReactNode } from "react";
import { useLocation } from "react-router";
import { holdNotices, useNotices } from "@/frontend/components/notice-store";
import { usePresence } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import { BARS } from "./bar-look";

/** Where the notices outside the panel portal into. */
export const NOTICE_STACK_ID = "lh-notices";

/** With no pill on screen (the first steps): the window's top right corner. */
const FLOATING = { top: 12, right: 16, hang: false };

/** The pill on screen: a page's own bar hides the app's. */
function visiblePill(): Element | null {
	for (const pill of document.querySelectorAll<HTMLElement>("[data-live-pill]")) if (pill.offsetParent) return pill;
	return null;
}

/**
 * The pill's panel, one for the whole window: it hangs from the top bar
 * under the pill and holds the notices (update, restart, files, rules, a
 * quiet space, a deadline that didn't save). It is open while a notice
 * shows by itself or the folded ones were asked for; a notice waits while
 * the pointer or focus is on the panel.
 */
export function PillPanel({ children }: { children: ReactNode }) {
	const { up } = useNotices();
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
							hang: true,
						}
					: FLOATING,
			);
		};
		place();
		window.addEventListener("resize", place);
		return () => window.removeEventListener("resize", place);
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
			onPointerEnter={() => holdNotices(true)}
			onPointerLeave={() => holdNotices(false)}
			onFocus={() => holdNotices(true)}
			onBlur={(e: FocusEvent<HTMLElement>) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node | null)) holdNotices(false);
			}}
		>
			<div data-state={presence.state} className={cn("lh-popup flex max-h-[calc(100dvh-4rem)] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto", at.hang ? "lh-hang-body" : "lh-pop rounded-[14px]")}>
				<div id={NOTICE_STACK_ID} tabIndex={-1} className="lh-notices flex flex-col outline-none">
					{children}
				</div>
			</div>
		</div>
	);
}

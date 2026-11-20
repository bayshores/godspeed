import { useRef, type FocusEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { keyboardFocus } from "@/frontend/components/focus-hygiene";
import { holdNotices, useNotices } from "@/frontend/components/notice-store";
import { usePresence } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import { peekKeyboard, peekPointer, usePeekOut } from "./peek-store";

/** Where the notices outside the peek portal into. */
const NOTICE_STACK_ID = "lh-notices";
/** Where the strip puts the peek's rows (strip.tsx). */
export const PEEK_ROWS_ID = "lh-peek-rows";

/** Where a notice card shows: the notice stack, or the page body when
 *  there is none (as in tests). */
export function InNoticeStack({ children }: { children: ReactNode }) {
	return createPortal(children, document.getElementById(NOTICE_STACK_ID) ?? document.body);
}

/**
 * The strip's peek, one for the whole window: a sheet that slides out of
 * the strip's top, under the top bar, over the page. It holds the strip's
 * rows while the learner asked for it (peek-store.ts), then the notices
 * (update, restart, files, rules, a quiet space, a deadline that didn't
 * save), which also bring it out by themselves for a while. Time stands
 * still for the notices while the pointer or keyboard focus is on it (a
 * clicked key keeps focus but holds nothing). With no strip on screen (the
 * first steps) it floats in the window's top right corner, as globals.css
 * says.
 */
export function PeekSheet({ children }: { children: ReactNode }) {
	const { up, open } = useNotices();
	const out = usePeekOut();
	const held = useRef({ pointer: false, focus: false });
	const hold = (part: "pointer" | "focus", on: boolean) => {
		held.current[part] = on;
		holdNotices(held.current.pointer || held.current.focus);
	};
	const shown = up || out;
	const presence = usePresence(shown);
	return (
		<div
			data-testid="peek"
			data-peek=""
			// A notice that came by itself keeps its keys' Enter but is in front of nothing: Find still opens.
			data-lh-menu={out || open ? "" : "quiet"}
			data-state={presence.state}
			inert={!shown}
			// Over the teacher's panel (z-41) and the strip, under dialogs (z-50): a dialog is modal, so notices wait under its dim.
			className={cn("lh-peek fixed z-[45]", !presence.mounted && "invisible")}
			onPointerEnter={() => {
				hold("pointer", true);
				peekPointer(true);
			}}
			onPointerLeave={() => {
				hold("pointer", false);
				peekPointer(false);
			}}
			onPointerDown={() => hold("focus", false)}
			onFocus={() => {
				if (!keyboardFocus()) return;
				hold("focus", true);
				peekKeyboard(true);
			}}
			onBlur={(e: FocusEvent<HTMLElement>) => {
				const to = e.relatedTarget as Element | null;
				if (e.currentTarget.contains(to)) return;
				hold("focus", false);
				if (!to?.closest("[data-strip]")) peekKeyboard(false);
			}}
		>
			{/* As wide as what it holds, up to 400px, and as tall as the room under the bar. */}
			<div data-state={presence.state} className="lh-popup lh-peek-body flex max-h-[calc(100dvh-var(--lh-bar-h)-1rem)] w-max max-w-[min(400px,calc(100vw-2rem))] flex-col overflow-y-auto">
				<div id={PEEK_ROWS_ID} className="lh-peek-rows flex min-w-[260px] flex-col empty:hidden" />
				<div id={NOTICE_STACK_ID} tabIndex={-1} className="lh-notices flex flex-col outline-none">
					{children}
				</div>
			</div>
		</div>
	);
}

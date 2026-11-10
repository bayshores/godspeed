import { useEffect } from "react";
import { createPortal } from "react-dom";
import { NOTICE_STACK_ID } from "@/frontend/components/notice-stack";
import { useHeld } from "@/frontend/components/use-held";

/** How long the notice stays (it waits while the pointer or focus is on it). */
const NOTICE_MS = 6000;

/** What the notice after ticking a deadline done says. `undo`: the deadline
 *  its Undo button brings back. */
export interface DoneNoticeState {
	text: string;
	undo?: { classId: string; id: string };
}

/**
 * The short notice after a deadline is ticked done ("Marked done" with Undo),
 * or when that save didn't work. The update pop-up's card, in the notice
 * stack (the page body when there is none, as in tests).
 */
export function DoneNotice({ notice, onUndo, onExpire }: { notice: DoneNoticeState; onUndo: () => void; onExpire: () => void }) {
	const { held, handlers } = useHeld();
	useEffect(() => {
		if (held) return;
		const timer = setTimeout(onExpire, NOTICE_MS);
		return () => clearTimeout(timer);
	}, [notice, held, onExpire]);
	return createPortal(
		<div
			data-testid="done-notice"
			{...handlers}
			role={notice.undo ? "status" : "alert"}
			className="lh-rise lh-popup flex items-center gap-2.5 px-4 py-2.5 font-ui text-sm text-ink"
		>
			{notice.text}
			{notice.undo && (
				<>
					<button type="button" data-testid="done-notice-undo" onClick={onUndo} className="lh-press lh-btn">
						Undo
					</button>
				</>
			)}
		</div>,
		document.getElementById(NOTICE_STACK_ID) ?? document.body,
	);
}

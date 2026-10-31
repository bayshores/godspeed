import { createPortal } from "react-dom";
import { NOTICE_STACK_ID } from "@/components/notice-stack";

/** What the notice after ticking a deadline done says. `undo`: the deadline
 *  its Undo button brings back. */
export interface DoneNoticeState {
	text: string;
	undo?: { classId: string; id: string };
}

/**
 * The short notice after a deadline is ticked done ("Marked done · Undo"),
 * or when that save didn't work. The update pop-up's card, in the notice
 * stack (the page body when there is none, as in tests).
 */
export function DoneNotice({ notice, onUndo }: { notice: DoneNoticeState; onUndo: () => void }) {
	return createPortal(
		<div
			data-testid="done-notice"
			role={notice.undo ? "status" : "alert"}
			className="lh-rise lh-glass flex items-center gap-2.5 px-4 py-2.5 font-ui text-sm text-ink"
		>
			{notice.text}
			{notice.undo && (
				<>
					<span className="text-ink-2" aria-hidden>
						·
					</span>
					<button type="button" data-testid="done-notice-undo" onClick={onUndo} className="lh-press font-bold text-ink hover:text-ink-max">
						Undo
					</button>
				</>
			)}
		</div>,
		document.getElementById(NOTICE_STACK_ID) ?? document.body,
	);
}

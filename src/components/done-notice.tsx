/** What the notice after ticking a deadline done says. `undo`: the deadline
 *  its Undo button brings back. */
export interface DoneNoticeState {
	text: string;
	undo?: { classId: string; id: string };
}

/**
 * The short notice at the bottom of the window after a deadline is ticked
 * done ("Marked done · Undo"), or when that save didn't work. The update
 * pop-up's card, centered.
 */
export function DoneNotice({ notice, onUndo }: { notice: DoneNoticeState; onUndo: () => void }) {
	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
			<div
				data-testid="done-notice"
				role={notice.undo ? "status" : "alert"}
				className="lh-rise lh-glass pointer-events-auto flex items-center gap-2.5 px-4 py-2.5 font-ui text-sm text-ink"
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
			</div>
		</div>
	);
}

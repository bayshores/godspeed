import { useEffect, type ReactNode } from "react";
import { useBackdropDismiss } from "@/frontend/components/backdrop-dismiss";
import { useDialogFocus } from "@/frontend/components/use-dialog-focus";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";

type MotionState = "open" | "closed";

/**
 * A dialog: a sheet out of the top bar, over the dimmed page, with its
 * title and "Close" on top, its fields in the middle (they scroll) and
 * its buttons in the foot. It comes in two widths: narrow for a question
 * or a form, wide for a list or a document.
 * "Close", Esc and a click outside all call onClose.
 */
export function DialogSheet({
	title,
	state,
	testid,
	busy = false,
	onClose,
	foot,
	wide = false,
	children,
}: {
	title: string;
	/** "closed" while the exit plays. */
	state: MotionState;
	testid: string;
	/** A save is running: "Close" is off. */
	busy?: boolean;
	onClose: () => void;
	/** The dialog's buttons; a dialog with none has no foot. */
	foot?: ReactNode;
	/** Holds a list or a document. */
	wide?: boolean;
	children: ReactNode;
}) {
	const ref = useDialogFocus<HTMLDivElement>(state === "open");
	const backdrop = useBackdropDismiss(onClose);
	useEffect(() => {
		if (state === "closed") return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// Claimed, so Esc never also stops the teacher's reply.
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [onClose, state]);
	return (
		<div data-state={state} inert={state === "closed"} className="lh-sheet-wrap" {...backdrop}>
			<div data-state={state} className="lh-hang relative">
				<div
					ref={ref}
					tabIndex={-1}
					role="dialog"
					aria-modal="true"
					aria-label={title}
					data-testid={testid}
					data-state={state}
					className={cn("lh-popup lh-hang-body flex max-h-[85vh] max-w-[calc(100vw-2rem)] flex-col outline-none", wide ? "w-[780px]" : "w-[560px]")}
				>
					<div className="flex shrink-0 items-center gap-2 pt-4 pr-3.5 pb-3.5 pl-6">
						<h2 className="lh-card-title flex-1 truncate">{title}</h2>
						<button type="button" data-testid={`${testid}-close`} disabled={busy} onClick={onClose} className="lh-btn lh-btn-quiet shrink-0">
							<PixelIcon name="close" />
							Close
						</button>
					</div>
					<div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-6 pt-[18px] pb-5">{children}</div>
					{foot && <div className="flex shrink-0 items-center gap-2.5 px-6 py-3.5">{foot}</div>}
				</div>
			</div>
		</div>
	);
}

import { useEffect, useState, type ReactNode } from "react";
import { useBackdropDismiss } from "@/frontend/components/backdrop-dismiss";
import { usePresence } from "@/frontend/components/presence";
import { useDialogFocus } from "@/frontend/components/use-dialog-focus";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";

type MotionState = "open" | "closed";

/** Keeps a closing dialog on screen with its last `value` while it fades out. */
export function useLastWhileClosing<T>(value: T | null): { mounted: boolean; state: MotionState; shown: T | null } {
	const presence = usePresence(value !== null);
	const [last, setLast] = useState(value);
	if (value !== null && value !== last) setLast(value);
	return { mounted: presence.mounted, state: presence.state, shown: value ?? last };
}

/**
 * A dialog: a sheet over the dimmed page with its title and "Close" on
 * top, its fields in the middle (they scroll) and its buttons in the foot.
 * "Close", Esc and a click outside all call onClose.
 */
export function DialogSheet({
	title,
	state,
	testid,
	busy = false,
	onClose,
	foot,
	className,
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
	className?: string;
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
		<div data-state={state} inert={state === "closed"} className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-black/40" {...backdrop}>
			<div
				ref={ref}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				data-testid={testid}
				data-state={state}
				className={cn("lh-dialog flex max-h-[85vh] w-[560px] max-w-[calc(100vw-2rem)] flex-col rounded border-2 border-line bg-panel", className)}
			>
				<div className="flex shrink-0 items-center gap-2 border-b-[1.5px] border-line pt-4 pr-3.5 pb-3.5 pl-6">
					<h2 className="min-w-0 flex-1 truncate text-[22px] leading-tight text-ink">{title}</h2>
					<button type="button" data-testid={`${testid}-close`} disabled={busy} onClick={onClose} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
						<PixelIcon name="close" />
						Close
					</button>
				</div>
				<div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-6 pt-[18px] pb-5">{children}</div>
				{foot && <div className="flex shrink-0 items-center gap-2.5 border-t border-border px-6 py-3.5">{foot}</div>}
			</div>
		</div>
	);
}

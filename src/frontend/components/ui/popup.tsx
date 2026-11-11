import { useEffect, type ReactNode } from "react";
import { useBackdropDismiss } from "@/frontend/components/backdrop-dismiss";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useDialogFocus } from "@/frontend/components/use-dialog-focus";
import { cn } from "@/frontend/lib/utils";

/**
 * A popup over the page: its name and "Close" in the head, the body under
 * a rule. Esc, the dimmed page and Close all close it.
 */
export function Popup({
	open,
	onClose,
	title,
	testid,
	className,
	children,
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	testid: string;
	/** The sheet's width. */
	className?: string;
	children: ReactNode;
}) {
	const backdropDismiss = useBackdropDismiss(onClose);
	const dialogRef = useDialogFocus<HTMLDivElement>(open);
	useEffect(() => {
		if (!open) return;
		// Claimed at the document, so the window's Esc (stop the reply) never also acts.
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onClose]);
	if (!open) return null;
	return (
		<div className="lh-fade fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]" {...backdropDismiss}>
			<div
				ref={dialogRef}
				tabIndex={-1}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				data-testid={testid}
				className={cn("lh-dialog lh-popup flex max-h-[76vh] w-full flex-col outline-none", className)}
			>
				<div className="flex shrink-0 items-center justify-between gap-4 border-b-2 border-ink py-3 pr-3 pl-6">
					<h2 className="text-xl text-ink">{title}</h2>
					<button type="button" data-testid={`${testid}-close`} onClick={onClose} className="lh-btn lh-btn-quiet">
						<PixelIcon name="close" />
						Close
					</button>
				</div>
				<div className="min-h-0 overflow-y-auto px-6 py-5">{children}</div>
			</div>
		</div>
	);
}

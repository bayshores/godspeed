import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { usePresence } from "@/components/presence";
import type { ConfirmCopy } from "./files-model";

/**
 * The Files page's confirm box before Unlink, Remove and the menu's
 * "Move to Course info": title, what goes, a safer way when there is one,
 * Cancel and the red action (the Delete class confirm's look). Esc, the
 * backdrop and Cancel all keep things as they are.
 */
export function ConfirmDialog({ copy, onConfirm, onClose }: { copy: ConfirmCopy | null; onConfirm: () => void; onClose: () => void }) {
	const presence = usePresence(copy !== null);
	const [last, setLast] = useState(copy);
	if (copy !== null && copy !== last) setLast(copy);
	const shown = copy ?? last;
	const backdropDismiss = useBackdropDismiss(onClose);
	useEffect(() => {
		if (copy === null) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [copy, onClose]);
	if (!presence.mounted || !shown) return null;
	return createPortal(
		<div data-state={presence.state} inert={copy === null} className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-black/70" {...backdropDismiss}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={shown.title}
				data-testid="files-confirm"
				data-state={presence.state}
				onClick={(e) => e.stopPropagation()}
				className="lh-dialog flex w-[420px] max-w-[calc(100vw-2rem)] flex-col gap-2 bg-panel px-5 py-4 text-[13px] shadow-[0_0_40px_#000000e6] outline outline-1 -outline-offset-1 outline-tone-2"
			>
				<span className="break-words text-sm font-bold text-ans-wrong">{shown.title}</span>
				<span className="text-ink-2">{shown.body}</span>
				{shown.note && <span className="text-ink-2">{shown.note}</span>}
				<div className="flex justify-end gap-2 pt-1">
					<button type="button" data-testid="files-confirm-cancel" onClick={onClose} className="lh-press px-3 py-1.5 font-bold text-ink-2 hover:text-ink">
						Cancel
					</button>
					<button
						type="button"
						data-testid="files-confirm-button"
						onClick={onConfirm}
						className="lh-press bg-ans-wrong px-3 py-1.5 font-bold text-white hover:bg-red-600"
					>
						{shown.action}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}

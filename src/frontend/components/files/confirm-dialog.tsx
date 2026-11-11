import { createPortal } from "react-dom";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import type { ConfirmCopy } from "./files-model";

/**
 * The Files page's confirm before Unlink, Remove and the menu's "Move to
 * Course info": the question as its title, what goes, a safer way when
 * there is one, then Cancel and the red action. Close, Esc, a click
 * outside and Cancel all keep things as they are.
 */
export function ConfirmDialog({ copy, onConfirm, onClose }: { copy: ConfirmCopy | null; onConfirm: () => void; onClose: () => void }) {
	const { mounted, state, shown } = useLastWhileClosing(copy);
	if (!mounted || !shown) return null;
	return createPortal(
		<DialogSheet
			title={shown.title}
			state={state}
			testid="files-confirm"
			onClose={onClose}
			className="w-[540px]"
			foot={
				<>
					<span className="flex-1" />
					<button type="button" data-testid="files-confirm-cancel" onClick={onClose} className="lh-btn h-[38px] bg-panel text-[15px]">
						Cancel
					</button>
					<button
						type="button"
						data-testid="files-confirm-button"
						onClick={onConfirm}
						className="lh-btn h-[38px] border-ans-wrong bg-ans-wrong text-[15px] text-background hover:border-ans-wrong-hover hover:bg-ans-wrong-hover"
					>
						{shown.action}
					</button>
				</>
			}
		>
			<p className="text-lg break-words text-ink">{shown.body}</p>
			{shown.note && <p className="text-[15px] text-ink-2">{shown.note}</p>}
		</DialogSheet>,
		document.body,
	);
}

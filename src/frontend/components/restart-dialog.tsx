import { createPortal } from "react-dom";
import { usePresence } from "@/frontend/components/presence";
import { DialogSheet } from "@/frontend/components/ui/dialog-sheet";

/** Asked before Restart now while a lesson turn runs: restarting stops it. */
export function RestartDialog({ name, open, onLater, onRestart }: { name: string; open: boolean; onLater: () => void; onRestart: () => void }) {
	const presence = usePresence(open);
	if (!presence.mounted || typeof document === "undefined") return null;
	return createPortal(
		<DialogSheet
			title="Restart godspeed?"
			state={presence.state}
			testid="restart-dialog"
			onClose={onLater}
			foot={
				<>
					<span className="flex-1" />
					<button type="button" data-testid="restart-later" onClick={onLater} className="lh-btn">
						Later
					</button>
					<button type="button" data-testid="restart-now" onClick={onRestart} className="lh-btn lh-btn-main">
						Restart now
					</button>
				</>
			}
		>
			<p className="text-item text-ink">{`${name} is answering you. Restarting stops ${name}.`}</p>
		</DialogSheet>,
		document.body,
	);
}

import { createPortal } from "react-dom";
import { usePresence } from "@/frontend/components/presence";
import { DialogSheet } from "@/frontend/components/ui/dialog-sheet";

/** Asked before Restart now while the teacher's terminal is answering a
 *  turn: restarting stops it, and godspeed never starts it again by itself. */
export function RestartDialog({ name, open, onLater, onRestart }: { name: string; open: boolean; onLater: () => void; onRestart: () => void }) {
	const presence = usePresence(open);
	if (!presence.mounted || typeof document === "undefined") return null;
	return createPortal(
		<DialogSheet
			title="Restart godspeed?"
			state={presence.state}
			testid="restart-dialog"
			onClose={onLater}
			className="w-[480px]"
			foot={
				<>
					<span className="flex-1" />
					<button type="button" data-testid="restart-later" onClick={onLater} className="lh-btn text-[15px]">
						Later
					</button>
					<button type="button" data-testid="restart-now" onClick={onRestart} className="lh-btn lh-btn-main text-[15px]">
						Restart now
					</button>
				</>
			}
		>
			<p className="text-lg text-ink">{`${name} is answering you. Restarting stops ${name}. Start it again after godspeed opens.`}</p>
		</DialogSheet>,
		document.body,
	);
}

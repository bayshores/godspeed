import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { usePresence } from "@/components/presence";

/**
 * The stop guard: the global Esc → abort chain and the Skip question and
 * Discard problem buttons open this confirm popup. Esc on the popup
 * itself cancels (claimed — it must never chain into another abort),
 * which is also why Chat's abort handler ignores events while this
 * dialog is open: two window listeners fire per Esc and stopPropagation
 * alone cannot order them.
 *
 * MINIMAL, the delete-node dialog's tone: title, one line, Cancel +
 * action. No busy state — both actions are local (a fetch that fires
 * and forgets, an answer submit whose own machinery shows progress).
 *
 * What "abort" means is mode-dependent: from a running turn it kills
 * the turn (partial stays); from a pending question there is no turn to
 * kill — abort IS dismissal: the silent route writes
 * the skipped toolResult and wakes NOTHING; the session pauses until
 * the user's next plain message, which carries the dismissal to the
 * model in its context.
 */

/** What is being stopped, skipped or discarded: drives copy and the confirm action. */
export type AbortMode = "turn" | "question" | "problem";

const COPY: Record<AbortMode, { title: string; line: string; action: string }> = {
	turn: {
		title: "Stop this reply?",
		line: "What the teacher wrote so far stays in the lesson.",
		action: "Stop",
	},
	question: {
		title: "Skip this question?",
		line: "The teacher moves on without it.",
		action: "Skip",
	},
	problem: {
		title: "Discard this problem?",
		line: "The problem is dropped. No solution is revealed.",
		action: "Discard",
	},
};

/** The dialog's pure body — exported for SSR pins (the delete-node
 * pattern). The wrapper owns effects + the portal. */
export function AbortTurnBody({
	mode,
	onClose,
	onConfirm,
	busy = false,
	state = "open",
}: {
	mode: AbortMode;
	onClose: () => void;
	onConfirm: () => void;
	/** The dismiss doubles as the abort when a turn is still running;
	 * the line says so. */
	busy?: boolean;
	/** "closed" while the exit plays — inert. */
	state?: "open" | "closed";
}) {
	const backdropDismiss = useBackdropDismiss(onClose);
	const copy = COPY[mode];
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label={copy.title}
			data-testid="abort-turn-dialog"
			data-state={state}
			inert={state === "closed"}
			className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
			// A genuine click on the scrim cancels — the cautious default, like Esc.
			{...backdropDismiss}
		>
			<div
				data-state={state}
				className="lh-dialog mx-4 w-full max-w-sm border bg-card p-5 shadow-lg"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="text-sm font-semibold text-card-foreground" data-testid="abort-turn-title">
					{copy.title}
				</h2>
				<p className="mt-1.5 text-xs text-muted-foreground" data-testid="abort-turn-line">
					{copy.line}
					{busy && mode !== "turn" ? " The teacher's reply stops too." : ""}
				</p>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						data-testid="abort-turn-cancel"
						onClick={onClose}
						className="lh-press px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
					>
						Cancel
					</button>
					<button
						type="button"
						data-testid="abort-turn-confirm"
						onClick={onConfirm}
						// Destructive red — the app's established destructive pair.
						className="lh-press border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20"
					>
						{copy.action}
					</button>
				</div>
			</div>
		</div>
	);
}

export function AbortTurnDialog({
	mode,
	onClose,
	onConfirm,
	busy = false,
}: {
	/** What is being stopped, skipped or discarded; null = closed (nothing rendered). */
	mode: AbortMode | null;
	onClose: () => void;
	onConfirm: (mode: AbortMode) => void;
	busy?: boolean;
}) {
	// Exit motion: the last mode stays on
	// screen while the dialog fades out.
	const presence = usePresence(mode !== null);
	const [lastMode, setLastMode] = useState(mode);
	if (mode !== null && mode !== lastMode) setLastMode(mode);
	const shown = mode ?? lastMode;

	// Esc cancels the popup (claimed — never a chained abort).
	useEffect(() => {
		if (mode === null) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Claim Esc at the document level: a window-level stopPropagation cannot stop
				// the earlier-registered global window listener.
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [mode, onClose]);

	if (!presence.mounted || shown === null || typeof document === "undefined") return null;
	return createPortal(
		<AbortTurnBody mode={shown} onClose={onClose} onConfirm={() => onConfirm(shown)} busy={busy} state={presence.state} />,
		document.body,
	);
}

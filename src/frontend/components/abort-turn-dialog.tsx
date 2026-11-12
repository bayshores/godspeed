import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useHalley } from "@/frontend/components/halley/halley-context";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";

/**
 * The stop guard: the global Esc → abort chain and the Skip question and
 * Discard problem buttons open this confirm popup. Esc on the popup
 * itself cancels (claimed — it must never chain into another abort),
 * which is also why Chat's abort handler ignores events while this
 * dialog is open: two window listeners fire per Esc and stopPropagation
 * alone cannot order them.
 *
 * Title, one line, Cancel + action. No busy state: both actions are local
 * (a fetch that fires and forgets, an answer submit whose own machinery
 * shows progress).
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

const COPY: Record<AbortMode, { title: string; line: (teacher: string) => string; action: string }> = {
	turn: {
		title: "Stop this reply?",
		line: (teacher) => `What ${teacher} wrote so far stays in the lesson.`,
		action: "Stop reply",
	},
	question: {
		title: "Skip this question?",
		line: (teacher) => `${teacher} moves on without it.`,
		action: "Skip question",
	},
	problem: {
		title: "Discard this problem?",
		line: () => "The problem is dropped. No solution is revealed.",
		action: "Discard problem",
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
	const teacher = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const copy = COPY[mode];
	return (
		<DialogSheet
			title={copy.title}
			state={state}
			testid="abort-turn-dialog"
			onClose={onClose}
			className="w-[480px]"
			foot={
				<>
					<span className="flex-1" />
					<button type="button" data-testid="abort-turn-cancel" onClick={onClose} className="lh-btn text-[15px]">
						Cancel
					</button>
					<button
						type="button"
						data-testid="abort-turn-confirm"
						onClick={onConfirm}
						className={`lh-btn text-[15px] ${mode === "problem" ? "lh-btn-danger" : "lh-btn-main"}`}
					>
						{copy.action}
					</button>
				</>
			}
		>
			<p data-testid="abort-turn-line" className="text-lg text-ink">
				{copy.line(teacher)}
				{busy && mode !== "turn" ? ` ${teacher}'s reply stops too.` : ""}
			</p>
		</DialogSheet>
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
	// Exit motion: the last mode stays on screen while the dialog fades out.
	const { mounted, state, shown } = useLastWhileClosing(mode);

	// Enter and digits behind the popup belong to it: without this, the
	// dock's Enter submit and the option digits still fire underneath
	// (Enter on "Discard this problem?" would send the problem instead).
	// Capture on document runs before every dock listener.
	useEffect(() => {
		if (mode === null) return;
		const onCapture = (e: KeyboardEvent) => {
			if (e.key !== "Enter" && !/^[0-9]$/.test(e.key)) return;
			if ((e.target as Element | null)?.closest?.('[data-testid="abort-turn-dialog"]')) return;
			e.preventDefault();
			e.stopPropagation();
		};
		document.addEventListener("keydown", onCapture, true);
		return () => document.removeEventListener("keydown", onCapture, true);
	}, [mode]);

	if (!mounted || shown === null || typeof document === "undefined") return null;
	return createPortal(<AbortTurnBody mode={shown} onClose={onClose} onConfirm={() => onConfirm(shown)} busy={busy} state={state} />, document.body);
}

/** Stopping in a lesson: the turn's stop, the layered Esc, and the confirm
 *  that skips a question or discards a problem. */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { dismissedAnswer, findPendingToolCall, toolQuestionKind, type activeProblemOf } from "@/shared/core";
import type { AbortMode } from "@/frontend/components/abort-turn-dialog";
import type { useChatSession } from "@/frontend/components/session";
import { escAbortTarget } from "@/frontend/components/lesson/chat-helpers";

type Session = Pick<ReturnType<typeof useChatSession>, "send" | "submitAnswer" | "dismissProblem">;

export function useLessonAbort({
	session,
	stopTurn,
	pendingRef,
	activeProblemRef,
	busyRef,
	focusOpen,
	closeMermaid,
	skipReview,
}: {
	session: Session;
	/** Stops the running turn (from `useLessonServer`). */
	stopTurn: () => void;
	pendingRef: RefObject<ReturnType<typeof findPendingToolCall>>;
	activeProblemRef: RefObject<ReturnType<typeof activeProblemOf>>;
	busyRef: RefObject<boolean>;
	/** A diagram or figure is open: it takes Esc first. */
	focusOpen: boolean;
	closeMermaid: () => void;
	skipReview: () => void;
}) {
	const { send, submitAnswer, dismissProblem } = session;

	// THE LAYERED ESC: an open focus claims Esc first (the plan's dialog
	// takes its own); then the abort chain: a question or problem opens its
	// confirm, a running reply stops at once (what it wrote stays).
	// The handler reads refs — the window listener is mount-scoped.
	const [abortAsk, setAbortAsk] = useState<AbortMode | null>(null);
	const escStateRef = useRef({ abortAsk, mermaid: false });
	escStateRef.current = { abortAsk, mermaid: focusOpen };
	useEffect(() => {
		const onAbort = () => {
			const s = escStateRef.current;
			const target = escAbortTarget({
				abortAsk: s.abortAsk !== null,
				mermaidFocus: s.mermaid,
				pending: pendingRef.current !== null,
				problem: activeProblemRef.current !== null,
				busy: busyRef.current,
			});
			if (target === "question" || target === "problem") setAbortAsk(target);
			else if (target === "turn") stopTurn();
			else if (target === "mermaid") closeMermaid();
		};
		window.addEventListener("lh:kbd-abort-turn", onAbort);
		return () => window.removeEventListener("lh:kbd-abort-turn", onAbort);
	}, [stopTurn]);
	const confirmAbort = useCallback(
		() => {
			setAbortAsk(null);
			const p = pendingRef.current;
			// A question from earlier is skipped alone: the teacher writes on.
			if (p?.appPosed?.kind === "review") {
				skipReview();
				return;
			}
			// The opener has no call of its own: its skip is an answer of none,
			// sent after the running turn is stopped, as the dialog says.
			if (p?.appPosed?.kind === "opener") {
				if (busyRef.current) stopTurn();
				void send({ type: "opener-answer", topicDoneCallId: p.appPosed.ref, answer: null });
				return;
			}
			// A skip is the question's answer, marked dismissed: the teacher moves
			// on at once. A running reply stops first; the send waits for it to end.
			if (p) {
				const question = (p.input as { question?: string } | null)?.question ?? "";
				if (busyRef.current) stopTurn();
				void submitAnswer(p.toolCallId, dismissedAnswer(toolQuestionKind(p.tool), question), []);
				return;
			}
			// The practice discard: the silent marker route.
			const problem = activeProblemRef.current;
			if (problem) {
				void dismissProblem(problem.toolCallId);
				if (busyRef.current) stopTurn();
			}
		},
		[stopTurn, submitAnswer, dismissProblem, send, skipReview],
	);
	return { abortAsk, setAbortAsk, confirmAbort };
}

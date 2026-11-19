/** Stopping in a lesson: the turn's stop, the layered Esc, and the confirm
 *  that skips a question or discards a problem. */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { dismissedAnswer, findPendingToolCall, toolQuestionKind, type activeProblemOf } from "@/shared/core";
import type { AbortMode } from "@/frontend/components/abort-turn-dialog";
import type { useChatSession } from "@/frontend/components/session";
import { escAbortTarget } from "@/frontend/components/lesson/chat-helpers";
import { jsonInit, send as sendRequest } from "@/frontend/lib/api";

type Session = Pick<ReturnType<typeof useChatSession>, "stop" | "status" | "send" | "submitAnswer" | "dismissProblem">;

export function useLessonAbort({
	chatId,
	session,
	localStreamRef,
	pendingRef,
	activeProblemRef,
	busyRef,
	readingThinkingRef,
	focusOpen,
	closeMermaid,
	skipReview,
}: {
	chatId: string;
	session: Session;
	localStreamRef: RefObject<unknown>;
	pendingRef: RefObject<ReturnType<typeof findPendingToolCall>>;
	activeProblemRef: RefObject<ReturnType<typeof activeProblemOf>>;
	busyRef: RefObject<boolean>;
	/** The thoughts noted while reading: they ride a skipped question's answer. */
	readingThinkingRef: RefObject<string>;
	/** A diagram or figure is open: it takes Esc first. */
	focusOpen: boolean;
	closeMermaid: () => void;
	skipReview: () => void;
}) {
	const { stop, status, send, submitAnswer, dismissProblem } = session;

	// The abort is always the remote kill (turns are server processes); a
	// local view also detaches at once and keeps the partial. A failed view
	// with a reply still running detaches too, so the send after it is not
	// taken for a recovery that re-attaches.
	const abortInFlightTurn = useCallback(() => {
		if (localStreamRef.current || status === "error") stop();
		// A failed abort is transient: the turn settles on its own.
		void sendRequest("/api/activity/abort", jsonInit("POST", { kind: "turn", id: chatId }));
	}, [chatId, stop, status, localStreamRef]);

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
			else if (target === "turn") abortInFlightTurn();
			else if (target === "mermaid") closeMermaid();
		};
		window.addEventListener("lh:kbd-abort-turn", onAbort);
		return () => window.removeEventListener("lh:kbd-abort-turn", onAbort);
	}, [abortInFlightTurn]);
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
				if (busyRef.current) abortInFlightTurn();
				void send({ type: "opener-answer", topicDoneCallId: p.appPosed.ref, answer: null });
				return;
			}
			// A skip is the question's answer, marked dismissed: the teacher moves
			// on at once. A running reply stops first; the send waits for it to end.
			if (p) {
				const question = (p.input as { question?: string } | null)?.question ?? "";
				const reading = readingThinkingRef.current.trim() || undefined;
				readingThinkingRef.current = "";
				const answer = dismissedAnswer(toolQuestionKind(p.tool), question);
				if (busyRef.current) abortInFlightTurn();
				void submitAnswer(p.toolCallId, reading ? { ...answer, readingThinking: reading } : answer, []);
				return;
			}
			// The practice discard: the silent marker route.
			const problem = activeProblemRef.current;
			if (problem) {
				void dismissProblem(problem.toolCallId);
				if (busyRef.current) abortInFlightTurn();
			}
		},
		[abortInFlightTurn, submitAnswer, dismissProblem, send, skipReview],
	);
	return { abortInFlightTurn, abortAsk, setAbortAsk, confirmAbort };
}

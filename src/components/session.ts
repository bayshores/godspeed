/**
 * THE SESSION HOOK: the React adapter over the pure SessionModel
 * (session-core.ts, testable without a renderer). All mechanics live in
 * the model; this hook re-renders on change and derives the view
 * (core/view.ts projectView).
 *
 * Every turn is a server-side background process; the hook is a view.
 * Status vocabulary: ready | submitted | streaming | error.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { reuseUnchangedMessages, type ChatInput, type LhMessage, type QuestionAnswerData } from "@/core";
import { SessionModel, type SessionState } from "@/components/session-core";

/** The streaming redraw's safety net when animation frames pause (a
 *  hidden window): the update still lands within this many ms. */
const STREAM_FRAME_FALLBACK_MS = 100;

interface UseChatSessionOptions {
	chatId: string;
	/** The native record seed (server-rendered page or a full sync). */
	initialMessages: LhMessage[];
	/** Transient settlement failure retained by the server, not the transcript. */
	initialError?: string;
	/** Reattach on mount: a turn is running server-side with no live view. */
	initiallyInFlight?: boolean;
}

export function useChatSession({ chatId, initialMessages, initialError, initiallyInFlight }: UseChatSessionOptions) {
	// The model is per-mount (chatId-keyed component); onChange forces the
	// re-render. The ref pattern keeps it stable across renders.
	const modelRef = useRef<SessionModel | null>(null);
	if (modelRef.current === null) {
		modelRef.current = new SessionModel({ chatId, initialMessages, initialError });
	}
	const model = modelRef.current;
	// The render VERSION — bumped by every model change, so the state memo
	// below recomputes exactly when the model actually changed. (The
	// reducer's dispatch can't be the memo dep: it is STABLE by contract,
	// so the memo would compute once per mount and never update.)
	const [version, bump] = useReducer((n: number) => n + 1, 0);
	// ONE REDRAW PER FRAME while text streams: token
	// updates arrive faster than the screen refreshes, so they coalesce
	// into the next animation frame. Every other change (status flips,
	// sends, errors, settle) redraws at once and carries any pending
	// update with it. The timer covers hidden windows, where frames pause.
	useEffect(() => {
		let frame = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const flush = () => {
			if (frame) cancelAnimationFrame(frame);
			if (timer) clearTimeout(timer);
			frame = 0;
			timer = undefined;
			bump();
		};
		model.onChange = () => {
			if (model.status !== "streaming" || typeof requestAnimationFrame !== "function") {
				flush();
				return;
			}
			if (frame || timer) return;
			frame = requestAnimationFrame(flush);
			timer = setTimeout(flush, STREAM_FRAME_FALLBACK_MS);
		};
		return () => {
			model.onChange = undefined;
			if (frame) cancelAnimationFrame(frame);
			if (timer) clearTimeout(timer);
		};
	}, [model, bump]);

	// Reattach on mount (StrictMode-safe: a newer resume cancels the older).
	// ATTACH-FIRST: the page render just read the record, so a fresh mount
	// attaches directly without a blocking refetch. This hook's effect is
	// the SINGLE mount-reattach owner.
	//
	// Unmount RELEASES the stream connection. The turn runs on server-side
	// with zero views; a leaked stream would pin one of the browser's
	// 6-per-origin connection slots until the turn settled, and enough of
	// them starve every new request. Aborting costs nothing: navigating
	// back replays the compacted log + live tail.
	useEffect(() => {
		if (initiallyInFlight) void model.resumeStream(false);
		return () => {
			model.stop();
		};
	}, [initiallyInFlight, model]);

	// The view + state, derived per model change from the model. Unchanged
	// view messages keep their previous objects (reuseUnchangedMessages), so
	// only the message being written redraws its transcript row.
	const prevViewRef = useRef<SessionState["messages"]>([]);
	const state = useMemo<SessionState>(() => {
		const next = model.getState();
		const messages = reuseUnchangedMessages(prevViewRef.current, next.messages);
		prevViewRef.current = messages;
		return { ...next, messages };
	}, [model, version] as const);

	// THE TURN-STATE BROADCAST: the instant a turn starts locally
	// (submitted: send, answer, session start, reattach, wake attach) the
	// sidebar learns it without waiting for its 2.5s poll; at settle the
	// event clears the row and triggers one immediate refetch. The model
	// stays pure; this adapter owns the window seam (the lh:chat-renamed
	// pattern).
	const prevStatusRef = useRef(state.status);
	useEffect(() => {
		const was = prevStatusRef.current;
		prevStatusRef.current = state.status;
		if (was === state.status) return;
		const running = state.status === "submitted" || state.status === "streaming";
		const wasRunning = was === "submitted" || was === "streaming";
		if (running === wasRunning) return; // submitted→streaming: still running; error↔ready: not
		window.dispatchEvent(new CustomEvent("lh:turn-state", { detail: { id: chatId, running } }));
	}, [state.status, chatId]);

	// The reattach settled terminal → the sync-and-continue seam (chat.tsx).
	const setReattachSettled = useCallback(
		(fn: () => void) => {
			model.setReattachSettled(fn);
		},
		[model],
	);

	const send = useCallback((input: ChatInput) => model.send(input), [model]);
	const continueIfOwed = useCallback((record: readonly LhMessage[]) => void model.continueIfOwed(record), [model]);
	const steer = useCallback((text: string) => model.steer(text), [model]);
	const submitAnswer = useCallback(
		(toolCallId: string, output: QuestionAnswerData) => void model.submitAnswer(toolCallId, output),
		[model],
	);
	const dismissQuestion = useCallback(
		(toolCallId: string, answer: QuestionAnswerData) => void model.dismissQuestion(toolCallId, answer),
		[model],
	);
	const dismissProblem = useCallback(
		(problemCallId: string) => void model.dismissProblem(problemCallId),
		[model],
	);
	const setMessages = useCallback((record: LhMessage[], turnError?: string) => model.setMessages(record, turnError), [model]);
	const adoptRecord = useCallback((record: LhMessage[]) => model.adoptRecord(record), [model]);
	const stop = useCallback(() => model.stop(), [model]);
	const clearError = useCallback(() => model.clearError(), [model]);
	const resumeStream = useCallback(() => void model.resumeStream(), [model]);

	return {
		messages: state.messages,
		nativeMessages: state.nativeMessages,
		contextTokens: state.contextTokens,
		status: state.status,
		error: state.error,
		steerQueue: state.steerQueue,
		send,
		continueIfOwed,
		steer,
		submitAnswer,
		dismissQuestion,
		dismissProblem,
		setMessages,
		adoptRecord,
		stop,
		clearError,
		resumeStream,
		setReattachSettled,
	};
}

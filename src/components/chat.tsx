"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { useChatSession } from "@/components/session";
import { visibleQueuedSteers } from "@/components/session-core";
import { prefersReducedMotion, usePresence } from "@/components/presence";
import { cn } from "@/lib/utils";
import { useFieldCycle } from "@/components/field-cycle";
import { useEnterSubmits } from "@/components/enter-submits";
import { JobsContext } from "@/components/jobs-context";
import { ChatActionsContext } from "@/components/chat-actions-context";
import { StatsBar } from "@/components/stats-bar";
import { WAITING_NOTICE, agentWaiting, useAgentStatus } from "@/components/agent-status";
import { latestTree } from "@/components/plan-latest";
import { MermaidOverlay, SessionMermaidContext } from "@/components/session-overlay";
import { AbortTurnDialog, type AbortMode } from "@/components/abort-turn-dialog";
import { SessionFind } from "@/components/session-find";
import { currentUserThinkingOpen, setAllUserThinkingOpen } from "@/components/thinking-block";
import {
	activeProblemOf,
	answerOutcome,
	dismissedAnswer,
	findPendingToolCall,
	kbdEventForAction,
	phaseTimeline,
	planStepBar,
	questionNeedsReveal,
	toolQuestionKind,
	type ChatAttachment,
	type LhMessage,
	type QuestionAnswerData,
} from "@/core";
import { escAbortTarget, initialPromptOwed, restoreUnsent } from "@/components/lesson/chat-helpers";
import { useArrivals } from "@/components/lesson/arrivals";
import { LessonStepsContext, answerAnchorSelector } from "@/components/lesson/step-context";
import { practiceProgress } from "@/components/lesson/practice-progress";
import { useLessonServer } from "@/components/lesson/use-lesson-server";
import { useTitleRename } from "@/components/lesson/use-title-rename";
import { LessonTopBar } from "@/components/lesson/lesson-top-bar";
import { ReadingPane } from "@/components/lesson/reading-pane";
import { YourTurnPanel } from "@/components/lesson/your-turn-panel";
import { useAttachmentDraft } from "@/components/lesson/attachment-tray";
import { useHalley, useHalleyLesson } from "@/components/halley/halley-provider";

// The plan popup (and dagre, its layout engine) loads on first open.
const PlanPopup = dynamic(() => import("@/components/plan-block").then((m) => m.PlanPopup), { ssr: false });

/**
 * THE LESSON: the plan step bar on top, the reading
 * pane on the left, the Your-turn panel on the right (below the text in
 * narrow windows). This component owns the lesson's state and wiring; the
 * pieces live in src/components/lesson/.
 */
export function Chat({
	chatId,
	title,
	initialMessages,
	initialError,
	initialPrompt,
	initiallyInFlight,
	initiallyCompacting = false,
	kind = "teach",
}: {
	chatId: string;
	title: string;
	initialMessages: LhMessage[];
	/** Memory-only settlement notice supplied on reopening. */
	initialError?: string;
	/** Practice lessons show their problems instead of a plan. */
	kind?: "teach" | "practice";
	initialPrompt?: string;
	/** A teacher turn is running server-side with no client attached. */
	initiallyInFlight?: boolean;
	/** A compaction holds the chat's model gate at mount. */
	initiallyCompacting?: boolean;
}) {
	// THE SESSION HOOK: the record is native history; the view is derived
	// client-side (core/view.ts projectView).
	const session = useChatSession({ chatId, initialMessages, initialError, initiallyInFlight });
	const { messages, nativeMessages, contextTokens, send, continueIfOwed, steer, steerQueue, submitAnswer, dismissQuestion, dismissProblem, questionDraft, saveQuestionDraft, status, error, stop } = session;
	const { turnInFlight, localStreamRef, syncFromServer, jobs, turns, pricing, compacting } = useLessonServer({
		chatId,
		session,
		initiallyInFlight: initiallyInFlight ?? false,
		initiallyCompacting,
	});
	const rename = useTitleRename(chatId, title);

	const sessionFindScopeRef = useRef<HTMLDivElement | null>(null);
	const scrollContextRef = useRef<StickToBottomContext | null>(null);
	const arrive = useArrivals();
	const [arrivalsLive, setArrivalsLive] = useState(false);
	useEffect(() => setArrivalsLive(true), []);

	// A new lesson with a topic sends its first message exactly once.
	const sentInitial = useRef(false);
	useEffect(() => {
		if (!sentInitial.current && initialPromptOwed(initialMessages, initialPrompt)) {
			sentInitial.current = true;
			void send({ type: "text", text: initialPrompt! });
		}
	}, [initialPrompt, initialMessages, send]);

	// Mount continuation: a record ending on a fulfilled tool (a job result
	// landed with no client open) resumes the lesson — once, and never while
	// a turn already runs server-side.
	const mountContinuation = useRef(false);
	useEffect(() => {
		if (mountContinuation.current) return;
		mountContinuation.current = true;
		if (!initiallyInFlight) continueIfOwed(initialMessages);
		// mount-only by design
	}, []);

	const pending = useMemo(() => findPendingToolCall(messages), [messages]);
	const pendingRef = useRef(pending);
	pendingRef.current = pending;
	// The active practice problem, from the native record (the fold the
	// tools themselves read). It owns the panel like a pending question.
	const activeProblem = useMemo(() => activeProblemOf(nativeMessages), [nativeMessages]);
	const activeProblemRef = useRef(activeProblem);
	activeProblemRef.current = activeProblem;

	// This view's own turn: send() drops input while it runs. A wake turn
	// (turnInFlight alone) still takes sends; they wait it out.
	const sessionBusy = status === "submitted" || status === "streaming";
	const busy = sessionBusy || turnInFlight;
	// The turn is waiting on the outside agent and none is connected: say so
	// in the composer (it starts by itself once the agent connects).
	const agentStatus = useAgentStatus();
	const waitingForAgent = busy && agentWaiting(agentStatus);
	const busyRef = useRef(busy);
	busyRef.current = busy;
	// Halley rests in the reading pane: Talking while the teacher writes,
	// Thinking while the turn runs.
	useHalleyLesson(status === "streaming", busy);
	const halley = useHalley();

	// The abort is always the remote kill (turns are server processes); a
	// local view also detaches at once and keeps the partial.
	const abortInFlightTurn = useCallback(() => {
		if (localStreamRef.current) stop();
		void fetch("/api/activity/abort", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "turn", id: chatId }),
		}).catch(() => {
			/* transient — the turn settles on its own */
		});
	}, [chatId, stop, localStreamRef]);

	// The phase at every message (the teach seam) and the current phase.
	const phases = useMemo(() => phaseTimeline(messages), [messages]);
	const phase = phases.at(-1) ?? "probe";
	// A teach-phase check waits behind "Check your understanding".
	const requiresReveal = pending !== null && questionNeedsReveal(pending.tool, pending.input, phase);

	/* The reading-thinking channel: thoughts noted while
	 * reading, riding the check's answer (or its dismissal) as the separate
	 * readingThinking field. Reset per pending question. */
	const [readingThinking, setReadingThinking] = useState("");
	const readingThinkingRef = useRef("");
	const applyReadingThinking = useCallback((v: string) => {
		readingThinkingRef.current = v;
		setReadingThinking(v);
	}, []);
	const clearReadingThinking = useCallback(() => applyReadingThinking(""), [applyReadingThinking]);
	const pendingQuestionId = pending?.toolCallId ?? null;
	useEffect(() => {
		// A failed submission of THIS call restores its reading draft.
		applyReadingThinking(pendingQuestionId ? questionDraft(pendingQuestionId)?.readingThinking ?? "" : "");
	}, [pendingQuestionId, questionDraft, applyReadingThinking]);

	// ⌘T: set every "your thinking" row in the lesson to one state.
	useEffect(() => {
		const onToggle = () => setAllUserThinkingOpen(!currentUserThinkingOpen());
		window.addEventListener(kbdEventForAction("toggle-user-thinking"), onToggle);
		return () => window.removeEventListener(kbdEventForAction("toggle-user-thinking"), onToggle);
	}, []);

	// ── overlays: plan map, mermaid and figure focus, abort confirm ──
	const [planOpen, setPlanOpen] = useState(false);
	const planPresence = usePresence(planOpen);
	const openPlan = useCallback(() => setPlanOpen(true), []);
	const [mermaidFocus, setMermaidFocus] = useState<string | null>(null);
	const [figureFocus, setFigureFocus] = useState<{ svg: string; inverted: boolean } | null>(null);
	const mermaidPresence = usePresence(mermaidFocus !== null);
	const figurePresence = usePresence(figureFocus !== null);
	// The last focus each overlay showed, held through its exit fade.
	const lastMermaidRef = useRef(mermaidFocus);
	if (mermaidFocus !== null) lastMermaidRef.current = mermaidFocus;
	const lastFigureRef = useRef(figureFocus);
	if (figureFocus !== null) lastFigureRef.current = figureFocus;

	// THE LAYERED ESC: an open overlay claims Esc first;
	// then the abort chain opens its confirm (question → problem → turn).
	// The handler reads refs — the window listener is mount-scoped.
	const [abortAsk, setAbortAsk] = useState<AbortMode | null>(null);
	const escStateRef = useRef({ abortAsk, mermaid: false, planOpen });
	escStateRef.current = { abortAsk, mermaid: mermaidFocus !== null || figureFocus !== null, planOpen };
	useEffect(() => {
		const onAbort = () => {
			const s = escStateRef.current;
			const target = escAbortTarget({
				abortAsk: s.abortAsk !== null,
				mermaidFocus: s.mermaid,
				planOpen: s.planOpen,
				pending: pendingRef.current !== null,
				problem: activeProblemRef.current !== null,
				busy: busyRef.current,
			});
			if (target === "question" || target === "problem" || target === "turn") setAbortAsk(target);
			else if (target === "mermaid") setMermaidFocus(null);
			else if (target === "plan") setPlanOpen(false);
		};
		window.addEventListener("lh:kbd-abort-turn", onAbort);
		return () => window.removeEventListener("lh:kbd-abort-turn", onAbort);
	}, []);
	const confirmAbort = useCallback(
		(mode: AbortMode) => {
			setAbortAsk(null);
			if (mode === "turn") {
				abortInFlightTurn();
				return;
			}
			// A pending question's dismiss is silent (no turn); mid-turn it also
			// kills the running turn, and the route parks the dismissal.
			const p = pendingRef.current;
			if (p) {
				const question = (p.input as { question?: string } | null)?.question ?? "";
				const reading = readingThinkingRef.current.trim() || undefined;
				clearReadingThinking();
				const answer = dismissedAnswer(toolQuestionKind(p.tool), question);
				void dismissQuestion(p.toolCallId, reading ? { ...answer, readingThinking: reading } : answer);
				if (busyRef.current) abortInFlightTurn();
				return;
			}
			// The practice discard: the silent marker route.
			const problem = activeProblemRef.current;
			if (problem) {
				void dismissProblem(problem.toolCallId);
				if (busyRef.current) abortInFlightTurn();
			}
		},
		[abortInFlightTurn, dismissQuestion, dismissProblem, clearReadingThinking],
	);

	// ── the message box ──
	const [text, setText] = useState("");
	const textRef = useRef("");
	const applyText = useCallback((v: string) => {
		textRef.current = v;
		setText(v);
	}, []);
	// Tab cycles the lesson's fields in visual order.
	const cycleChatFields = useCallback((): readonly HTMLElement[] => {
		const pick = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
		return [
			...pick('[data-testid="reading-thinking-field"] textarea'),
			...pick('[data-testid="question-dock"] textarea'),
			...pick('[data-testid="practice-dock"] textarea'),
			...pick('[data-testid="composer"] textarea'),
		];
	}, []);
	useFieldCycle(cycleChatFields);

	const attachments = useAttachmentDraft();
	const hasFiles = attachments.files.length > 0;

	// A running turn never gates the box: Enter while busy STEERS it (text
	// only, so waiting files hold the send). A waiting question or problem
	// owns the panel; compaction gates sends.
	const canSend = (text.trim().length > 0 || hasFiles) && !(busy && hasFiles) && !pending && !activeProblem && !compacting;

	/* THE PRACTICE PAUSE: between problems, once a problem
	 * has ever been posed — Enter on an empty box (or anywhere) asks for the
	 * next one. */
	const posedAny = useMemo(
		() =>
			kind === "practice" &&
			nativeMessages.some(
				(m) =>
					(m as { role?: string }).role === "assistant" &&
					Array.isArray((m as { content?: unknown[] }).content) &&
					(m as { content: Array<{ type?: string; name?: string }> }).content.some((b) => b.type === "toolCall" && b.name === "problem"),
			),
		[kind, nativeMessages],
	);
	const nextReady = posedAny && !pending && !activeProblem && !compacting && !busy;
	const sendNext = useCallback(() => {
		if (!nextReady) return;
		void send({ type: "next" });
	}, [nextReady, send]);
	useEnterSubmits(sendNext);

	const submitThinking = useCallback(
		(t: string, files: ChatAttachment[]) => {
			const problem = activeProblemRef.current;
			if (!problem) return Promise.resolve(false);
			return send({ type: "thinking", problemCallId: problem.toolCallId, text: t, ...(files.length > 0 ? { attachments: files } : {}) });
		},
		[send],
	);

	/* STEER VS SEND: a send while a turn runs (ours or
	 * a wake) steers it; idle takes the plain send (a raced settle 409s and
	 * falls back to exactly that). */
	const onSend = () => {
		if (pending || compacting) return;
		const t = textRef.current.trim();
		const files = attachments.files.map((f) => f.attachment);
		if (!t && files.length === 0) return;
		if (busy) {
			if (files.length > 0) return;
			applyText("");
			void steer(t).then((sent) => {
				if (!sent) applyText(restoreUnsent(t, textRef.current));
			});
			return;
		}
		const drafts = attachments.files;
		applyText("");
		attachments.clear();
		void send({ type: "text", text: t, ...(files.length > 0 ? { attachments: files } : {}) }).then((sent) => {
			if (sent) return;
			applyText(restoreUnsent(t, textRef.current));
			attachments.restore(drafts);
		});
	};

	// THE ANSWER IS THE QUESTION CALL'S TOOL RESULT: one input event, one
	// turn. The reading-thinking draft rides along.
	const onSubmitAnswer = (output: QuestionAnswerData) => {
		if (!pending) return;
		saveQuestionDraft(pending.toolCallId, { readingThinking: readingThinkingRef.current });
		const reading = readingThinkingRef.current.trim() || undefined;
		submitAnswer(pending.toolCallId, reading ? { ...output, readingThinking: reading } : output);
		// Graded right or wrong: Halley reacts for a moment.
		const outcome = answerOutcome(output);
		if (outcome === "right") halley?.react("happy");
		else if (outcome === "wrong") halley?.react("oops");
	};

	// ── the top bar's data ──
	const planTree = useMemo(() => latestTree(messages), [messages]);
	const freshBar = useMemo(() => (kind === "practice" ? null : planStepBar(planTree, messages)), [kind, planTree, messages]);
	// Stable while nothing in it changed, so streaming never redraws the bar.
	const barKey = freshBar ? JSON.stringify(freshBar) : "";
	const stepBar = useMemo(() => freshBar, [barKey]);
	const stepIdsKey = stepBar ? stepBar.steps.map((s) => s.id).join("\n") : "";
	const stepNumbers = useMemo(() => new Map(stepBar?.steps.map((s, i) => [s.id, i + 1]) ?? []), [stepIdsKey]);
	const practice = useMemo(() => (kind === "practice" ? practiceProgress(messages, activeProblem !== null) : null), [kind, messages, activeProblem]);
	const practiceKey = practice ? JSON.stringify(practice) : "";
	const stablePractice = useMemo(() => practice, [practiceKey]);

	// Click a done step: scroll back to its first answered question.
	const jumpToAnswer = useCallback((toolCallId: string) => {
		const el = sessionFindScopeRef.current?.querySelector(answerAnchorSelector(toolCallId));
		if (!el) return;
		scrollContextRef.current?.stopScroll();
		el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
	}, []);

	// The demo's error report follows the message box's rules: never past a
	// waiting question, problem or compaction, and a running turn is steered.
	const canSendText = !pending && !activeProblem && !compacting;
	const chatActions = useMemo(
		() => ({
			chatId,
			syncFromServer,
			canSendText,
			sendText: (t: string) => {
				if (!canSendText) return;
				if (busyRef.current) void steer(t);
				else void send({ type: "text", text: t });
			},
		}),
		[chatId, syncFromServer, send, steer, canSendText],
	);
	const mermaidActions = useMemo(
		() => ({ openMermaid: setMermaidFocus, openFigure: (svg: string, inverted: boolean) => setFigureFocus({ svg, inverted }) }),
		[],
	);

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<SessionMermaidContext.Provider value={mermaidActions}>
				<JobsContext.Provider value={jobs}>
					<LessonStepsContext.Provider value={stepNumbers}>
						<div className="flex h-dvh min-w-0 flex-1 flex-col">
							<LessonTopBar kind={kind} rename={rename} bar={stepBar} practice={stablePractice} onJump={jumpToAnswer} onOpenPlan={openPlan} />
							<SessionFind scopeRef={sessionFindScopeRef} scrollContextRef={scrollContextRef} />
							<div ref={sessionFindScopeRef} className="relative flex min-h-0 flex-1 flex-col min-[1100px]:flex-row">
								<ReadingPane
									messages={messages}
									phases={phases}
									status={status}
									busy={busy}
									turnInFlight={turnInFlight}
									compacting={compacting}
									error={error}
									arrivalsLive={arrivalsLive}
									arrive={arrive}
									onOpenPlan={openPlan}
									scrollContextRef={scrollContextRef}
								/>
								<YourTurnPanel
									pending={pending}
									requiresReveal={requiresReveal}
									initialQuestionDraft={pending ? questionDraft(pending.toolCallId)?.form : undefined}
									onSaveQuestionDraft={(form) => {
										if (pending) saveQuestionDraft(pending.toolCallId, { form });
									}}
									onSubmitAnswer={onSubmitAnswer}
									readingThinking={readingThinking}
									onReadingThinking={applyReadingThinking}
									practice={activeProblem}
									practiceNumber={stablePractice?.currentNumber ?? null}
									onSubmitThinking={submitThinking}
									sessionBusy={sessionBusy}
									compacting={compacting}
									composer={{
										busy,
										value: text,
										onChange: applyText,
										onSend,
										onStop: abortInFlightTurn,
										canSend,
										nextProblem: nextReady,
										onNext: sendNext,
										queuedSteers: visibleQueuedSteers(steerQueue, nativeMessages),
										attachments,
										notice: waitingForAgent ? (
											<p data-testid="composer-waiting" className="text-xs text-ink-2">
												{WAITING_NOTICE}
											</p>
										) : undefined,
									}}
									stats={<StatsBar turns={turns} contextTokens={contextTokens} pricing={pricing} chatId={chatId} />}
								/>

								{/* The session-scoped focuses: absolute over the lesson area, below
								    the top bar; each fades out through usePresence. */}
								{mermaidPresence.mounted && lastMermaidRef.current !== null && (
									<div className={cn("absolute inset-0 z-40", mermaidPresence.state === "closed" && "lh-fade")} data-state={mermaidPresence.state}>
										<MermaidOverlay chart={lastMermaidRef.current} onClose={() => setMermaidFocus(null)} />
									</div>
								)}
								{figurePresence.mounted && lastFigureRef.current !== null && (
									<div className={cn("absolute inset-0 z-40", figurePresence.state === "closed" && "lh-fade")} data-state={figurePresence.state}>
										<MermaidOverlay svg={lastFigureRef.current.svg} inverted={lastFigureRef.current.inverted} onClose={() => setFigureFocus(null)} />
									</div>
								)}
								{planPresence.mounted && <PlanPopup messages={messages} onClose={() => setPlanOpen(false)} state={planPresence.state} />}
								<AbortTurnDialog mode={abortAsk} onClose={() => setAbortAsk(null)} onConfirm={confirmAbort} busy={busy} />
							</div>
						</div>
					</LessonStepsContext.Provider>
				</JobsContext.Provider>
			</SessionMermaidContext.Provider>
		</ChatActionsContext.Provider>
	);
}

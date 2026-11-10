"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { useChatSession } from "@/frontend/components/session";
import { visibleQueuedSteers } from "@/frontend/components/session-core";
import { prefersReducedMotion, usePresence } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import { useEnterSubmits } from "@/frontend/components/enter-submits";
import { JobsContext } from "@/frontend/components/jobs-context";
import { ChatActionsContext } from "@/frontend/components/chat-actions-context";
import { StatsBar } from "@/frontend/components/stats-bar";
import { useSummarizePoint } from "@/frontend/components/use-summarize-point";
import { agentWaiting, useAgentStatus } from "@/frontend/components/agent-status";
import { latestTree } from "@/frontend/components/plan-latest";
import { MermaidOverlay, SessionMermaidContext } from "@/frontend/components/session-overlay";
import { AbortTurnDialog, type AbortMode } from "@/frontend/components/abort-turn-dialog";
import { SessionFind } from "@/frontend/components/session-find";
import { currentUserThinkingOpen, setAllUserThinkingOpen } from "@/frontend/components/thinking-block";
import {
	activeProblemOf,
	answerOutcome,
	dismissedAnswer,
	findPendingToolCall,
	firstPhase,
	homeworkProblems,
	isSideTurn,
	kbdEventForAction,
	phaseTimeline,
	planStepBar,
	problemLabel,
	problemSource,
	questionNeedsReveal,
	toolQuestionKind,
	type ChatAttachment,
	type HomeworkView,
	type LessonKind,
	type LhMessage,
	type PlanTree,
	type QuestionAnswerData,
} from "@/shared/core";
import { escAbortTarget, initialPromptOwed, restoreUnsent, sendBlockedReason, stuckClaimMinutes, stuckRetry } from "@/frontend/components/lesson/chat-helpers";
import { holdsDraft } from "@/frontend/components/lesson/lesson-drafts-model";
import { lastLearnerText, lessonError, retryAction } from "@/frontend/components/lesson/lesson-error-model";
import { useLessonDrafts } from "@/frontend/components/lesson/use-lesson-drafts";
import { useArrivals } from "@/frontend/components/lesson/arrivals";
import { LessonStepsContext, answerAnchorSelector } from "@/frontend/components/lesson/step-context";
import { practiceProgress } from "@/frontend/components/lesson/practice-progress";
import { useLessonServer } from "@/frontend/components/lesson/use-lesson-server";
import { useTitleRename } from "@/frontend/components/lesson/use-title-rename";
import { LessonTopBar } from "@/frontend/components/lesson/lesson-top-bar";
import { ProblemsPane } from "@/frontend/components/lesson/problems-pane";
import { ReadingPane } from "@/frontend/components/lesson/reading-pane";
import { YourTurnPanel } from "@/frontend/components/lesson/your-turn-panel";
import { LessonBox } from "@/frontend/components/lesson/lesson-box";
import { StepsPane } from "@/frontend/components/lesson/steps-pane";
import { Pane } from "@/frontend/components/ui/pane";
import { useAttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { takeStartFiles } from "@/frontend/components/lesson/start-files";
import { useHalley, useHalleyLesson } from "@/frontend/components/halley/halley-provider";
import { useFoldSidebar } from "@/frontend/components/sidebar";
import { SheetDock, useSheetDock } from "@/frontend/components/cheat-sheet/sheet-dock";
import { sessionAbout } from "@/frontend/components/cheat-sheet/dock-model";

// The plan popup (and dagre, its layout engine) loads on first open.
const PlanPopup = dynamic(() => import("@/frontend/components/plan-block").then((m) => m.PlanPopup), { ssr: false });

/**
 * THE LESSON: the reading pane with the one message box under it on the
 * left, the right column (steps pane, Your-turn panel) on the right (below
 * the text in narrow windows). This component owns the lesson's state and wiring; the
 * pieces live in src/frontend/components/lesson/.
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
	initialTree,
	classId,
	deadlineId,
	homework,
}: {
	chatId: string;
	title: string;
	/** The session's class and the deadline it was started from: the
	 *  cheat sheet beside it shows that deadline's sheet. */
	classId?: string;
	deadlineId?: string;
	initialMessages: LhMessage[];
	/** A homework lesson's deadline: its problems fill the steps pane. */
	homework?: HomeworkView;
	/** Memory-only settlement notice supplied on reopening. */
	initialError?: string;
	/** Practice lessons show their problems instead of a plan; study
	 *  lessons start teaching at once, with problems too. */
	kind?: LessonKind;
	/** The record's plan: the step bar's plan until a plan_init call
	 *  writes a newer one (a study session's plan has no such call). */
	initialTree?: PlanTree;
	initialPrompt?: string;
	/** A teacher turn is running server-side with no client attached. */
	initiallyInFlight?: boolean;
	/** A compaction holds the chat's model gate at mount. */
	initiallyCompacting?: boolean;
}) {
	// THE SESSION HOOK: the record is native history; the view is derived
	// client-side (core/view.ts projectView).
	const session = useChatSession({ chatId, initialMessages, initialError, initiallyInFlight });
	const { messages, nativeMessages, contextTokens, send, continueIfOwed, steer, steerQueue, submitAnswer, dismissQuestion, dismissProblem, status, error, stop, clearError, resumeStream } = session;
	const summarizeAt = useSummarizePoint();
	const { turnInFlight, localStreamRef, jobs, turns, pricing, compacting } = useLessonServer({
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

	// A new lesson with a topic sends its first message exactly once, with
	// any files added on the start page. The topic then leaves the address,
	// which a remount with the first render's props (a cached page, a code
	// reload) checks, so it can't send it again.
	const sentInitial = useRef(false);
	useEffect(() => {
		const inAddress = new URLSearchParams(window.location.search).has("prompt");
		if (!sentInitial.current && inAddress && initialPromptOwed(initialMessages, initialPrompt)) {
			sentInitial.current = true;
			const files = takeStartFiles(chatId);
			void send({ type: "text", text: initialPrompt!, ...(files.length > 0 ? { attachments: [...files] } : {}) });
			window.history.replaceState(null, "", window.location.pathname);
		}
	}, [chatId, initialPrompt, initialMessages, send]);

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
	const activeProblemId = activeProblem?.toolCallId ?? null;
	// Unsent text, saved per lesson so leaving or a reload never loses it.
	const drafts = useLessonDrafts(chatId, nativeMessages, activeProblemId);
	const { saveComposer, saveQuestion, saveProblem } = drafts;

	// A turn runs: this view's own, or one the app started (a wake).
	const busy = status === "submitted" || status === "streaming" || turnInFlight;
	// The turn is waiting on the outside agent and none is connected: say so
	// in the composer (it starts by itself once the agent connects).
	const agentStatus = useAgentStatus();
	const waitingForAgent = busy && agentWaiting(agentStatus);
	const busyRef = useRef(busy);
	busyRef.current = busy;
	// An agent took this turn and hasn't answered for a while: offer to stop
	// it (the minutes refresh while the line shows).
	const claimedAt = agentStatus?.claimedLessons.find((c) => c.lessonId === chatId)?.claimedAt;
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!claimedAt) return;
		setNow(Date.now());
		const t = setInterval(() => setNow(Date.now()), 30_000);
		return () => clearInterval(t);
	}, [claimedAt]);
	const stuckMinutes = busy ? stuckClaimMinutes(claimedAt, now) : null;
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

	// The stuck-turn line stops the turn and runs it again at once (its
	// wording is the confirmation); send() waits until the stopped turn ends.
	// The line hides at once, so a double click can't stop the new turn too.
	const [retriedClaim, setRetriedClaim] = useState<string>();
	const stuck = stuckMinutes !== null && claimedAt !== retriedClaim ? stuckRetry(nativeMessages) : null;
	const stopAndRetry = () => {
		if (!stuck) return;
		setRetriedClaim(claimedAt);
		abortInFlightTurn();
		void send(stuck);
	};

	// The phase at every message (the teach seam) and the current phase.
	const phases = useMemo(() => phaseTimeline(messages, firstPhase(kind)), [messages, kind]);
	const phase = phases.at(-1) ?? firstPhase(kind);
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
	// Each question restores its own reading thoughts (once the drafts are read).
	const draftsLoaded = drafts.draft !== null;
	const draftRef = useRef(drafts.draft);
	draftRef.current = drafts.draft;
	useEffect(() => {
		applyReadingThinking(pendingQuestionId ? draftRef.current?.questions[pendingQuestionId]?.readingThinking ?? "" : "");
	}, [pendingQuestionId, draftsLoaded, applyReadingThinking]);
	const editReadingThinking = useCallback(
		(v: string) => {
			applyReadingThinking(v);
			if (pendingQuestionId) saveQuestion(pendingQuestionId, { readingThinking: v });
		},
		[applyReadingThinking, pendingQuestionId, saveQuestion],
	);

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
	// Every change saves the draft: a send clears it, a refused send puts it back.
	const editText = useCallback(
		(v: string) => {
			applyText(v);
			saveComposer(v);
		},
		[applyText, saveComposer],
	);
	useEffect(() => {
		if (draftsLoaded && draftRef.current?.composer) applyText(draftRef.current.composer);
	}, [draftsLoaded, applyText]);

	// Follow never takes the window away from unsent text.
	const draftHeld = drafts.draft !== null && holdsDraft(drafts.draft, { questionId: pendingQuestionId, problemId: activeProblemId });
	// Halley rests in the reading pane: Talking while the teacher writes,
	// Thinking while the turn runs.
	useHalleyLesson(status === "streaming", busy, draftHeld);
	// A lesson takes the whole width; the top bar's toggle still opens the sidebar.
	useFoldSidebar();
	const attachments = useAttachmentDraft(chatId);
	const hasFiles = attachments.files.length > 0;

	// A running turn never gates the box: Enter while busy STEERS it (text
	// only, so waiting files hold the send). A waiting question or problem
	// owns the panel; compaction gates sends. Under a waiting question or
	// problem the box asks a side question, never while the teacher replies.
	// A homework problem is worked on in the box itself: plain messages.
	const practiceProblem = activeProblem !== null && kind !== "homework";
	const sendBlocked = sendBlockedReason({ pending: pending !== null, problem: practiceProblem, compacting });
	const sideOpen = pending !== null ? "question" : practiceProblem ? "problem" : null;
	const sideReply = busy && sideOpen !== null && isSideTurn(nativeMessages);
	const canSend = sideOpen
		? (text.trim().length > 0 || hasFiles) && !busy && !compacting
		: (text.trim().length > 0 || hasFiles) && !(busy && hasFiles) && sendBlocked === null;

	/* THE PRACTICE PAUSE (practice and study): between problems, once a
	 * problem has ever been posed — Enter on an empty box (or anywhere)
	 * asks for the next one. */
	const posedAny = useMemo(
		() =>
			nativeMessages.some(
				(m) =>
					(m as { role?: string }).role === "assistant" &&
					Array.isArray((m as { content?: unknown[] }).content) &&
					(m as { content: Array<{ type?: string; name?: string }> }).content.some((b) => b.type === "toolCall" && b.name === "problem"),
			),
		[nativeMessages],
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
	 * falls back to exactly that). Under a waiting question or problem it is
	 * a side question. */
	const onSend = () => {
		if (compacting) return;
		const t = textRef.current.trim();
		const files = attachments.files.map((f) => f.attachment);
		// A steer of the running turn is text only.
		if (busy && sideOpen === null) {
			if (!t || files.length > 0) return;
			editText("");
			void steer(t).then((sent) => {
				if (!sent) editText(restoreUnsent(t, textRef.current));
			});
			return;
		}
		if (busy || (!t && files.length === 0)) return;
		const drafts = attachments.files;
		editText("");
		attachments.clear();
		void send({ type: sideOpen ? "side" : "text", text: t, ...(files.length > 0 ? { attachments: files } : {}) }).then((sent) => {
			if (sent) return;
			editText(restoreUnsent(t, textRef.current));
			attachments.restore(drafts);
		});
	};

	// THE ANSWER IS THE QUESTION CALL'S TOOL RESULT: one input event, one
	// turn. The reading-thinking draft and the answer's files ride along.
	const onSubmitAnswer = (output: QuestionAnswerData, files: ChatAttachment[]) => {
		if (!pending) return Promise.resolve(false);
		const reading = readingThinkingRef.current.trim() || undefined;
		const sent = submitAnswer(pending.toolCallId, reading ? { ...output, readingThinking: reading } : output, files);
		// Graded right or wrong: Halley reacts for a moment.
		const outcome = answerOutcome(output);
		if (outcome === "right") halley?.react("happy");
		else if (outcome === "wrong") halley?.react("oops");
		return sent;
	};

	// ── the top bar's data ──
	const planTree = useMemo(() => latestTree(messages) ?? initialTree ?? null, [messages, initialTree]);
	const freshBar = useMemo(() => (kind === "practice" || kind === "homework" ? null : planStepBar(planTree, messages)), [kind, planTree, messages]);
	// A homework lesson's problems: the deadline's list plus this lesson's posts and done marks.
	const freshProblems = useMemo(() => (kind === "homework" ? homeworkProblems(homework?.problems ?? [], messages) : null), [kind, homework, messages]);
	const problemsKey = freshProblems ? JSON.stringify(freshProblems) : "";
	const problems = useMemo(() => freshProblems, [problemsKey]);
	const openProblem = problems?.open ? problems.problems.find((p) => p.number === problems.open) : undefined;
	// Stable while nothing in it changed, so streaming never redraws the bar.
	const barKey = freshBar ? JSON.stringify(freshBar) : "";
	const stepBar = useMemo(() => freshBar, [barKey]);
	const stepIdsKey = stepBar ? stepBar.steps.map((s) => s.id).join("\n") : "";
	const stepNumbers = useMemo(() => new Map(stepBar?.steps.map((s, i) => [s.id, i + 1]) ?? []), [stepIdsKey]);
	// Problem numbers (and practice's top bar blocks).
	const practice = useMemo(() => (kind === "teach" ? null : practiceProgress(messages, activeProblem !== null)), [kind, messages, activeProblem]);
	const practiceKey = practice ? JSON.stringify(practice) : "";
	const stablePractice = useMemo(() => practice, [practiceKey]);

	// Scroll the lesson to a card in it.
	const scrollToCard = useCallback((selector: string) => {
		const el = sessionFindScopeRef.current?.querySelector(selector);
		if (!el) return;
		scrollContextRef.current?.stopScroll();
		el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
	}, []);
	// Click a done step: scroll back to its first answered question.
	const jumpToAnswer = useCallback((toolCallId: string) => scrollToCard(answerAnchorSelector(toolCallId)), [scrollToCard]);

	// The demo's error report follows the message box's rules: never past a
	// waiting question, problem or compaction, and a running turn is steered.
	const chatActions = useMemo(
		() => ({
			chatId,
			sendBlocked,
			sendText: (t: string) => {
				if (sendBlocked !== null) return;
				if (busyRef.current) void steer(t);
				else void send({ type: "text", text: t });
			},
		}),
		[chatId, send, steer, sendBlocked],
	);

	// The error banner's Try again: send again what didn't go through, run a
	// failed reply again, or read the lesson again (and attach to a running reply).
	const retry = () => {
		if (!error) return;
		const action = retryAction(lessonError(error.message).kind, { boxHasText: textRef.current.trim().length > 0, lastText: lastLearnerText(nativeMessages) });
		if (action.type === "send-box") onSend();
		else if (action.type === "resend") void send({ type: sideOpen ? "side" : "text", text: action.text });
		else if (action.type === "continue") void send({ type: "continue" });
		else {
			clearError();
			resumeStream();
		}
	};
	const mermaidActions = useMemo(
		() => ({ openMermaid: setMermaidFocus, openFigure: (svg: string, inverted: boolean) => setFigureFocus({ svg, inverted }) }),
		[],
	);

	// The cheat sheet beside the session; a message from it takes the problem or question the learner is on.
	const sheet = useSheetDock(chatId);
	const problemWork = activeProblemId ? drafts.draft?.problems[activeProblemId] : undefined;
	const sheetAbout = useMemo(
		() => sessionAbout({ session: rename.title, problem: activeProblem?.input, work: problemWork, question: pending?.input }),
		[rename.title, activeProblem, problemWork, pending],
	);

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<SessionMermaidContext.Provider value={mermaidActions}>
				<JobsContext.Provider value={jobs}>
					<LessonStepsContext.Provider value={stepNumbers}>
						<div className="flex h-full min-w-0 flex-1">
							<div className="@container/lesson flex min-w-0 flex-1 flex-col">
								<LessonTopBar
									kind={kind}
									rename={rename}
									practice={stablePractice}
									sheet={classId ? { open: sheet.state.open, onToggle: () => sheet.update({ open: !sheet.state.open }) } : undefined}
									file={homework?.assignment ?? undefined}
								/>
								<SessionFind scopeRef={sessionFindScopeRef} scrollContextRef={scrollContextRef} />
								<div ref={sessionFindScopeRef} className="relative flex min-h-0 flex-1 flex-col gap-4 px-5 pt-6 pb-5 @min-[760px]/lesson:flex-row">
									<Pane className="flex min-h-0 min-w-0 flex-1 flex-col">
									<ReadingPane
										messages={messages}
										phases={phases}
										status={status}
										busy={busy}
										turnInFlight={turnInFlight}
										compacting={compacting}
										waitingForAgent={waitingForAgent}
										error={error}
										onRetry={retry}
										arrivalsLive={arrivalsLive}
										arrive={arrive}
										onOpenPlan={openPlan}
										scrollContextRef={scrollContextRef}
									/>
									<LessonBox
										busy={busy}
										value={text}
										onChange={editText}
										onSend={onSend}
										onStop={abortInFlightTurn}
										canSend={canSend}
										showStop={sideOpen === null || sideReply || pending !== null}
										sideOpen={sideOpen}
										nextReady={nextReady}
										onNext={sendNext}
										queuedSteers={visibleQueuedSteers(steerQueue, nativeMessages)}
										attachments={attachments}
										notice={
											stuck ? (
												<p data-testid="turn-stuck" className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm leading-5 text-ink-2">
													Your agent took this {stuckMinutes} minutes ago and hasn't answered.
													<button type="button" data-testid="turn-stuck-stop" onClick={stopAndRetry} className="lh-press lh-btn">
														{stuck.type === "text" ? "Stop and send again?" : "Stop and try again?"}
													</button>
												</p>
											) : undefined
										}
									/>
									</Pane>
									<YourTurnPanel
										// Remounts once the saved drafts are read, so the forms start from them.
										key={draftsLoaded ? "drafts" : "loading"}
										steps={
											problems ? (
												<ProblemsPane name={homework?.name ?? title} problems={problems.problems} open={problems.open} />
											) : kind !== "practice" && stepBar && stepBar.steps.length > 0 ? (
												<StepsPane bar={stepBar} onJump={jumpToAnswer} onOpenPlan={openPlan} />
											) : null
										}
										homeworkProblem={
											openProblem && { label: problemLabel(openProblem.number), source: problemSource(homework?.assignment ?? null, openProblem.page), part: problems?.part ?? null }
										}
										pending={pending}
										requiresReveal={requiresReveal}
										initialQuestionDraft={pendingQuestionId ? drafts.draft?.questions[pendingQuestionId]?.form : undefined}
										onSaveQuestionDraft={(form) => {
											if (pendingQuestionId) saveQuestion(pendingQuestionId, { form });
										}}
										onSubmitAnswer={onSubmitAnswer}
										onSkipQuestion={() => setAbortAsk("question")}
										readingThinking={readingThinking}
										onReadingThinking={editReadingThinking}
										practice={activeProblem}
										initialPracticeDraft={activeProblemId ? drafts.draft?.problems[activeProblemId] : undefined}
										onSavePracticeDraft={(t) => {
											if (activeProblemId) saveProblem(activeProblemId, t);
										}}
										onSubmitThinking={submitThinking}
										onDiscardProblem={() => setAbortAsk("problem")}
										onShowProblem={() => {
											if (activeProblemId) scrollToCard(`[data-problem-call="${activeProblemId}"]`);
										}}
										busy={busy}
										waitingForAgent={waitingForAgent}
										onStop={sideReply ? undefined : abortInFlightTurn}
										next={nextReady ? (kind === "study" ? "Continue" : "Next problem") : undefined}
										onNext={sendNext}
										compacting={compacting}
										stats={<StatsBar turns={turns} contextTokens={contextTokens} summarizeAt={summarizeAt} pricing={pricing} />}
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
									{planPresence.mounted && <PlanPopup tree={planTree} messages={messages} onClose={() => setPlanOpen(false)} state={planPresence.state} />}
									<AbortTurnDialog mode={abortAsk} onClose={() => setAbortAsk(null)} onConfirm={confirmAbort} busy={busy} />
								</div>
							</div>
							{classId && sheet.state.open && (
								<SheetDock
									classId={classId}
									sessionDeadlineId={deadlineId}
									picked={sheet.state.deadlineId}
									onPick={(id) => sheet.update({ deadlineId: id })}
									about={sheetAbout}
									onClose={() => sheet.update({ open: false })}
								/>
							)}
						</div>
					</LessonStepsContext.Provider>
				</JobsContext.Provider>
			</SessionMermaidContext.Provider>
		</ChatActionsContext.Provider>
	);
}

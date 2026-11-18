import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { useChatSession } from "@/frontend/components/session";
import { visibleQueuedSteers } from "@/frontend/components/session-core";
import { prefersReducedMotion, usePresence } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";
import { lazyComponent } from "@/frontend/lib/lazy-component";
import { JobsContext } from "@/frontend/components/jobs-context";
import { ChatActionsContext } from "@/frontend/components/chat-actions-context";
import { StatsBar } from "@/frontend/components/stats-bar";
import { agentWaiting, lessonAgentWaiting, useAgentStatus } from "@/frontend/components/agent-status";
import { latestTree } from "@/frontend/components/plan-latest";
import { MermaidOverlay, SessionMermaidContext } from "@/frontend/components/session-overlay";
import { AbortTurnDialog, type AbortMode } from "@/frontend/components/abort-turn-dialog";
import { currentUserThinkingOpen, setAllUserThinkingOpen } from "@/frontend/components/thinking-block";
import {
	activeProblemOf,
	answerTakesFiles,
	DEFAULT_TEACHER_NAME,
	dismissedAnswer,
	effectiveThresholdTokens,
	findPendingToolCall,
	firstPhase,
	homeworkProblems,
	kbdEventForAction,
	OUTSIDE_AGENT_CONTEXT_WINDOW,
	phaseTimeline,
	planStepBar,
	questionNeedsReveal,
	toolQuestionKind,
	topicParts,
	type HomeworkView,
	type LessonKind,
	type LhMessage,
	type PlanTree,
	type ChatAttachment,
	type QuestionAnswerData,
	withOpenReview,
} from "@/shared/core";
import { escAbortTarget, goAheadLabel, initialPromptOwed, problemPosed, restoreUnsent, sendBlockedReason, stuckClaimMinutes, stuckRetry } from "@/frontend/components/lesson/chat-helpers";
import { holdsDraft } from "@/frontend/components/lesson/lesson-drafts-model";
import { lastLearnerText, lessonError, retryAction } from "@/frontend/components/lesson/lesson-error-model";
import { useLessonDrafts } from "@/frontend/components/lesson/use-lesson-drafts";
import { useArrivals } from "@/frontend/components/lesson/arrivals";
import { LessonStepsContext, answerAnchorSelector } from "@/frontend/components/lesson/step-context";
import { practiceProgress } from "@/frontend/components/lesson/practice-progress";
import { useLessonServer } from "@/frontend/components/lesson/use-lesson-server";
import { useTitleRename } from "@/frontend/components/lesson/use-title-rename";
import { useLessonStop } from "@/frontend/components/lesson/use-lesson-stop";
import { useFromEarlier } from "@/frontend/components/lesson/use-from-earlier";
import { LessonBar } from "@/frontend/components/lesson/lesson-bar";
import { LessonWorkFrame } from "@/frontend/components/lesson/lesson-work-frame";
import { PlanRow } from "@/frontend/components/lesson/plan-row";
import { LessonScroll } from "@/frontend/components/lesson/lesson-scroll";
import { homeworkStartLabel } from "@/frontend/components/lesson/plan-row-model";
import { ReadingPane } from "@/frontend/components/lesson/reading-pane";
import { topicPageMarks } from "@/frontend/components/citations/page-excerpt-model";
import { TurnSheet, yourTurnShown } from "@/frontend/components/lesson/turn-sheet";
import type { QuestionHandle } from "@/frontend/components/question-dock";
import { useTerminalLines } from "@/frontend/components/terminal/use-terminal-lines";
import { Pane } from "@/frontend/components/ui/pane";
import { useAttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { takeStartFiles } from "@/frontend/components/lesson/start-files";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { useTeacherLesson } from "@/frontend/components/teacher/teacher-provider";
import { SheetDock, useSheetDock } from "@/frontend/components/cheat-sheet/sheet-dock";
import { lessonPluginContext } from "@/frontend/components/lesson/lesson-plugins-model";
import { PluginWindow } from "@/frontend/components/lesson/plugin-window";
import { useSpaces } from "@/frontend/components/space-context";
import { usePluginsAt } from "@/frontend/lib/use-plugins-at";
import { jsonInit } from "@/frontend/lib/api";
import { useStableValue } from "@/frontend/lib/use-stable-value";
import { useNow } from "@/frontend/components/use-now";

/** The lesson size where it gets summarized (the size meter's end). */
const SUMMARIZE_AT = effectiveThresholdTokens(OUTSIDE_AGENT_CONTEXT_WINDOW);

// The plan popup (and dagre, its layout engine) loads on first open.
const PlanPopup = lazyComponent(() => import("@/frontend/components/plan-block").then((m) => m.PlanPopup));

/** A lesson with no topic pages. */
const NO_PAGES: ReadonlyMap<string, string> = new Map();

/**
 * THE LESSON: its title and words in the top bar (LessonBar), then one page that scrolls (LessonScroll):
 * the step line, the lesson text's sheet and "Your turn" beside it (or
 * under it in a small room) while something waits for the learner, with
 * the cheat sheet beside both when
 * docked. The learner talks to the teacher in its terminal; those lines
 * come here (useTerminalLines). This component owns the lesson's state and
 * wiring; the pieces live in src/frontend/components/lesson/.
 */

export function Chat({
	chatId,
	title,
	initialMessages,
	initialError,
	initialPrompt,
	initiallyInFlight,
	kind = "teach",
	initialTree,
	spaceId,
	deadlineId,
	homework,
}: {
	chatId: string;
	title: string;
	/** The session's space and the deadline it was started from: the
	 *  cheat sheet beside it shows that deadline's sheet. */
	spaceId?: string;
	deadlineId?: string;
	initialMessages: LhMessage[];
	/** A homework lesson's deadline: its problems fill the plan row. */
	homework?: HomeworkView;
	/** Memory-only settlement notice supplied on reopening. */
	initialError?: string;
	/** Practice lessons show their problems instead of a plan; study
	 *  lessons start teaching at once, with problems too. */
	kind?: LessonKind;
	/** The record's plan: the step bar's plan until a plan_init call
	 *  writes a newer one. A study session with no space topics has
	 *  none until the agent's plan_init. */
	initialTree?: PlanTree;
	initialPrompt?: string;
	/** A teacher turn is running server-side with no client attached. */
	initiallyInFlight?: boolean;
}) {
	// THE SESSION HOOK: the record is native history; the view is derived
	// client-side (core/view.ts projectView).
	const session = useChatSession({ chatId, initialMessages, initialError, initiallyInFlight });
	const { messages, nativeMessages, contextTokens, send, continueIfOwed, steer, steerQueue, submitAnswer, dismissProblem, keepGoing, dropKept, status, error, stop, clearError, resumeStream } = session;
	const { turnInFlight, localStreamRef, jobs, turns, pricing, adoptAppendOnly } = useLessonServer({
		chatId,
		session,
		initiallyInFlight: initiallyInFlight ?? false,
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
			window.history.replaceState(window.history.state, "", window.location.pathname);
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

	const teacherPending = useMemo(() => findPendingToolCall(messages), [messages]);
	// The active practice problem, from the native record (the fold the
	// tools themselves read). It owns the panel like a pending question.
	const activeProblem = useMemo(() => activeProblemOf(nativeMessages), [nativeMessages]);
	const activeProblemRef = useRef(activeProblem);
	activeProblemRef.current = activeProblem;
	// Unsent text, saved per lesson so leaving or a reload never loses it.
	const drafts = useLessonDrafts(chatId, nativeMessages);
	const { saveComposer, saveQuestion } = drafts;

	// A turn runs: this view's own, or one the app started (a wake).
	const busy = status === "submitted" || status === "streaming" || turnInFlight;
	// The turn is waiting on the outside agent and none is connected: say so
	// in the composer (it starts by itself once the agent connects).
	const agentStatus = useAgentStatus();
	const teacher = useTeacher();
	const teacherName = teacher?.name ?? DEFAULT_TEACHER_NAME;
	const waitingForAgent = busy && agentWaiting(agentStatus);
	const noAgent = lessonAgentWaiting(agentStatus);
	const busyRef = useRef(busy);
	busyRef.current = busy;

	// Questions from earlier fill a Study lesson's wait for its teacher or
	// its agent. The open one shows before the teacher's own question.
	const { question: reviewQuestion, answer: answerReview, skip: skipReview, refused: reviewRefused } = useFromEarlier({
		chatId,
		waiting: kind === "study" && (busy || noAgent),
		open: teacherPending !== null || activeProblem !== null,
		busy,
		onAnswered: adoptAppendOnly,
	});
	const pending = useMemo(() => findPendingToolCall(withOpenReview(messages, reviewQuestion)), [messages, reviewQuestion]);
	const pendingRef = useRef(pending);
	pendingRef.current = pending;
	// An agent took this turn and hasn't answered for a while: offer to stop
	// it (the minutes refresh while the line shows).
	const claimedAt = agentStatus?.claimedLessons.find((c) => c.lessonId === chatId)?.claimedAt;
	const now = useNow(Boolean(claimedAt), 30_000);
	const stuckMinutes = busy ? stuckClaimMinutes(claimedAt, now) : null;

	// The abort is always the remote kill (turns are server processes); a
	// local view also detaches at once and keeps the partial. A failed view
	// with a reply still running detaches too, so the send after it is not
	// taken for a recovery that re-attaches.
	const abortInFlightTurn = useCallback(() => {
		if (localStreamRef.current || status === "error") stop();
		void fetch("/api/activity/abort", jsonInit("POST", { kind: "turn", id: chatId })).catch(() => {
			/* transient — the turn settles on its own */
		});
	}, [chatId, stop, status, localStreamRef]);

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
	const requiresReveal = pending !== null && pending.appPosed?.kind !== "review" && questionNeedsReveal(pending.tool, pending.input, phase);

	/* The reading-thinking channel: thoughts noted in the box while reading,
	 * kept when the check opens and riding its answer (or its dismissal) as
	 * the separate readingThinking field. Each question has its own. */
	const readingThinkingRef = useRef("");
	const pendingQuestionId = pending?.toolCallId ?? null;
	const draftsLoaded = drafts.draft !== null;
	const draftRef = useRef(drafts.draft);
	draftRef.current = drafts.draft;
	useEffect(() => {
		readingThinkingRef.current = pendingQuestionId ? (draftRef.current?.questions[pendingQuestionId]?.readingThinking ?? "") : "";
	}, [pendingQuestionId, draftsLoaded]);

	// ⌘T: set every "your thinking" row in the lesson to one state.
	useEffect(() => {
		const onToggle = () => setAllUserThinkingOpen(!currentUserThinkingOpen());
		window.addEventListener(kbdEventForAction("toggle-user-thinking"), onToggle);
		return () => window.removeEventListener(kbdEventForAction("toggle-user-thinking"), onToggle);
	}, []);

	// ── overlays: the plan, mermaid and figure focus, abort confirm ──
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

	// THE LAYERED ESC: an open focus claims Esc first (the plan's dialog
	// takes its own); then the abort chain: a question or problem opens its
	// confirm, a running reply stops at once (what it wrote stays).
	// The handler reads refs — the window listener is mount-scoped.
	const [abortAsk, setAbortAsk] = useState<AbortMode | null>(null);
	const escStateRef = useRef({ abortAsk, mermaid: false });
	escStateRef.current = { abortAsk, mermaid: mermaidFocus !== null || figureFocus !== null };
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
			else if (target === "mermaid") setMermaidFocus(null);
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

	// ── the answer box ──
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
	const draftHeld = drafts.draft !== null && holdsDraft(drafts.draft, pendingQuestionId);
	// The teacher's status in a lesson: Talking while it writes, Thinking
	// while the turn runs.
	useTeacherLesson(status === "streaming", busy, draftHeld);
	const attachments = useAttachmentDraft(chatId);

	// A line typed to the teacher while it writes STEERS the reply (text
	// only). Under a waiting question it is a side question, never while
	// the teacher replies. An open problem is worked on in the box: plain
	// messages.
	const sideOpen = pending !== null;
	const questionRef = useRef<QuestionHandle>(null);
	const sendBlocked = sendBlockedReason(sideOpen);

	// A homework lesson's problems: the deadline's list plus this lesson's posts and done marks.
	const freshProblems = useMemo(() => (kind === "homework" ? homeworkProblems(homework?.problems ?? [], messages) : null), [kind, homework, messages]);
	const problems = useStableValue(freshProblems);
	const startLabel = problems && homeworkStartLabel(problems.problems);
	const teacherSpoke = useMemo(() => nativeMessages.some((m) => (m as { role?: string }).role === "assistant"), [nativeMessages]);
	const posedAny = useMemo(() => problemPosed(nativeMessages), [nativeMessages]);

	// A pick from the homework's problem list. Why none can open yet: the
	// lesson's own words for a reply under way, or the question waiting.
	const openBlocked = busy ? (waitingForAgent ? `Waiting for ${teacherName}` : "The teacher is writing.") : pending ? "Answer the question first." : null;
	const workBoxRef = useRef<{ focus(): void }>(null);
	const openPick = useCallback(
		(number: string | null) => {
			if (number === null) workBoxRef.current?.focus();
			else if (openBlocked === null) void send({ type: "open", number });
		},
		[openBlocked, send],
	);

	// The problem's work in the box, once the teacher is free.
	const onSend = () => {
		const t = textRef.current.trim();
		if (busy || (!t && attachments.files.length === 0)) return;
		const drafts = attachments.files;
		editText("");
		attachments.clear();
		void send({ type: "text", text: t, ...(drafts.length > 0 ? { attachments: drafts.map((f) => f.attachment) } : {}) }).then((sent) => {
			if (sent) return;
			editText(restoreUnsent(t, textRef.current));
			attachments.restore(drafts);
		});
	};

	/* A LINE FROM THE TERMINAL: while a turn runs (ours or a wake) it
	 * steers it; idle it is the learner's next message (a raced settle 409s
	 * and falls back to exactly that). Under a waiting question it is a
	 * side question; about the opener or a question from earlier, it leaves
	 * that open too. False when the lesson can't take it now: it goes on to
	 * the agent. */
	const sendLine = (line: string, files: ChatAttachment[]): Promise<boolean> => {
		const t = line.trim();
		if (busy && !sideOpen) return t && files.length === 0 ? steer(t) : Promise.resolve(false);
		if (busy || (!t && files.length === 0)) return Promise.resolve(false);
		const posed = pending?.appPosed;
		const picked = questionRef.current?.picked() ?? [];
		const about =
			posed?.kind === "opener" ? { opener: posed.ref } : posed?.kind === "review" ? { reviewOf: posed.ref, ...(picked.length > 0 ? { picked } : {}) } : null;
		const input = about ? ({ type: "text", text: t, about } as const) : ({ type: sideOpen ? "side" : "text", text: t } as const);
		return send({ ...input, ...(files.length > 0 ? { attachments: files } : {}) });
	};
	useTerminalLines("lesson", sendLine);

	// THE ANSWER IS THE QUESTION CALL'S TOOL RESULT: one input event, one
	// turn. The reading thoughts ride along, and so do the box's files for
	// an answer that takes them. The box empties; a refused answer puts
	// its text and files back.
	const onSubmitAnswer = (output: QuestionAnswerData) => {
		if (!pending) return;
		const reading = readingThinkingRef.current.trim() || undefined;
		const typed = textRef.current;
		const files = answerTakesFiles(pending.tool) ? attachments.files : [];
		editText("");
		if (files.length > 0) attachments.clear();
		const answer = reading ? { ...output, readingThinking: reading } : output;
		const posed = pending.appPosed;
		const sending =
			posed?.kind === "review"
				? answerReview(answer)
				: posed
					? send({ type: "opener-answer", topicDoneCallId: posed.ref, answer })
					: submitAnswer(pending.toolCallId, answer, files.map((f) => f.attachment));
		void sending.then((sent) => {
			if (sent) return;
			if (typed.trim()) editText(restoreUnsent(typed, textRef.current));
			if (files.length > 0) attachments.restore(files);
		});
	};

	// "Check your understanding": what was typed while reading is kept as
	// the reading thoughts, and the box empties for the answer.
	const revealCheck = () => {
		const thoughts = textRef.current.trim();
		if (!thoughts || !pendingQuestionId) return;
		const all = readingThinkingRef.current ? `${readingThinkingRef.current}\n${thoughts}` : thoughts;
		readingThinkingRef.current = all;
		saveQuestion(pendingQuestionId, { readingThinking: all });
		editText("");
	};

	// ── the plan row's data ──
	const planTree = useMemo(() => latestTree(messages) ?? initialTree ?? null, [messages, initialTree]);
	const freshBar = useMemo(() => (kind === "practice" || kind === "homework" ? null : planStepBar(planTree, messages)), [kind, planTree, messages]);
	const openProblem = problems?.open ? problems.problems.find((p) => p.number === problems.open) : undefined;
	const planHomework = useMemo(() => (problems ? { problems: problems.problems, open: problems.open, blocked: openBlocked } : null), [problems, openBlocked]);
	// Stable while nothing in it changed, so streaming never redraws the bar.
	const stepBar = useStableValue(freshBar);
	const planEdges = useStableValue(planTree?.edges ?? null);
	const stepIdsKey = stepBar ? stepBar.steps.map((s) => s.id).join("\n") : "";
	const stepNumbers = useMemo(() => new Map(stepBar?.steps.map((s, i) => [s.id, i + 1]) ?? []), [stepIdsKey]);
	// Problem numbers (and practice's plan row blocks).
	const practice = useMemo(() => (kind === "teach" ? null : practiceProgress(messages, activeProblem !== null)), [kind, messages, activeProblem]);
	const stablePractice = useStableValue(practice);
	// Each Study topic's page mark; stable while none changed.
	const firstTopic = planTree?.nodes[0]?.id ?? null;
	const freshPageMarks = useMemo(() => (kind === "study" ? topicPageMarks(topicParts(nativeMessages, firstTopic)) : NO_PAGES), [kind, nativeMessages, firstTopic]);
	const pageMarks = useStableValue(freshPageMarks, JSON.stringify([...freshPageMarks]));
	const lessonStop = useLessonStop({
		nativeMessages,
		kind,
		tree: planTree,
		problems: problems?.problems ?? null,
		deadlineId,
		keepGoing,
		scopeRef: sessionFindScopeRef,
		scrollContextRef,
	});

	// Scroll the lesson to a card in it.
	const scrollToCard = useCallback((selector: string) => {
		const el = sessionFindScopeRef.current?.querySelector(selector);
		if (!el) return;
		scrollContextRef.current?.stopScroll();
		el.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
	}, []);
	// Click a done step: scroll back to its first answered question.
	const jumpToAnswer = useCallback((toolCallId: string) => scrollToCard(answerAnchorSelector(toolCallId)), [scrollToCard]);

	// The demo's error report follows the writing box's rules: never past a
	// waiting question, and a running turn is steered.
	const chatActions = useMemo(
		() => ({
			chatId,
			sendBlocked,
			sendText: (t: string) => {
				if (sendBlocked !== null) return;
				if (busyRef.current) void steer(t);
				else void send({ type: "text", text: t });
			},
			dropKept,
			openProblem: activeProblem?.toolCallId ?? null,
		}),
		[chatId, send, steer, sendBlocked, dropKept, activeProblem?.toolCallId],
	);

	// The error notice's Try again: send again what didn't go through, run a
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

	const sheet = useSheetDock(chatId, deadlineId);
	// A plugin's window lies over the page; opening the cheat sheet closes it. It and the
	// Teacher's window are both made of the bar and hang over the same corner, so one shows at a time.
	const { plugins: lessonPlugins } = usePluginsAt("lesson");
	const { spaces } = useSpaces();
	const [pluginId, setPluginId] = useState<string | null>(null);
	const openPlugin = lessonPlugins?.find((p) => p.id === pluginId) ?? null;
	const sheetOpen = !!spaceId && sheet.state.open;
	const toggleSheet = () => {
		setPluginId(null);
		sheet.update({ open: !sheetOpen });
	};
	const togglePlugin = (id: string) => {
		setPluginId(pluginId === id ? null : id);
		if (pluginId !== id && teacher?.panelOpen) teacher.setPanelOpen(false);
	};
	const closePlugin = useCallback(() => setPluginId(null), []);
	const teacherOpen = !!teacher?.panelOpen;
	useEffect(() => {
		if (teacherOpen) setPluginId(null);
	}, [teacherOpen]);
	const space = spaces.find((s) => s.id === spaceId);
	const pluginContext = useMemo(
		() => lessonPluginContext({ space: space ? { id: space.id, name: space.name } : null, title: rename.title, messages, pending, requiresReveal }),
		[space, rename.title, messages, pending, requiresReveal],
	);

	// The go-ahead waits for the learner at the foot of the lesson text, unless a stop card is up.
	const goLabel = goAheadLabel({ kind, homework: problems !== null, startLabel: startLabel ?? null, teacherSpoke, posedAny, pending: pending !== null, problem: activeProblem !== null, busy, error: error !== null, stop: lessonStop.card !== null });
	const goAhead = goLabel ? { label: goLabel, onGo: () => void send({ type: "next" }) } : null;
	const stuckLine = stuck && stuckMinutes !== null ? { minutes: stuckMinutes, label: stuck.type === "text" ? "Stop and send again?" : "Stop and try again?", onStop: stopAndRetry } : null;
	const errorLine = error && { text: lessonError(error.message).text, detail: error.message, onRetry: retry };
	const problem = activeProblem && {
		toolCallId: activeProblem.toolCallId,
		statement: (activeProblem.input as { statement: string }).statement,
		line: !openProblem && practice ? `Problem ${practice.blocks.length}` : null,
		part: openProblem ? (problems?.part ?? null) : null,
		file: openProblem && homework?.assignment ? { ...homework.assignment, page: openProblem.page } : null,
	};

	const turnShown = yourTurnShown({ pending: pending !== null, problem: problem !== null, stop: lessonStop.card !== null, stuck: stuckLine !== null, error: errorLine !== null, reviewRefused });

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<SessionMermaidContext.Provider value={mermaidActions}>
				<JobsContext.Provider value={jobs}>
					<LessonStepsContext.Provider value={stepNumbers}>
						<div className="@container/lesson flex h-full min-w-0 flex-1 flex-col">
							<LessonBar
								chatId={chatId}
								rename={rename}
								spaceId={spaceId}
								sheet={spaceId ? { open: sheetOpen, onToggle: toggleSheet } : undefined}
								plugins={{ words: lessonPlugins ?? [], open: openPlugin?.id ?? null, onToggle: togglePlugin }}
								stats={<StatsBar turns={turns} contextTokens={contextTokens} summarizeAt={SUMMARIZE_AT} pricing={pricing} />}
								scopeRef={sessionFindScopeRef}
								scrollContextRef={scrollContextRef}
							/>
							<PluginWindow plugin={openPlugin} context={pluginContext} onClose={closePlugin} />
							<div className="min-h-0 flex-1">
								<LessonWorkFrame chatId={chatId}>
									<div ref={sessionFindScopeRef} data-dock={sheetOpen ? "" : undefined} className="lh-dots lh-lesson-body relative h-full">
										<LessonScroll
											steps={<PlanRow kind={kind} spaceId={spaceId} stepBar={stepBar} edges={planEdges} stop={lessonStop.stop} homework={planHomework} practice={stablePractice} onJump={jumpToAnswer} onPick={openPick} onOpenPlan={openPlan} />}
											restKey={[pending?.toolCallId, problem?.toolCallId, problem?.part, lessonStop.card?.key].join(" ")}
											busy={busy}
											contextRef={scrollContextRef}
											reading={
												<Pane data-testid="lesson-reading" className="min-w-0">
													<ReadingPane
														spaceId={spaceId}
														title={rename.title}
														assignment={homework?.assignment ?? null}
														messages={messages}
														phases={phases}
														status={status}
														busy={busy}
														waitingForAgent={waitingForAgent}
														onStop={lessonStop.card ? null : abortInFlightTurn}
														onStartAgain={error ? null : () => void send({ type: "continue" })}
														goAhead={goAhead}
														queuedSteers={visibleQueuedSteers(steerQueue, nativeMessages)}
														arrivalsLive={arrivalsLive}
														pageMarks={pageMarks}
														arrive={arrive}
														onOpenPlan={openPlan}
													/>
												</Pane>
											}
											turn={
												turnShown ? (
													<TurnSheet
														// Remounts once the saved drafts are read, so the question starts from them.
														key={draftsLoaded ? "drafts" : "loading"}
														spaceId={spaceId}
														pending={pending}
														requiresReveal={requiresReveal}
														onReveal={revealCheck}
														initialQuestionDraft={pendingQuestionId ? drafts.draft?.questions[pendingQuestionId]?.form : undefined}
														onSaveQuestionDraft={(form) => {
															if (pendingQuestionId) saveQuestion(pendingQuestionId, { form });
														}}
														onSubmitAnswer={onSubmitAnswer}
														onSkipQuestion={() => setAbortAsk("question")}
														reviewRefused={reviewRefused}
														problem={problem}
														onDiscardProblem={() => setAbortAsk("problem")}
														stop={lessonStop.card}
														busy={busy}
														boxRef={workBoxRef}
														value={text}
														onChange={editText}
														onSend={onSend}
														onHelpLine={(line) => void sendLine(line, [])}
														attachments={attachments}
														questionRef={questionRef}
														stuck={stuckLine}
														error={errorLine}
													/>
												) : null
											}
										/>
										{spaceId && sheetOpen && (
											<div className="flex min-h-0 pt-(--lh-gap) pr-(--lh-page-side) pb-(--lh-gap) [grid-area:dock]">
												<SheetDock
													spaceId={spaceId}
													sessionDeadlineId={deadlineId}
													picked={sheet.state.deadlineId}
													onPick={(id) => sheet.update({ deadlineId: id })}
													onClose={() => sheet.update({ open: false })}
												/>
											</div>
										)}

										{/* The session-scoped focuses: absolute over the lesson area, below
										    the lesson's bar; each fades out through usePresence. */}
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
										<AbortTurnDialog mode={abortAsk} onClose={() => setAbortAsk(null)} onConfirm={confirmAbort} busy={busy && pending?.appPosed?.kind !== "review"} />
									</div>
								</LessonWorkFrame>
							</div>
						</div>
					</LessonStepsContext.Provider>
				</JobsContext.Provider>
			</SessionMermaidContext.Provider>
		</ChatActionsContext.Provider>
	);
}

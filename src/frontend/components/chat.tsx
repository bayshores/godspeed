import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StickToBottomContext } from "use-stick-to-bottom";
import { useChatSession } from "@/frontend/components/session";
import { visibleQueuedSteers } from "@/frontend/components/session-core";
import { prefersReducedMotion, usePresence } from "@/frontend/components/presence";
import { JobsContext } from "@/frontend/components/jobs-context";
import { cn } from "@/frontend/lib/utils";
import { ChatActionsContext } from "@/frontend/components/chat-actions-context";
import { latestTree } from "@/frontend/components/plan-latest";
import { SessionMermaidContext } from "@/frontend/components/session-overlay";
import { currentUserThinkingOpen, setAllUserThinkingOpen } from "@/frontend/components/thinking-block";
import {
	activeProblemOf,
	answerTakesFiles,
	emptyDockSelection,
	findPendingToolCall,
	firstPhase,
	lessonProblems,
	kbdEventForAction,
	phaseTimeline,
	planStepBar,
	problemChoicesOf,
	problemPieceOf,
	problemStatementOf,
	topicParts,
	type LessonDocuments,
	type LessonProblemList,
	type LessonKind,
	type LhMessage,
	type PlanTree,
	type ChatAttachment,
	type DockSelection,
	type QuestionAnswerData,
	type JobRecord,
	type ReviewQuestion,
	withOpenReview,
} from "@/shared/core";
import { problemMessage } from "@/frontend/components/lesson/problem-choices-model";
import { goAheadLabel, initialPromptOwed, problemPosed, restoreUnsent, sendBlockedReason } from "@/frontend/components/lesson/chat-helpers";
import { holdsDraft } from "@/frontend/components/lesson/lesson-drafts-model";
import { lessonError, retryAction } from "@/frontend/components/lesson/lesson-error-model";
import { useLessonDrafts } from "@/frontend/components/lesson/use-lesson-drafts";
import { useArrivals } from "@/frontend/components/lesson/arrivals";
import { useSheetGlide } from "@/frontend/components/use-sheet-glide";
import { answerAnchorSelector } from "@/frontend/components/lesson/card-anchors";
import { practiceProgress } from "@/frontend/components/lesson/practice-progress";
import { useLessonServer, type LessonStats } from "@/frontend/components/lesson/use-lesson-server";
import { useTitleRename } from "@/frontend/components/lesson/use-title-rename";
import { useLessonStop } from "@/frontend/components/lesson/use-lesson-stop";
import { useFromEarlier } from "@/frontend/components/lesson/use-from-earlier";
import { LessonBar } from "@/frontend/components/lesson/lesson-bar";
import { PlanRow } from "@/frontend/components/lesson/plan-row";
import { LessonScroll } from "@/frontend/components/lesson/lesson-scroll";
import { problemStartLabel } from "@/frontend/components/lesson/plan-row-model";
import { messageShows } from "@/frontend/components/lesson/message-row";
import { ReadingPane } from "@/frontend/components/lesson/reading-pane";
import { useLessonWork } from "@/frontend/components/lesson/use-lesson-work";
import { topicPageMarks } from "@/frontend/components/citations/page-excerpt-model";
import { TurnSheet } from "@/frontend/components/lesson/turn-sheet";
import { useLessonNotes } from "@/frontend/components/vault/use-lesson-notes";
import { bookOpen, heldTask, turnNext, turnDrawn, type NextAction } from "@/frontend/components/lesson/turn-next-model";
import type { TurnPlace } from "@/frontend/components/lesson/turn-place";
import { useBook } from "@/frontend/components/lesson/use-book";
import { nothingWritten, titleEcho } from "@/frontend/components/lesson/wait-model";
import type { QuestionHandle } from "@/frontend/components/question-dock";
import { useAttachmentDraft } from "@/frontend/components/lesson/attachment-tray";
import { takeStartFiles } from "@/frontend/components/lesson/start-files";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { LessonOverlays, useLessonOverlays } from "@/frontend/components/lesson/lesson-overlays";
import { useLessonAbort } from "@/frontend/components/lesson/use-lesson-abort";
import { useTeacherLesson } from "@/frontend/components/teacher/teacher-provider";
import { SheetDock } from "@/frontend/components/cheat-sheet/sheet-dock";
import { useLessonDock } from "@/frontend/components/lesson/lesson-dock";
import { openPanel, type DockPanelKind } from "@/frontend/components/lesson/lesson-dock-model";
import { DocumentPanel } from "@/frontend/components/lesson/document-panel";
import { documentChoices, problemPlace, shownDocument } from "@/frontend/components/lesson/document-model";
import { useLessonDocuments } from "@/frontend/components/lesson/use-lesson-documents";
import { lessonPluginContext } from "@/frontend/components/lesson/lesson-plugins-model";
import { PluginWindow } from "@/frontend/components/lesson/plugin-window";
import { useSpaces } from "@/frontend/components/space-context";
import type { InstalledPlugin } from "@/frontend/lib/plugins-api";
import { usePluginsAt } from "@/frontend/lib/use-plugins-at";
import { useStableValue } from "@/frontend/lib/use-stable-value";

/** A lesson with no topic pages. */
const NO_PAGES: ReadonlyMap<string, string> = new Map();

/**
 * THE LESSON: its title and words in the top bar (LessonBar), then one page that scrolls (LessonScroll):
 * the step line, the lesson text and the learner's turn (what is asked over
 * the writing row, beside the text in a wide room), with the panel beside both
 * when one is open: the lesson's document or the cheat sheet. The learner
 * talks to the teacher in the writing row's field. This component owns the
 * lesson's state and wiring; the pieces live in src/frontend/components/lesson/.
 */

export function Chat({
	chatId,
	title,
	initialMessages,
	initialError,
	initialPrompt,
	initiallyInFlight,
	initialStats,
	initialJobs = null,
	initialWork,
	plugins: loadedPlugins,
	openedReview = null,
	kind = "teach",
	initialTree,
	spaceId,
	deadlineId,
	problemList,
	documents: loadedDocuments,
}: {
	chatId: string;
	title: string;
	/** The session's space and the deadline it was started from: the
	 *  cheat sheet beside it shows that deadline's sheet. */
	spaceId?: string;
	deadlineId?: string;
	initialMessages: LhMessage[];
	/** A homework lesson's or a lesson on files' problem list: its problems
	 *  fill the plan row. */
	problemList?: LessonProblemList;
	/** The files its Document panel shows, as the page's loader read them (null: the read failed). */
	documents?: LessonDocuments | null;
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
	/** The stats row's figures from the route's read of the record. */
	initialStats: LessonStats;
	/** The lesson's jobs as the page's loader read them (null: the read failed). */
	initialJobs?: JobRecord[] | null;
	/** What the teacher does in a running turn, as the page's loader read it (null: the read failed). */
	initialWork?: unknown;
	/** The installed plugins as the page's loader read them (null: the read failed). */
	plugins?: InstalledPlugin[] | null;
	/** The question from earlier the page's loader was served, if one shows now. */
	openedReview?: ReviewQuestion | null;
}) {
	// THE SESSION HOOK: the record is native history; the view is derived
	// client-side (core/view.ts projectView).
	const session = useChatSession({ chatId, initialMessages, initialError, initiallyInFlight });
	const { messages, nativeMessages, contextTokens, send, continueIfOwed, steer, steerQueue, submitAnswer, keepGoing, dropKept, status, error, clearError, resumeStream } = session;
	const { turnInFlight, jobs, turns, pricing, summarizeAt, adoptAppendOnly } = useLessonServer({
		chatId,
		session,
		initiallyInFlight: initiallyInFlight ?? false,
		initialStats,
		initialJobs,
	});
	const rename = useTitleRename(chatId, title);

	const sessionFindScopeRef = useRef<HTMLDivElement | null>(null);
	const scrollContextRef = useRef<StickToBottomContext | null>(null);
	// A lesson that sends its first message as it opens draws that turn's desk at rest, as part of
	// its opening: arrivals start once the desk is up, or the send has failed.
	const [opened, setOpened] = useState(() => !(initialPromptOwed(initialMessages, initialPrompt) && new URLSearchParams(window.location.search).has("prompt")));
	const arrive = useArrivals(opened);
	const [arrivalsLive, setArrivalsLive] = useState(false);
	useEffect(() => setArrivalsLive(opened), [opened]);

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

	// A turn runs: this view's own, or one the app started (a catch-up).
	const busy = status === "submitted" || status === "streaming" || turnInFlight;
	const teacher = useTeacher();
	const work = useLessonWork(chatId, initialWork);
	const busyRef = useRef(busy);
	busyRef.current = busy;

	// Questions from earlier fill a Study lesson's wait for its teacher. The
	// open one shows before the teacher's own question.
	const { question: reviewQuestion, answer: answerReview, skip: skipReview, refused: reviewRefused } = useFromEarlier({
		chatId,
		opened: openedReview,
		waiting: kind === "study" && busy,
		open: teacherPending !== null || activeProblem !== null,
		busy,
		onAnswered: adoptAppendOnly,
	});
	const pending = useMemo(() => findPendingToolCall(withOpenReview(messages, reviewQuestion)), [messages, reviewQuestion]);
	const pendingRef = useRef(pending);
	pendingRef.current = pending;

	const overlays = useLessonOverlays();
	const { abortInFlightTurn, abortAsk, setAbortAsk, confirmAbort } = useLessonAbort({
		chatId,
		session,
		pendingRef,
		activeProblemRef,
		busyRef,
		focusOpen: overlays.focusOpen,
		closeMermaid: overlays.closeMermaid,
		skipReview,
	});

	// The phase at every message (the teach seam).
	const phases = useMemo(() => phaseTimeline(messages, firstPhase(kind)), [messages, kind]);

	const pendingQuestionId = pending?.toolCallId ?? null;

	// ⌘T: set every "your thinking" row in the lesson to one state.
	useEffect(() => {
		const onToggle = () => setAllUserThinkingOpen(!currentUserThinkingOpen());
		window.addEventListener(kbdEventForAction("toggle-user-thinking"), onToggle);
		return () => window.removeEventListener(kbdEventForAction("toggle-user-thinking"), onToggle);
	}, []);

	// ── the answer box ──
	const [text, setText] = useState(drafts.draft.composer);
	const textRef = useRef(text);
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

	// Follow never takes the window away from unsent text.
	const draftHeld = holdsDraft(drafts.draft, pendingQuestionId ?? activeProblem?.toolCallId ?? null);
	// The teacher's status in a lesson: Talking while it writes, Thinking
	// while the turn runs.
	useTeacherLesson(busy, draftHeld);
	const attachments = useAttachmentDraft(chatId);

	// A line sent to the teacher while it writes STEERS the reply (text
	// only). Under a waiting question it is a side question, never while
	// the teacher replies. An open problem is worked on in the box: plain
	// messages.
	const sideOpen = pending !== null;
	const questionRef = useRef<QuestionHandle>(null);
	const sendBlocked = sendBlockedReason(sideOpen);

	// The lesson's problems: its list plus this lesson's posts and done marks. A lesson on files
	// with none listed is a plan lesson.
	const freshProblems = useMemo(() => {
		if (kind !== "homework" && !problemList) return null;
		const folded = lessonProblems(problemList?.problems ?? [], messages);
		return kind === "homework" || folded.problems.length > 0 ? folded : null;
	}, [kind, problemList, messages]);
	const problems = useStableValue(freshProblems);
	const startLabel = problems && problemStartLabel(problems.problems);
	const unwritten = useMemo(() => nothingWritten(messages), [messages]);
	// A reply saved with nothing in it (stopped before it began) is not the teacher speaking.
	const teacherSpoke = useMemo(() => !unwritten && nativeMessages.some((m) => (m as { role?: string }).role === "assistant"), [unwritten, nativeMessages]);
	const posedAny = useMemo(() => problemPosed(nativeMessages), [nativeMessages]);

	// A pick from the lesson's problem list. Why none can open yet: the
	// lesson's own words for a reply under way, or the question waiting.
	const openBlocked = busy ? "The teacher is writing." : pending ? "Answer the question first." : null;
	const workBoxRef = useRef<{ focus(): void }>(null);
	const openPick = useCallback(
		(number: string | null) => {
			if (number === null) workBoxRef.current?.focus();
			else if (openBlocked === null) void send({ type: "open", number });
		},
		[openBlocked, send],
	);

	// What is picked among the open problem's choices, kept like the box's text.
	const problemId = activeProblem?.toolCallId ?? null;
	const problemChoices = useMemo(() => (activeProblem ? problemChoicesOf(activeProblem.input) : null), [activeProblem]);
	const problemPicked = (problemId && drafts.draft.questions[problemId]?.form?.selection) || emptyDockSelection();
	const pickProblem = (selection: DockSelection) => {
		if (problemId) saveQuestion(problemId, { form: { selection } });
	};

	/* A LINE FOR THE TEACHER: while a turn runs (ours or a wake) it steers
	 * it; idle it is the learner's next message (a raced settle 409s and
	 * falls back to exactly that). Under a waiting question it is a side
	 * question; about the opener or a question from earlier, it leaves that
	 * open too. False when the lesson can't take it now. */
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

	// What the box holds, sent as a line: a problem's work goes with its
	// picks. A line the lesson can't take is put back.
	const sendBox = () => {
		const t = textRef.current.trim();
		const picked = pending ? emptyDockSelection() : problemPicked;
		const files = attachments.files;
		const line = problemMessage(picked.selected, t);
		if (!line && files.length === 0) return;
		editText("");
		if (!pending) pickProblem(emptyDockSelection());
		attachments.clear();
		void sendLine(line, files.map((f) => f.attachment)).then((sent) => {
			if (sent) return;
			editText(restoreUnsent(t, textRef.current));
			if (!pending) pickProblem(picked);
			attachments.restore(files);
		});
	};

	// THE ANSWER IS THE QUESTION CALL'S TOOL RESULT: one input event, one
	// turn. The box's files ride along for an answer that takes them. The
	// box empties; a refused answer puts its text and files back.
	const onSubmitAnswer = (answer: QuestionAnswerData) => {
		if (!pending) return;
		const typed = textRef.current;
		const files = answerTakesFiles(pending.tool) ? attachments.files : [];
		editText("");
		if (files.length > 0) attachments.clear();
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

	// ── the plan row's data ──
	const planTree = useMemo(() => latestTree(messages) ?? initialTree ?? null, [messages, initialTree]);
	const freshBar = useMemo(() => (kind === "practice" || kind === "homework" ? null : planStepBar(planTree, messages)), [kind, planTree, messages]);
	const openProblem = problems?.open ? problems.problems.find((p) => p.number === problems.open) : undefined;
	const planProblems = useMemo(() => (problems ? { problems: problems.problems, open: problems.open, blocked: openBlocked } : null), [problems, openBlocked]);
	// Stable while nothing in it changed, so streaming never redraws the bar.
	const stepBar = useStableValue(freshBar);
	const planEdges = useStableValue(planTree?.edges ?? null);
	const stepIdsKey = stepBar ? stepBar.steps.map((s) => s.id).join("\n") : "";
	const stepNumbers = useMemo(() => new Map(stepBar?.steps.map((s, i) => [s.id, i + 1]) ?? []), [stepIdsKey]);
	const stepNames = useMemo(() => new Map(stepBar?.steps.map((s) => [s.id, s.title]) ?? []), [stepBar]);
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

	// The error notice's Try again: send again what didn't go through, run a
	// failed reply again, or read the lesson again (and attach to a running reply).
	const retry = () => {
		if (!error) return;
		const action = retryAction(lessonError(error.message).kind, { boxHasText: textRef.current.trim().length > 0 });
		if (action.type === "send-box") sendBox();
		else if (action.type === "continue") void send({ type: "continue" });
		else {
			clearError();
			resumeStream();
		}
	};
	// The panel beside the lesson: its document (a lesson built on files with a PDF) or the cheat sheet (a lesson in a space).
	const lessonDock = useLessonDock(chatId, deadlineId);
	const { documents: docView, reload: reloadDocuments } = useLessonDocuments(chatId, loadedDocuments);
	const documents = docView?.documents ?? null;
	const shownDoc = shownDocument(documents ?? [], lessonDock.state.fileId);
	const docChoices = documentChoices(documents ?? []);
	// A remembered Document panel whose files all left the space closes.
	const docGone = documents !== null && shownDoc === null && lessonDock.state.panel === "document";
	const { update: updateDock } = lessonDock;
	useEffect(() => {
		if (docGone) updateDock({ panel: null });
	}, [docGone, updateDock]);
	// A plugin's window lies over the page; opening a panel closes it. It and the
	// Teacher's window are both made of the bar and hang over the same corner, so one shows at a time.
	const { plugins: lessonPlugins } = usePluginsAt("lesson", loadedPlugins);
	const { spaces } = useSpaces();
	const [pluginId, setPluginId] = useState<string | null>(null);
	const openPlugin = lessonPlugins?.find((p) => p.id === pluginId) ?? null;
	const panel = openPanel(lessonDock.state.panel, { sheet: !!spaceId, document: shownDoc !== null });
	// The panel stays mounted through its fade-out; the grid still follows `panel`.
	const dock = usePresence(panel !== null);
	// A panel left open is just there when the lesson shows; one opened later fades in.
	const [dockThere, setDockThere] = useState(panel !== null);
	if (dockThere && panel === null) setDockThere(false);
	const lastPanel = useRef(panel);
	if (panel) lastPanel.current = panel;
	const togglePanel = (kind: DockPanelKind) => {
		setPluginId(null);
		updateDock({ panel: panel === kind ? null : kind });
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
		() => lessonPluginContext({ space: space ? { id: space.id, name: space.name } : null, title: rename.title, messages, pending }),
		[space, rename.title, messages, pending],
	);

	// With nothing to answer, "Your turn" says what is next and holds the one key that goes on.
	const { atStop } = lessonStop;
	const goLabel = goAheadLabel({ kind, problemList: problems !== null, startLabel: startLabel ?? null, teacherSpoke, posedAny });
	const lessonNotes = useLessonNotes(chatId, atStop?.kind === "end");
	const next = turnNext({ stop: atStop, problemList: problems !== null, goLabel, busy, error: error !== null, nothingWritten: unwritten, notes: lessonNotes.notes, obsidian: lessonNotes.obsidian });
	const onNext = (action: NextAction) => {
		if (action === "keep-going") {
			if (atStop) keepGoing(atStop.stopOf);
		} else if (action === "done-for-today") lessonStop.doneForToday();
		else void send({ type: action === "start-again" ? "continue" : "next" });
	};
	const errorLine = error && { text: lessonError(error.message).text, detail: error.message, onRetry: retry };
	const problemPiece = useMemo(() => (activeProblem ? problemPieceOf(activeProblem.details) : null), [activeProblem]);
	const listFileId = docView?.listFileId ?? null;
	const place = useStableValue(activeProblem ? problemPlace(problemPiece?.piece ?? null, openProblem?.page, listFileId) : null);
	const problem = activeProblem && {
		toolCallId: activeProblem.toolCallId,
		statement: problemStatementOf(activeProblem.input, activeProblem.details),
		piece: problemPiece,
		choices: problemChoices,
		line: !openProblem && practice ? `Problem ${practice.blocks.length}` : null,
		part: openProblem ? (problems?.part ?? null) : null,
		sent: activeProblem.sent,
	};

	// The task he last finished stays beside the text until the lesson goes on from it.
	const held = useMemo(() => heldTask(nativeMessages, messages, { busy, goOn: next?.key != null || error !== null }), [nativeMessages, messages, busy, next?.key, error]);
	const heldTurn = useMemo(
		() =>
			held &&
			(held.kind === "question"
				? held
				: {
						kind: held.kind,
						toolCallId: held.toolCallId,
						statement: problemStatementOf(held.input, held.details),
						piece: problemPieceOf(held.details),
						line: problems === null && practice ? `Problem ${practice.finished + (held.discarded ? 1 : 0)}` : null,
						discarded: held.discarded,
					}),
		[held, problems, practice],
	);
	const opens = bookOpen({ question: pending ? (pending.appPosed?.kind === "review" ? "review" : "teacher") : null, problem: problem !== null, held: held !== null });
	// The desk in the lesson text, also while it leaves: the book waits for it. Whether it lays the page it reads there.
	const [deskUp, setDeskUp] = useState(false);
	const [deskPage, setDeskPage] = useState(false);
	const onDesk = useCallback((up: boolean, page: boolean) => {
		setDeskUp(up);
		setDeskPage(page);
	}, []);
	useEffect(() => {
		if (deskUp || error !== null) setOpened(true);
	}, [deskUp, error]);
	const book = useBook(opens, heldTurn, busy, deskUp);
	const { open } = book;
	const sheetGlide = useSheetGlide(book.turning);
	// While it is shut and the teacher works, a task that streams in waits for the reply to land.
	const turnPending = open || pending?.appPosed?.kind === "review" ? pending : null;
	const turnProblem = open ? problem : null;
	// The open problem shows on the page, unless a question asked while it is open stands in its place.
	const problemShown = turnProblem !== null && turnPending === null;
	// Where the page last laid "Your turn" out: only beside the text or alone does it keep the finished task,
	// and the lesson's notes take its place there when they come.
	const [turnPlace, setTurnPlace] = useState<TurnPlace>("under");
	const kept = !turnPending && !turnProblem && !next?.notes && (turnPlace === "beside" || turnPlace === "alone") ? book.held : null;
	const inTurn = activeProblem?.toolCallId ?? kept?.toolCallId ?? null;
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
			inTurn,
		}),
		[chatId, send, steer, sendBlocked, dropKept, inTurn],
	);


	const turnShows = turnDrawn({
		started: teacherSpoke || busy,
		holds: pending !== null || problem !== null || next?.key != null || errorLine !== null || reviewRefused,
	});

	const stoppedEmpty = unwritten && !busy && error === null;
	const echo = useMemo(() => titleEcho(messages, rename.title), [messages, rename.title]);
	// With "Your turn" up and nothing drawn in the lesson text (a lesson that opens with a problem), its sheet is left out.
	const textShows = useMemo(
		() => busy || stoppedEmpty || messages.length === 0 || messages.some((m, i) => messageShows(m, i === echo, inTurn)),
		[busy, stoppedEmpty, messages, echo, inTurn],
	);

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<SessionMermaidContext.Provider value={overlays.mermaidActions}>
				<JobsContext.Provider value={jobs}>
					<div className="@container/lesson flex h-full min-w-0 flex-1 flex-col">
						<LessonBar
							chatId={chatId}
							rename={rename}
							spaceId={spaceId}
							doc={shownDoc ? { open: panel === "document", onToggle: () => togglePanel("document") } : undefined}
							sheet={spaceId ? { open: panel === "sheet", onToggle: () => togglePanel("sheet") } : undefined}
							plugins={{ words: lessonPlugins ?? [], open: openPlugin?.id ?? null, onToggle: togglePlugin }}
							usage={{ turns, contextTokens, summarizeAt, pricing }}
							scopeRef={sessionFindScopeRef}
							scrollContextRef={scrollContextRef}
							exit={
								turnPending
									? { label: "Skip question", testId: "skip-question", onPick: () => setAbortAsk("question") }
									: turnProblem
										? { label: "Discard problem", testId: "discard-problem", onPick: () => setAbortAsk("problem") }
										: null
							}
						/>
						<PluginWindow plugin={openPlugin} context={pluginContext} onClose={closePlugin} />
						<div className="min-h-0 flex-1">
							<div ref={sessionFindScopeRef} data-dock={panel ? "" : undefined} className="lh-lesson-body relative h-full">
								<LessonScroll
									steps={<PlanRow kind={kind} spaceId={spaceId} stepBar={stepBar} edges={planEdges} stop={lessonStop.stop} problemList={planProblems} practice={stablePractice} onJump={jumpToAnswer} onPick={openPick} onOpenPlan={overlays.openPlan} />}
									restKey={[pending?.toolCallId, problem?.toolCallId, problem?.part, atStop?.stopOf].join(" ")}
									busy={busy}
									contextRef={scrollContextRef}
									open={open}
									shutting={book.shutting}
									onShut={book.shut}
									onRest={book.rest}
									pin={problemShown}
									room={deskPage}
									place={turnPlace}
									onPlace={setTurnPlace}
									reading={
										turnShows && !textShows ? null : (
										<ReadingPane
											spaceId={spaceId}
											stepNumbers={stepNumbers}
											stepNames={stepNames}
											echo={echo}
											messages={messages}
											phases={phases}
											status={status}
											busy={busy}
											stoppedEmpty={stoppedEmpty}
											work={work}
											problemSheet={problemShown}
											queuedSteers={visibleQueuedSteers(steerQueue, nativeMessages)}
											arrivalsLive={arrivalsLive}
											pageMarks={pageMarks}
											arrive={arrive}
											onDesk={onDesk}
											sheetRef={sheetGlide}
										/>
										)
									}
									turn={
										turnShows ? (
											<TurnSheet
												sheetRef={sheetGlide}
												spaceId={spaceId}
												pending={turnPending}
												initialQuestionDraft={pendingQuestionId ? drafts.draft.questions[pendingQuestionId]?.form : undefined}
												onSaveQuestionDraft={(form) => {
													if (pendingQuestionId) saveQuestion(pendingQuestionId, { form });
												}}
												onSubmitAnswer={onSubmitAnswer}
												onSkipQuestion={() => setAbortAsk("question")}
												reviewRefused={reviewRefused}
												problem={turnProblem}
												problemPicked={problemPicked}
												onPickProblem={pickProblem}
												next={book.shutting ? null : next}
												kept={kept}
												onNext={onNext}
												busy={busy}
												onStop={busy ? abortInFlightTurn : null}
												boxRef={workBoxRef}
												value={text}
												onChange={editText}
												onSend={sendBox}
												onHelpLine={(line) => void sendLine(line, [])}
												attachments={attachments}
												questionRef={questionRef}
												error={errorLine}
												onAnswerAsk={(topicId, reply) => void lessonNotes.answer(topicId, reply).then((saved) => saved && editText(""))}
												askError={lessonNotes.answering.error}
											/>
										) : null
									}
								/>
								{dock.mounted && (
									<div data-state={dock.state} className={cn("lh-lesson-dock-cell flex min-h-0 pt-(--lh-gap) pr-(--lh-page-side) pb-(--lh-gap)", !dockThere && "lh-fade")}>
										{lastPanel.current === "document" && shownDoc ? (
											<DocumentPanel
												choices={docChoices}
												shown={shownDoc}
												place={place}
												there={dockThere}
												onPick={(id) => updateDock({ fileId: id })}
												onRetry={() => void reloadDocuments()}
												onClose={() => updateDock({ panel: null })}
											/>
										) : lastPanel.current === "sheet" && spaceId ? (
											<SheetDock
												spaceId={spaceId}
												sessionDeadlineId={deadlineId}
												picked={lessonDock.state.deadlineId}
												onPick={(id) => updateDock({ deadlineId: id })}
												onClose={() => updateDock({ panel: null })}
											/>
										) : null}
									</div>
								)}

								<LessonOverlays
									overlays={overlays}
									planTree={planTree}
									messages={messages}
									abort={{ mode: abortAsk, onClose: () => setAbortAsk(null), onConfirm: confirmAbort, busy: busy && pending?.appPosed?.kind !== "review" }}
								/>
							</div>
						</div>
					</div>
				</JobsContext.Provider>
			</SessionMermaidContext.Provider>
		</ChatActionsContext.Provider>
	);
}

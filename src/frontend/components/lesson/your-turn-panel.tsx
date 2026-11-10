import { useEffect, useRef, useState } from "react";
import { LightbulbIcon } from "lucide-react";
import { NoAgentLine } from "@/frontend/components/agent-folder/no-agent-line";
import { PracticeDock } from "@/frontend/components/practice-dock";
import { QuestionDock, type QuestionDockProps } from "@/frontend/components/question-dock";
import { ReadingThinkingField } from "@/frontend/components/reading-thinking";
import { normalizeQuizType, questionKindLabel, type ChatAttachment, type findPendingToolCall, type QuestionAnswerData, type QuestionFormDraft } from "@/shared/core";
import { ActionBar, HeaderChip, KindChip, PanelBody, PanelHeader, skipExit } from "./panel-parts";
import { TurnStatus } from "./turn-status";
import { ResizeHandle, usePaneWidth } from "@/frontend/components/ui/resize-handle";
import { Pane } from "@/frontend/components/ui/pane";

type Pending = NonNullable<ReturnType<typeof findPendingToolCall>>;

/** The panel's width beside the reading pane (drag its border line). */
const PANEL_WIDTH = { initial: 440, min: 340, max: 720 };
/** The reading pane never gets narrower than this beside the panel; with
 *  less room (a docked cheat sheet, a small window) the panel goes below
 *  the text instead. Matches the 760px container breakpoints below. */
const READING_MIN = 420;

/** The panel's shown width: the saved width, narrowed so the reading pane
 *  keeps READING_MIN of the lesson area's `room`. */
export function fitPanelWidth(width: number, room: number | null): number {
	if (room === null) return width;
	return Math.min(width, Math.max(PANEL_WIDTH.min, room - READING_MIN));
}

/**
 * THE YOUR-TURN PANEL: the lesson's right column (440px), below the text
 * in narrow windows: the plan's steps pane on top, then the "your turn"
 * pane (lit while a question or problem waits), which holds one of:
 * - a teach-phase check waiting behind "Check your understanding" (the
 *   learner reads first, can note thoughts while reading, then opens it);
 * - a waiting question (QuestionDock);
 * - an active practice problem (PracticeDock);
 * - otherwise nothing to answer, with Next problem / Continue in the pause
 *   between problems.
 * Messages, side questions included, go through the one box under the
 * reading pane (LessonBox). The lesson's stats row sits at the foot of
 * every state.
 */
export function YourTurnPanel({
	steps,
	pending,
	requiresReveal,
	initialQuestionDraft,
	onSaveQuestionDraft,
	onSubmitAnswer,
	onSkipQuestion,
	readingThinking,
	onReadingThinking,
	practice,
	initialPracticeDraft,
	onSavePracticeDraft,
	onSubmitThinking,
	onDiscardProblem,
	busy,
	waitingForAgent,
	onStop,
	next,
	onNext,
	compacting,
	stats,
	homeworkProblem,
}: {
	/** The steps pane, for a lesson with a plan. */
	steps?: React.ReactNode;
	pending: Pending | null;
	/** A teach-phase check: it waits behind the reveal invitation. */
	requiresReveal: boolean;
	initialQuestionDraft?: QuestionFormDraft;
	onSaveQuestionDraft: (draft: QuestionFormDraft) => void;
	onSubmitAnswer: (output: QuestionAnswerData, attachments: ChatAttachment[]) => Promise<boolean>;
	/** Opens the skip confirm for the waiting question. */
	onSkipQuestion: () => void;
	readingThinking: string;
	onReadingThinking: (v: string) => void;
	practice: { toolCallId: string; input: unknown } | null;
	initialPracticeDraft?: string;
	onSavePracticeDraft: (thinking: string) => void;
	onSubmitThinking: (text: string, attachments: ChatAttachment[]) => Promise<boolean>;
	/** Opens the discard confirm for the active problem. */
	onDiscardProblem: () => void;
	busy: boolean;
	/** The turn waits for an agent to take it. */
	waitingForAgent: boolean;
	/** The problem dock's Stop; absent when the lesson box holds it. */
	onStop?: () => void;
	/** The go-ahead in the pause between problems ("Next problem", or
	 *  "Continue" in a study session); absent outside that pause. */
	next?: string;
	onNext: () => void;
	compacting: boolean;
	stats: React.ReactNode;
	/** A homework lesson's open problem: its name and where it is in the assignment. */
	homeworkProblem?: { label: string; source: string | null };
}) {
	const [saved, setWidth] = usePaneWidth("your-turn", PANEL_WIDTH);
	const asideRef = useRef<HTMLElement>(null);
	const room = useParentWidth(asideRef);
	const width = fitPanelWidth(saved, room);
	// The reveal: false until the learner opens the check. Reset during
	// render when a new question lands — open at once only when it follows
	// another question (the reading already happened).
	const pendingId = pending?.toolCallId ?? null;
	const [revealed, setRevealed] = useState(false);
	const prevPendingIdRef = useRef(pendingId);
	if (pendingId !== prevPendingIdRef.current) {
		const wasQuestion = prevPendingIdRef.current !== null;
		prevPendingIdRef.current = pendingId;
		if (pendingId && requiresReveal) setRevealed(wasQuestion);
	}
	const revealPending = pending !== null && requiresReveal && !revealed;
	const revealRef = useRef(() => setRevealed(true));

	// Enter opens the waiting check from anywhere a typing surface or a
	// button doesn't own it.
	useEffect(() => {
		if (!revealPending) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Enter" || e.altKey) return;
			if (e.shiftKey && !e.metaKey && !e.ctrlKey) return;
			const t = e.target as HTMLElement | null;
			if (t && ((t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") || t.tagName === "TEXTAREA" || t.isContentEditable || t.closest("button"))) return;
			e.preventDefault();
			revealRef.current();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [revealPending]);

	const mode = revealPending ? `reveal:${pendingId}` : pending ? `question:${pendingId}` : practice ? `practice:${practice.toolCallId}` : "chat";
	// The opening state appears still; later states rise in.
	const initialModeRef = useRef(mode);
	const footer = (
		<div className="shrink-0 pt-3">
			<NoAgentLine className="pb-3" />
			{stats}
		</div>
	);

	let body: React.ReactNode;
	if (pending && revealPending) {
		const label = questionKindLabel(pending.tool, normalizeQuizType((pending.input as { type?: unknown } | null)?.type));
		body = (
			<div className="flex min-h-0 flex-1 flex-col">
				<PanelBody>
					<PanelHeader
						status={busy && <TurnStatus waitingForAgent={waitingForAgent} />}
						right={
							<HeaderChip exit={skipExit(onSkipQuestion)}>
								{label !== "Question" && (
									<KindChip>
										{label === "Prediction" && <LightbulbIcon aria-hidden className="size-3.5" />}
										{label}
									</KindChip>
								)}
							</HeaderChip>
						}
					/>
					<div className="mt-3 flex flex-1 flex-col">
						<ReadingThinkingField value={readingThinking} onChange={onReadingThinking} onOpen={() => revealRef.current()} />
					</div>
					{footer}
				</PanelBody>
				<ActionBar testId="teach-check-reveal" label="Check your understanding" onClick={() => revealRef.current()} />
			</div>
		);
	} else if (pending) {
		body = (
			<QuestionDock
				toolName={pending.tool as QuestionDockProps["toolName"]}
				toolCallId={pending.toolCallId}
				input={pending.input as never}
				onSubmit={onSubmitAnswer}
				initialDraft={initialQuestionDraft}
				onSaveDraft={onSaveQuestionDraft}
				onSkip={onSkipQuestion}
				compactionRunning={compacting}
				busy={busy}
				waitingForAgent={waitingForAgent}
				footer={footer}
			/>
		);
	} else if (practice) {
		body = (
			<PracticeDock
				problemCallId={practice.toolCallId}
				input={practice.input as { statement: string }}
				onSubmit={onSubmitThinking}
				initialDraft={initialPracticeDraft}
				onSaveDraft={onSavePracticeDraft}
				onDiscard={onDiscardProblem}
				onStop={onStop}
				busy={busy}
				waitingForAgent={waitingForAgent}
				compactionRunning={compacting}
				footer={footer}
				{...(homeworkProblem ? { source: homeworkProblem.source, sendLabel: "check my work" } : {})}
			/>
		);
	} else {
		body = (
			<div className="flex min-h-0 flex-1 flex-col">
				<PanelBody>
					<PanelHeader status={busy && <TurnStatus waitingForAgent={waitingForAgent} />} />
					{!busy && (
						<p data-testid="nothing-to-answer" className="text-base leading-6 text-ink-3">
							Nothing to answer right now.
						</p>
					)}
					<div className="flex-1" />
					{footer}
				</PanelBody>
				{next !== undefined && <ActionBar testId="next-problem-button" label={next} onClick={onNext} />}
			</div>
		);
	}

	return (
		<aside
			ref={asideRef}
			data-testid="your-turn-panel"
			aria-label="Your turn"
			data-mode={mode.split(":")[0]}
			className="relative flex min-h-0 w-full shrink-0 flex-col gap-4 @max-[759px]/lesson:max-h-[50dvh] @max-[759px]/lesson:min-h-[240px] @min-[760px]/lesson:w-(--lh-turn-w)"
			style={{ "--lh-turn-w": `${width}px` } as React.CSSProperties}
		>
			{/* Side by side only: stacked, the panel is full width. */}
			<div className="contents @max-[759px]/lesson:hidden">
				<ResizeHandle paneKey="your-turn" edge="left" width={width} bounds={PANEL_WIDTH} onWidth={setWidth} label="Resize the Your turn panel" />
			</div>
			{steps}
			<Pane name={practice && homeworkProblem ? `your turn: ${homeworkProblem.label.toLowerCase()}` : "your turn"} active={mode !== "chat"} className="flex min-h-0 flex-1 flex-col">
				<div key={mode} className={`flex min-h-0 flex-1 flex-col${mode === initialModeRef.current ? "" : " lh-rise"}`}>
					{body}
				</div>
			</Pane>
		</aside>
	);
}

/** The width of `ref`'s parent (the lesson area), kept current. */
function useParentWidth(ref: React.RefObject<HTMLElement | null>): number | null {
	const [width, setWidth] = useState<number | null>(null);
	useEffect(() => {
		const parent = ref.current?.parentElement;
		if (!parent) return;
		const ro = new ResizeObserver(() => setWidth(parent.clientWidth));
		ro.observe(parent);
		return () => ro.disconnect();
	}, [ref]);
	return width;
}

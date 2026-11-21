import { useContext, useState, type RefObject } from "react";
import { useEnterSubmits } from "@/frontend/components/enter-submits";
import { QuestionDock, type QuestionDockProps, type QuestionHandle } from "@/frontend/components/question-dock";
import { DEFAULT_TEACHER_NAME, DONT_KNOW, normalizeQuizType, questionKindLabel, type DockSelection, type findPendingToolCall, type ProblemChoices, type ProblemPieceText, type QuestionAnswerData, type QuestionFormDraft } from "@/shared/core";
import { useSettings } from "@/frontend/components/settings-context";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { cn } from "@/frontend/lib/utils";
import type { AttachmentDraft } from "./attachment-tray";
import { wordsOver } from "@/frontend/components/vault/note-pages-model";
import { EndNotes } from "./end-notes";
import { LessonBox } from "./lesson-box";
import { HELP_LINES, lessonBox, lessonIdeas, questionTurn, type BoxAction, type BoxView } from "./lesson-box-model";
import { OpenProblemPane, type ProblemPicks } from "./open-problem-pane";
import { ProblemFile, type ProblemFileRef } from "./problem-file";
import { TurnScroll } from "./turn-scroll";
import { TurnPinned } from "./turn-pinned";
import { TurnSwap } from "./turn-swap";
import { AnsweredTurn } from "./answered-turn";
import type { NextAction, TurnShown } from "./turn-next-model";

type Pending = NonNullable<ReturnType<typeof findPendingToolCall>>;

export interface YourTurnProps {
	pending: Pending | null;
	initialQuestionDraft?: QuestionFormDraft;
	onSaveQuestionDraft: (draft: QuestionFormDraft) => void;
	onSubmitAnswer: (output: QuestionAnswerData) => void;
	/** Opens the skip confirm for the waiting question. */
	onSkipQuestion: () => void;
	/** His answer to a question from earlier was refused: it was no longer due. */
	reviewRefused: boolean;
	/** The open problem, with its line ("Problem 2", practice only) and, for
	 *  a listed problem, the part the learner is on and the file it is from. */
	problem: { toolCallId: string; statement: string; piece: ProblemPieceText | null; choices: ProblemChoices | null; line: string | null; part: string | null; file: ProblemFileRef | null } | null;
	/** What is picked among the open problem's choices. */
	problemPicked: DockSelection;
	onPickProblem: (picked: DockSelection) => void;
	/** Opens the discard confirm for the open problem. */
	onDiscardProblem: () => void;
	/** The answer box, for the problem row to bring him back to his work. */
	boxRef: RefObject<{ focus(): void } | null>;
	/** With nothing to answer: what is next and its key, or what stays while the teacher writes. */
	shown: TurnShown;
	/** Changes when what waits changes: the part above the box swaps then. */
	swapKey: string;
	onNext: (action: NextAction) => void;
	busy: boolean;
	/** The answer box's text. */
	value: string;
	onChange: (v: string) => void;
	/** Sends what the box holds to the teacher: a question, or a problem's work. */
	onSend: () => void;
	/** Sends a "Stuck?" key's words, as a line typed in the box. */
	onHelpLine: (line: string) => void;
	attachments: AttachmentDraft;
	/** The waiting question, for the lesson to read what is picked so far. */
	questionRef: RefObject<QuestionHandle | null>;
	/** An agent took the turn and went quiet: stop it and run it again. */
	stuck: { minutes: number; label: string; onStop: () => void } | null;
	/** The last send or reply failed. */
	error: { text: string; detail: string; onRetry: () => void } | null;
	/** Answers the "My words" ask at the last topic: with words, or by skipping it. */
	onAnswerAsk: (topicId: string, reply: { words: string } | { skip: true }) => void;
	/** Why the last answer to the ask was refused. */
	askError: string | null;
}

const HELP_KEY = "lh-btn lh-btn-small";
const NO_SWITCHES: Readonly<Record<string, boolean>> = {};

const EXIT: Record<NonNullable<BoxView["exit"]>, { label: string; testId: string }> = {
	skip: { label: "Skip question", testId: "skip-question" },
	discard: { label: "Discard problem", testId: "discard-problem" },
};

/**
 * YOUR TURN, the sheet beside the lesson's text (or under it), there for the
 * whole lesson once it has started (turnDrawn). Above its box it holds one of:
 * - a waiting question (QuestionDock);
 * - the open problem;
 * - the next state: what is next and the one key that goes on (turnNext);
 * - while the teacher writes with nothing waiting, the question just
 *   answered (AnsweredTurn) or the last next line, dimmed (turnShown);
 * Its title is the problem's number when one is open ("Problem 3"), with the
 * way out of that state at the title row's end. The box at its foot is
 * there in every state and stays still while the rest swaps: the learner
 * answers in it, works in it and asks the teacher in it (lessonBox). Under
 * it one row of keys sends a line in one click: "Stuck?" with a question
 * or a problem waiting, "Try asking" with nothing waiting. Beside the lesson text
 * only the question or problem shrinks to fit the window, scrolling in its
 * own box (LessonScroll). Pinned at the window's foot under the text
 * (TurnPinned) it is only as tall as what the learner can do now: with
 * nothing to answer it has no title and the key that goes on ends the foot
 * row, and while the teacher works it is the box alone (the lesson text
 * shows the question just answered).
 */
export function YourTurn({
	pending,
	initialQuestionDraft,
	onSaveQuestionDraft,
	onSubmitAnswer,
	onSkipQuestion,
	reviewRefused,
	problem,
	problemPicked,
	onPickProblem,
	onDiscardProblem,
	boxRef,
	shown,
	swapKey,
	onNext,
	busy,
	value,
	onChange,
	onSend,
	onHelpLine,
	attachments,
	questionRef,
	stuck,
	error,
	onAnswerAsk,
	askError,
}: YourTurnProps) {
	// Whether the question above the box has an answer picked.
	const [picked, setPicked] = useState(false);
	// The open problem's page in the theme's ink, or on white as its file prints it.
	const [printed, setPrinted] = useState(false);
	// The problem whose page did not load: its words show, so there is no page to turn white.
	const [pieceFailed, setPieceFailed] = useState<string | null>(null);
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;

	const next = !pending && !problem && shown.kind === "next" ? shown : null;
	const nextKey = next?.next.key ?? null;
	const notes = next?.next.notes ?? null;
	const ask = notes?.ask ?? null;
	const over = ask ? wordsOver(value, ask.maxLength) : 0;
	const turn = pending
		? questionTurn(pending.tool, pending.input, picked, pending.appPosed?.kind)
		: problem
			? ({ kind: "problem", picked: problemPicked.selected.size > 0 } as const)
			: ask
				? ({ kind: "words", ready: value.trim().length > 0 && over <= 0, leave: nextKey?.label ?? null } as const)
				: ({ kind: "ask", nextKey: nextKey !== null } as const);
	const view = lessonBox({ teacher, busy, hasText: value.trim().length > 0, hasFiles: attachments.files.length > 0, turn });
	// Nothing waits: the foot row offers what any lesson can be asked for.
	const ideas = lessonIdeas(useSettings().record?.agent?.tools ?? NO_SWITCHES);

	const act = (action: BoxAction) => {
		if (action === "send") onSend();
		else if (action === "leave" && nextKey) onNext(nextKey.action);
		else if (action === "skip" && ask) onAnswerAsk(ask.topicId, { skip: true });
		else if (action === "save" && ask) onAnswerAsk(ask.topicId, { words: value.trim() });
		else questionRef.current?.submit();
	};
	const canAct = (action: BoxAction) => view.keys.some((k) => k.action === action && !k.disabled);
	// Enter away from the box submits the answer, never sends what is
	// typed; with nothing to answer it presses the next key.
	useEnterSubmits(() => {
		if (canAct("submit")) act("submit");
		else if (nextKey) onNext(nextKey.action);
	});

	const picks: ProblemPicks | null = problem?.choices
		? { choices: problem.choices, picked: problemPicked, onPick: onPickProblem, onLeaveRows: () => boxRef.current?.focus(), onEnter: canAct("send") ? onSend : null }
		: null;

	const exit = view.exit && EXIT[view.exit];
	const fileShown = pending ? null : (problem?.file ?? null);
	const onExit = view.exit === "skip" ? onSkipQuestion : onDiscardProblem;
	const fromEarlier = pending?.appPosed?.kind === "review";
	// The title says what waits, in the word its answered card will carry.
	const title = ask ? "My words" : fromEarlier ? "From earlier" : pending ? questionKindLabel(pending.tool, normalizeQuizType((pending.input as { type?: unknown } | null)?.type)) : (problem?.line ?? "Your turn");

	const mode = pending ? "question" : problem ? "practice" : shown.kind === "answered" ? "answered" : "next";
	// Pinned with nothing to answer: no title, the next key ends the foot row, and only a line saying what is next stands over the box.
	const quiet = useContext(TurnPinned) && !pending && !problem;
	const boxAlone = quiet && (busy || !next?.next.line);
	// With a "My words" ask, the key that ends the day sits in the box beside Skip and Save.
	const rowKey = ask === null && !quiet;
	const nextButton = nextKey && (
		<button type="button" data-testid="next-problem-button" data-action={nextKey.action} onClick={() => onNext(nextKey.action)} className="lh-btn lh-btn-main ml-auto shrink-0">
			{nextKey.label}
		</button>
	);

	return (
		// The lesson text's inset, so both sheets share their edges.
		<div data-testid="your-turn" data-mode={mode} className={cn("lh-reading flex min-h-0 flex-1 flex-col gap-7", quiet && "lh-turn-quiet")}>
			<TurnSwap swapKey={boxAlone ? "box" : swapKey}>
			{boxAlone ? null : (
			<>
			{!quiet && (
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<h2 className="text-[28px] leading-tight text-ink">{title}</h2>
				{/* The keys stay on the title's line while they fit: a file's name shortens before a key drops under the title. */}
				<div data-testid="turn-keys" className={cn("flex flex-1 basis-0 items-center justify-end gap-x-2 empty:hidden", fileShown ? "min-w-[min(100%,19rem)]" : "min-w-fit")}>
					{fileShown && <ProblemFile file={fileShown} />}
					{!pending && problem?.piece && pieceFailed !== problem.toolCallId && (
						<button type="button" data-testid="piece-printed" aria-pressed={printed} onClick={() => setPrinted((on) => !on)} className={cn("lh-btn lh-btn-small", printed ? "lh-btn-main" : "lh-btn-quiet")}>
							As printed
						</button>
					)}
					{exit && (
						<button type="button" data-testid={exit.testId} onClick={onExit} className="lh-btn lh-btn-small lh-btn-quiet">
							{exit.label}
						</button>
					)}
				</div>
			</div>
			)}

			{reviewRefused && (
				<p data-testid="review-refused" className="text-base text-ink-2">
					That question is no longer due, so nothing was saved.
				</p>
			)}

			<TurnScroll>
				{pending && (
					<QuestionDock
						ref={questionRef}
						toolName={pending.tool as QuestionDockProps["toolName"]}
						toolCallId={pending.toolCallId}
						input={pending.input}
						onSubmit={onSubmitAnswer}
						initialDraft={initialQuestionDraft}
						onSaveDraft={onSaveQuestionDraft}
						onReady={setPicked}
						boxText={value}
						onLeaveRows={() => boxRef.current?.focus()}
						busy={busy && !fromEarlier}
					/>
				)}
				{!pending && problem && <OpenProblemPane statement={problem.statement} piece={problem.piece} printed={printed} onPieceFail={() => setPieceFailed(problem.toolCallId)} part={problem.part} picks={picks} />}
				{!pending && !problem && shown.kind === "answered" && <AnsweredTurn answer={shown.answered.answer} />}
				{next && (next.next.line || (nextKey && rowKey)) && (
					<div data-testid="turn-next" className="flex flex-wrap items-center gap-x-4 gap-y-2">
						{next.next.line && (
							<p data-testid="turn-next-line" className={cn("text-[18px] leading-[28px]", next.dim ? "text-ink-2" : "text-ink")}>
								{next.next.line}
							</p>
						)}
						{rowKey && nextButton}
					</div>
				)}
				{notes && <EndNotes notes={notes} scroll={quiet} />}
			</TurnScroll>
			</>
			)}
			</TurnSwap>

			{stuck && (
				<div data-testid="turn-stuck" className="flex flex-col items-start gap-2.5 bg-highlight px-3.5 py-3 text-base text-ink">
					{teacher} took this {stuck.minutes} minutes ago and hasn't answered.
					<button type="button" data-testid="turn-stuck-stop" onClick={stuck.onStop} className="lh-btn">
						{stuck.label}
					</button>
				</div>
			)}
			{error && (
				<div className="flex flex-col items-start gap-2.5 lh-sheet px-3.5 py-3 text-base">
					<span data-testid="lesson-error" title={error.detail} className="text-ans-wrong">
						{error.text}
					</span>
					<button type="button" data-testid="lesson-error-retry" onClick={error.onRetry} className="lh-btn">
						Try again
					</button>
				</div>
			)}

			{askError && (
				<p role="alert" data-testid="notes-ask-error" className="text-[15px] text-ans-wrong">
					{askError}
				</p>
			)}
			{ask && over > 0 && (
				<p role="status" data-testid="notes-ask-over" className="text-[15px] text-ink-2">
					Shorten it by {over} characters.
				</p>
			)}
			<LessonBox view={view} value={value} onChange={onChange} onAct={act} onFocus={() => questionRef.current?.fold()} attachments={attachments} boxRef={boxRef} />
			{(view.help || (turn.kind === "ask" && !(quiet && busy))) && (
				// Keys that wrap line up under the first key, not under the label.
				<div data-testid="turn-foot" className="flex items-baseline gap-2.5">
					<span className="mr-1 shrink-0 text-base text-ink-2">{view.help ? "Stuck?" : "Try asking"}</span>
					<div className="flex min-w-0 flex-wrap items-center gap-2.5">
						{view.help ? (
							<HelpKeys help={view.help} questionRef={questionRef} onHelpLine={onHelpLine} />
						) : (
							ideas.map((line) => (
								<button key={line} type="button" data-testid="lesson-idea" onClick={() => onHelpLine(line)} className={HELP_KEY}>
									{line}
								</button>
							))
						)}
					</div>
					{quiet && nextButton}
				</div>
			)}
		</div>
	);
}

/** The three "Stuck?" keys. */
function HelpKeys({ help, questionRef, onHelpLine }: { help: NonNullable<BoxView["help"]>; questionRef: RefObject<QuestionHandle | null>; onHelpLine: (line: string) => void }) {
	return (
		<>
			<button
				type="button"
				data-testid="help-dont-know"
				disabled={help.dontKnowDisabled}
				onClick={() => (help.dontKnow === "answer" ? questionRef.current?.dontKnow() : onHelpLine(DONT_KNOW))}
				className={HELP_KEY}
			>
				{DONT_KNOW}
			</button>
			<button type="button" data-testid="help-hint" disabled={help.linesDisabled} onClick={() => onHelpLine(HELP_LINES.hint)} className={HELP_KEY}>
				{HELP_LINES.hint}
			</button>
			<button type="button" data-testid="help-simpler" disabled={help.linesDisabled} onClick={() => onHelpLine(HELP_LINES.simpler)} className={HELP_KEY}>
				{HELP_LINES.simpler}
			</button>
		</>
	);
}

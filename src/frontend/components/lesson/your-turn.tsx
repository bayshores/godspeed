import { useRef, useState, type RefObject } from "react";
import { useEnterSubmits } from "@/frontend/components/enter-submits";
import { QuestionDock, type QuestionDockProps, type QuestionHandle } from "@/frontend/components/question-dock";
import { DEFAULT_TEACHER_NAME, DONT_KNOW, type DockSelection, type findPendingToolCall, type ProblemChoices, type QuestionAnswerData, type QuestionFormDraft } from "@/shared/core";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { cn } from "@/frontend/lib/utils";
import type { AttachmentDraft } from "./attachment-tray";
import { LessonBox } from "./lesson-box";
import { HELP_LINES, lessonBox, questionTurn, type BoxAction, type BoxView } from "./lesson-box-model";
import { OpenProblemPane, type ProblemPicks } from "./open-problem-pane";
import { ProblemFile, type ProblemFileRef } from "./problem-file";
import { TurnScroll } from "./turn-scroll";
import type { NextAction, TurnNext } from "./turn-next-model";

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
	 *  homework, the part the learner is on and the file it is from. */
	problem: { toolCallId: string; statement: string; choices: ProblemChoices | null; line: string | null; part: string | null; file: ProblemFileRef | null } | null;
	/** What is picked among the open problem's choices. */
	problemPicked: DockSelection;
	onPickProblem: (picked: DockSelection) => void;
	/** Opens the discard confirm for the open problem. */
	onDiscardProblem: () => void;
	/** The answer box, for the problem row to bring him back to his work. */
	boxRef: RefObject<{ focus(): void } | null>;
	/** With nothing to answer: what is next and its key, dimmed with no key while the teacher writes. */
	next: TurnNext & { dim: boolean };
	onNext: (action: NextAction) => void;
	busy: boolean;
	/** The answer box's text. */
	value: string;
	onChange: (v: string) => void;
	/** Sends the problem's work in the box. */
	onSend: () => void;
	/** Sends a "Stuck?" key's words, as a line typed in the teacher's terminal. */
	onHelpLine: (line: string) => void;
	attachments: AttachmentDraft;
	/** The waiting question, for the lesson to read what is picked so far. */
	questionRef: RefObject<QuestionHandle | null>;
	/** An agent took the turn and went quiet: stop it and run it again. */
	stuck: { minutes: number; label: string; onStop: () => void } | null;
	/** The last send or reply failed. */
	error: { text: string; detail: string; onRetry: () => void } | null;
}

const HELP_KEY = "lh-btn lh-btn-small";

const EXIT: Record<BoxView["exit"], { label: string; testId: string }> = {
	skip: { label: "Skip question", testId: "skip-question" },
	discard: { label: "Discard problem", testId: "discard-problem" },
};

/**
 * YOUR TURN, the sheet beside the lesson's text (or under it), there for the
 * whole lesson once it has started (turnPlace). It holds one of:
 * - a check waiting behind "Check your understanding" (the learner reads
 *   first and can note thoughts in the box);
 * - a waiting question (QuestionDock) and the answer box;
 * - the open problem, worked on in the box;
 * - the next state: what is next and the one key that goes on (turnNext),
 *   dimmed with no key while the teacher writes;
 * Its title is the problem's number when one is open ("Problem 3"), with the
 * way out of that state at the title row's end. Its foot row holds the
 * "Stuck?" keys, which ask for help in one click. Talking to the teacher
 * happens in its terminal. Beside the lesson text only the question or
 * problem shrinks to fit the window, scrolling in its own box (LessonScroll).
 */
export function YourTurn({
	pending,
	revealPending,
	onReveal,
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
	next,
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
}: YourTurnProps & {
	/** The waiting question is a check still behind "Check your understanding". */
	revealPending: boolean;
	onReveal: () => void;
}) {
	// Whether the question above the box has an answer picked.
	const [picked, setPicked] = useState(false);
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;

	const turn = revealPending ? ({ kind: "read-first" } as const) : pending ? questionTurn(pending.tool, pending.input, picked, pending.appPosed?.kind) : problem ? ({ kind: "problem", picked: problemPicked.selected.size > 0 } as const) : null;
	const view = turn && lessonBox({ busy, hasText: value.trim().length > 0, hasFiles: attachments.files.length > 0, turn });

	const act = (action: BoxAction) => {
		if (action === "send") onSend();
		else if (action === "submit") questionRef.current?.submit();
		else onReveal();
	};
	// Enter away from the box presses the main button, unless that would
	// send what is typed; with nothing to answer it presses the next key.
	const nextKey = !pending && !problem ? next.key : null;
	useEnterSubmits(() => {
		if (view) {
			if (view.button.action !== "send" && !view.button.disabled) act(view.button.action);
		} else if (nextKey) onNext(nextKey.action);
	});

	const picks: ProblemPicks | null =
		problem?.choices && view
			? { choices: problem.choices, picked: problemPicked, onPick: onPickProblem, onLeaveRows: () => boxRef.current?.focus(), onEnter: view.button.action === "send" && !view.button.disabled ? onSend : null }
			: null;

	const help = view?.help;
	const exit = view && EXIT[view.exit];
	const onExit = view?.exit === "skip" ? onSkipQuestion : onDiscardProblem;
	const fromEarlier = pending?.appPosed?.kind === "review";
	const title = fromEarlier ? "From earlier" : !pending && problem?.line ? problem.line : "Your turn";

	const mode = revealPending
		? `reveal:${pending?.toolCallId}`
		: pending
			? `question:${pending.toolCallId}`
			: problem
				? `practice:${problem.toolCallId}`
				: "next";
	// The opening state appears still; later states rise in.
	const initialModeRef = useRef(mode);

	return (
		// The lesson text's inset, so both sheets share their edges.
		<div data-testid="your-turn" data-mode={mode.split(":")[0]} className="lh-reading flex min-h-0 flex-1 flex-col gap-7">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<h2 className="text-[28px] leading-tight text-ink">{title}</h2>
				{!pending && problem?.file && <ProblemFile file={problem.file} />}
				{exit && (
					<button type="button" data-testid={exit.testId} onClick={onExit} className="lh-btn lh-btn-small lh-btn-quiet ml-auto">
						{exit.label}
					</button>
				)}
			</div>

			{reviewRefused && (
				<p data-testid="review-refused" className="text-base text-ink-2">
					That question is no longer due, so nothing was saved.
				</p>
			)}

			<TurnScroll key={mode} className={mode === initialModeRef.current ? undefined : "lh-rise"}>
				{pending && !revealPending && (
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
				{!pending && problem && <OpenProblemPane statement={problem.statement} part={problem.part} picks={picks} />}
				{!pending && !problem && (next.line || nextKey) && (
					<div data-testid="turn-next" className="flex flex-wrap items-center gap-x-4 gap-y-2">
						{next.line && (
							<p data-testid="turn-next-line" className={cn("text-[18px] leading-[28px]", next.dim ? "text-ink-2" : "text-ink")}>
								{next.line}
							</p>
						)}
						{nextKey && (
							<button type="button" data-testid="next-problem-button" data-action={nextKey.action} onClick={() => onNext(nextKey.action)} className="lh-btn lh-btn-main ml-auto">
								{nextKey.label}
							</button>
						)}
					</div>
				)}
			</TurnScroll>

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

			{view && <LessonBox view={view} value={value} onChange={onChange} onAct={act} onFocus={() => questionRef.current?.fold()} attachments={attachments} boxRef={boxRef} />}
			{help && (
				<div data-testid="turn-foot" className="flex flex-wrap items-center gap-2.5">
					<HelpKeys help={help} questionRef={questionRef} onHelpLine={onHelpLine} />
				</div>
			)}
		</div>
	);
}

/** "Stuck?" and its three keys. */
function HelpKeys({ help, questionRef, onHelpLine }: { help: NonNullable<BoxView["help"]>; questionRef: RefObject<QuestionHandle | null>; onHelpLine: (line: string) => void }) {
	return (
		<>
			<span className="mr-1 shrink-0 text-base text-ink-2">
				Stuck?
			</span>
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

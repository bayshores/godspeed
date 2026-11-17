import { useRef, useState, type RefObject } from "react";
import { useEnterSubmits } from "@/frontend/components/enter-submits";
import { QuestionDock, type QuestionDockProps, type QuestionHandle } from "@/frontend/components/question-dock";
import { DEFAULT_TEACHER_NAME, DONT_KNOW, type findPendingToolCall, type QuestionAnswerData, type QuestionFormDraft } from "@/shared/core";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import type { AttachmentDraft } from "./attachment-tray";
import { LessonBox } from "./lesson-box";
import { HELP_LINES, lessonBox, questionTurn, type BoxAction, type BoxView } from "./lesson-box-model";
import { OpenProblemPane } from "./open-problem-pane";
import { StopCard } from "./stop-card";
import type { StopAction, StopCardView } from "./stop-card-model";

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
	 *  homework, the part the learner is on. */
	problem: { toolCallId: string; statement: string; line: string | null; part: string | null } | null;
	/** Opens the discard confirm for the open problem. */
	onDiscardProblem: () => void;
	/** The answer box, for the problem row to bring him back to his work. */
	boxRef: RefObject<{ focus(): void } | null>;
	/** A place to stop he has not kept going from, keyed by the call that
	 *  made it. */
	stop: { key: string; view: StopCardView; onAction: (action: StopAction) => void } | null;
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
 * YOUR TURN, the sheet under the lesson's text, shown only while something
 * waits for the learner (yourTurnShown). It holds one of:
 * - a check waiting behind "Check your understanding" (the learner reads
 *   first and can note thoughts in the box);
 * - a waiting question (QuestionDock) and the answer box;
 * - the open problem, worked on in the box;
 * - a place to stop (the stop card);
 * Its foot row holds the "Stuck?" keys, which ask for help in one click,
 * and at its right end the way out of that state. Talking to the teacher
 * happens in its terminal. The sheet is as tall as all of it; the page
 * scrolls (LessonScroll).
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
	onDiscardProblem,
	boxRef,
	stop,
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

	const turn = revealPending ? ({ kind: "read-first" } as const) : pending ? questionTurn(pending.tool, pending.input, picked, pending.appPosed?.kind) : problem ? ({ kind: "problem" } as const) : null;
	const view = turn && lessonBox({ busy, hasText: value.trim().length > 0, hasFiles: attachments.files.length > 0, turn });

	const act = (action: BoxAction) => {
		if (action === "send") onSend();
		else if (action === "submit") questionRef.current?.submit();
		else onReveal();
	};
	// Enter away from the box presses the main button, unless that would
	// send what is typed.
	useEnterSubmits(() => {
		if (view && view.button.action !== "send" && !view.button.disabled) act(view.button.action);
	});

	const help = view?.help;
	const exit = view && EXIT[view.exit];
	const onExit = view?.exit === "skip" ? onSkipQuestion : onDiscardProblem;
	const fromEarlier = pending?.appPosed?.kind === "review";

	const mode = revealPending
		? `reveal:${pending?.toolCallId}`
		: pending
			? `question:${pending.toolCallId}`
			: problem
				? `practice:${problem.toolCallId}`
				: stop
					? `stop:${stop.key}`
					: "notice";
	// The opening state appears still; later states rise in.
	const initialModeRef = useRef(mode);

	return (
		// The lesson text's inset, so both sheets share their edges.
		<div data-testid="your-turn" data-mode={mode.split(":")[0]} className="flex flex-col gap-7 px-14 pt-10 pb-10 @max-[640px]/column:px-7 @max-[640px]/column:pt-7 @max-[640px]/column:pb-8">
			<h2 className="text-[26px] leading-tight font-medium text-ink">{fromEarlier ? "From earlier" : "Your turn"}</h2>

			{reviewRefused && (
				<p data-testid="review-refused" className="text-base text-ink-2">
					That question is no longer due, so nothing was saved.
				</p>
			)}

			<div key={mode} className={`flex flex-col gap-7 empty:hidden${mode === initialModeRef.current ? "" : " lh-rise"}`}>
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
				{!pending && problem && (
					<div className="flex flex-col gap-4">
						{problem.line && (
							<p data-testid="problem-line" className="font-count text-base text-ink-2">
								{problem.line}
							</p>
						)}
						<OpenProblemPane statement={problem.statement} part={problem.part} />
					</div>
				)}
				{!pending && !problem && stop && <StopCard view={stop.view} onAction={stop.onAction} />}
			</div>

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

			{view && exit && (
				<>
					<LessonBox view={view} value={value} onChange={onChange} onAct={act} onFocus={() => questionRef.current?.fold()} attachments={attachments} boxRef={boxRef} />
					<div data-testid="turn-foot" className="flex flex-wrap items-center gap-x-2.5 gap-y-2.5">
						{help && <HelpKeys help={help} questionRef={questionRef} onHelpLine={onHelpLine} />}
						<button type="button" data-testid={exit.testId} onClick={onExit} className="lh-btn lh-btn-small lh-btn-quiet -mr-2.5 ml-auto">
							{exit.label}
						</button>
					</div>
				</>
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

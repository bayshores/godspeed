import { useRef, useState, type RefObject } from "react";
import { useEnterSubmits } from "@/frontend/components/enter-submits";
import { QuestionDock, type QuestionDockProps, type QuestionHandle } from "@/frontend/components/question-dock";
import { type findPendingToolCall, type QuestionAnswerData, type QuestionFormDraft } from "@/shared/core";
import { AttachButton, type AttachmentDraft } from "./attachment-tray";
import { LessonBox } from "./lesson-box";
import { lessonBox, questionTurn, type BoxAction, type BoxView } from "./lesson-box-model";
import { OpenProblemPane } from "./open-problem-pane";
import { StopCard } from "./stop-card";
import type { StopAction, StopCardView } from "./stop-card-model";
import { useScrollFade } from "./use-scroll-fade";

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
	attachments: AttachmentDraft;
	/** The waiting question, for the lesson to read what is picked so far. */
	questionRef: RefObject<QuestionHandle | null>;
	/** An agent took the turn and went quiet: stop it and run it again. */
	stuck: { minutes: number; label: string; onStop: () => void } | null;
	/** The last send or reply failed. */
	error: { text: string; detail: string; onRetry: () => void } | null;
}

const EXIT: Record<BoxView["exit"], { label: string; testId: string }> = {
	skip: { label: "Skip question", testId: "skip-question" },
	discard: { label: "Discard problem", testId: "discard-problem" },
};

/**
 * YOUR TURN, the lesson's right column, shown only while something waits
 * for the learner (yourTurnShown). It holds one of:
 * - a check waiting behind "Check your understanding" (the learner reads
 *   first and can note thoughts in the box);
 * - a waiting question (QuestionDock) and the answer box;
 * - the open problem, worked on in the box;
 * - a place to stop (the stop card);
 * The button beside "Your turn" is the way out of that state. Talking to
 * the teacher happens in its terminal.
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
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
	useScrollFade(scroller);

	return (
		<div data-testid="your-turn" data-mode={mode.split(":")[0]} className="flex min-h-0 flex-1 flex-col gap-3.5 px-[22px] pt-[18px] pb-[22px]">
			<div className="flex shrink-0 items-center justify-between gap-3">
				<h2 className="text-[26px] leading-tight font-medium text-ink">{fromEarlier ? "From earlier" : "Your turn"}</h2>
				{exit && (
					<button type="button" data-testid={exit.testId} onClick={onExit} className="lh-btn lh-btn-quiet shrink-0">
						{exit.label}
					</button>
				)}
			</div>

			{reviewRefused && (
				<p data-testid="review-refused" className="shrink-0 text-base text-ink-2">
					That question is no longer due, so nothing was saved.
				</p>
			)}

			<div key={mode} className={`flex min-h-0 flex-initial flex-col${mode === initialModeRef.current ? "" : " lh-rise"}`}>
				{/* The scroll padding is the fade's length (useScrollFade), so a part scrolled to starts below the top fade. */}
				<div ref={setScroller} className="lh-scroll-fade flex min-h-0 scroll-pt-[min(48px,25%)] flex-col gap-3.5 overflow-y-auto">
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
						<>
							{problem.line && (
								<p data-testid="problem-line" className="shrink-0 font-count text-base text-ink-2">
									{problem.line}
								</p>
							)}
							<OpenProblemPane statement={problem.statement} part={problem.part} />
						</>
					)}
					{!pending && !problem && stop && <StopCard view={stop.view} onAction={stop.onAction} />}
				</div>
			</div>

			{stuck && (
				<div data-testid="turn-stuck" className="flex shrink-0 flex-col items-start gap-2.5 bg-highlight px-3.5 py-3 text-base text-ink">
					Your agent took this {stuck.minutes} minutes ago and hasn't answered.
					<button type="button" data-testid="turn-stuck-stop" onClick={stuck.onStop} className="lh-btn">
						{stuck.label}
					</button>
				</div>
			)}
			{error && (
				<div className="flex shrink-0 flex-col items-start gap-2.5 lh-sheet px-3.5 py-3 text-base">
					<span data-testid="lesson-error" title={error.detail} className="text-ans-wrong">
						{error.text}
					</span>
					<button type="button" data-testid="lesson-error-retry" onClick={error.onRetry} className="lh-btn">
						Try again
					</button>
				</div>
			)}

			{view && (
				<>
					<LessonBox view={view} value={value} onChange={onChange} onAct={act} onFocus={() => questionRef.current?.fold()} attachments={attachments} boxRef={boxRef} />
					<div className="flex shrink-0 items-center">
						<AttachButton draft={attachments} />
					</div>
				</>
			)}
		</div>
	);
}

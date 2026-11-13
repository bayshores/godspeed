import { useRef, useState } from "react";
import { Link } from "react-router";
import { NoAgentLine } from "@/frontend/components/agent-folder/no-agent-line";
import { teachStep, useAgentStatus } from "@/frontend/components/agent-status";
import { useEnterSubmits } from "@/frontend/components/enter-submits";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { QuestionDock, type QuestionDockProps, type QuestionHandle } from "@/frontend/components/question-dock";
import type { QueuedSteerLine } from "@/frontend/components/queued-steers";
import { DEFAULT_TEACHER_NAME, normalizeQuizType, questionKindLabel, type findPendingToolCall, type QuestionAnswerData, type QuestionFormDraft } from "@/shared/core";
import { AttachButton, type AttachmentDraft } from "./attachment-tray";
import { LessonBox } from "./lesson-box";
import { lessonBox, questionTurn, type BoxAction, type BoxTurn, type BoxView } from "./lesson-box-model";
import { OpenProblemPane } from "./open-problem-pane";

type Pending = NonNullable<ReturnType<typeof findPendingToolCall>>;

export interface YourTurnProps {
	pending: Pending | null;
	initialQuestionDraft?: QuestionFormDraft;
	onSaveQuestionDraft: (draft: QuestionFormDraft) => void;
	onSubmitAnswer: (output: QuestionAnswerData) => void;
	/** Opens the skip confirm for the waiting question. */
	onSkipQuestion: () => void;
	/** The open problem, with its line ("HW6, problem 3 of 7") and, for
	 *  homework, where it is in the file and the part the learner is on. */
	problem: { toolCallId: string; statement: string; line: string | null; source: string | null; part: string | null } | null;
	/** Opens the discard confirm for the open problem. */
	onDiscardProblem: () => void;
	busy: boolean;
	/** The turn waits for an agent to take it. */
	waitingForAgent: boolean;
	/** Stops the running turn. */
	onStop: () => void;
	/** The go-ahead in the pause between problems ("Next problem", or
	 *  "Continue" in a study session); absent outside that pause. */
	next?: string;
	onNext: () => void;
	/** The writing box's text. */
	value: string;
	onChange: (v: string) => void;
	onSend: () => void;
	queuedSteers: QueuedSteerLine[];
	attachments: AttachmentDraft;
	/** An agent took the turn and went quiet: stop it and run it again. */
	stuck: { minutes: number; label: string; onStop: () => void } | null;
	/** The last send or reply failed. */
	error: { text: string; detail: string; onRetry: () => void } | null;
	/** The lesson size button. */
	stats: React.ReactNode;
}

const EXIT: Record<NonNullable<BoxView["exit"]>, { label: string; testId: string }> = {
	skip: { label: "Skip question", testId: "skip-question" },
	discard: { label: "Discard problem", testId: "discard-problem" },
	stop: { label: "Stop", testId: "stop-turn" },
};

/**
 * YOUR TURN, the teacher column under its head: what waits for the
 * learner, then the one writing box. It holds one of:
 * - a check waiting behind "Check your understanding" (the learner reads
 *   first and can note thoughts in the box);
 * - a waiting question (QuestionDock);
 * - the open problem (worked on in the box);
 * - otherwise nothing to answer, with Next problem / Continue in the pause
 *   between problems.
 * The button beside "Your turn" is the way out of that state.
 */
export function YourTurn({
	pending,
	revealPending,
	onReveal,
	initialQuestionDraft,
	onSaveQuestionDraft,
	onSubmitAnswer,
	onSkipQuestion,
	problem,
	onDiscardProblem,
	busy,
	waitingForAgent,
	onStop,
	next,
	onNext,
	value,
	onChange,
	onSend,
	queuedSteers,
	attachments,
	stuck,
	error,
	stats,
}: YourTurnProps & {
	/** The waiting question is a check still behind "Check your understanding". */
	revealPending: boolean;
	onReveal: () => void;
}) {
	const name = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const agentName = useAgentStatus()?.name?.trim();
	// Whether the question above the box has an answer picked.
	const [picked, setPicked] = useState(false);
	const questionRef = useRef<QuestionHandle>(null);
	const boxRef = useRef<{ focus(): void }>(null);

	const turn: BoxTurn = revealPending
		? { kind: "read-first" }
		: pending
			? questionTurn(pending.tool, pending.input, picked)
			: problem
				? { kind: "problem" }
				: { kind: "none", next };
	const view = lessonBox({ name, busy, waitingForAgent, hasText: value.trim().length > 0, hasFiles: attachments.files.length > 0, turn });

	const act = (action: BoxAction) => {
		if (action === "send") onSend();
		else if (action === "submit") questionRef.current?.submit();
		else if (action === "reveal") onReveal();
		else if (action === "next") onNext();
		else onStop();
	};
	// Enter away from the box presses the main button, unless that would
	// send what is typed.
	useEnterSubmits(() => {
		if (view.right.action !== "send" && !view.right.disabled) act(view.right.action);
	});

	const exit = view.exit && EXIT[view.exit];
	const onExit = view.exit === "skip" ? onSkipQuestion : view.exit === "discard" ? onDiscardProblem : onStop;
	const kind = pending ? questionKindLabel(pending.tool, normalizeQuizType((pending.input as { type?: unknown } | null)?.type)) : "Question";

	const mode = revealPending ? `reveal:${pending?.toolCallId}` : pending ? `question:${pending.toolCallId}` : problem ? `practice:${problem.toolCallId}` : "chat";
	// The opening state appears still; later states rise in.
	const initialModeRef = useRef(mode);

	return (
		<div data-testid="your-turn" data-mode={mode.split(":")[0]} className="flex min-h-0 flex-1 flex-col gap-3.5 px-[22px] pt-[18px] pb-[22px]">
			<div className="flex shrink-0 items-center justify-between gap-3">
				<h2 className="text-[26px] leading-tight font-medium text-ink">Your turn</h2>
				{exit && (
					<button type="button" data-testid={exit.testId} onClick={onExit} className="lh-btn lh-btn-quiet shrink-0">
						{exit.label}
					</button>
				)}
			</div>

			<div key={mode} className={`flex min-h-0 flex-initial flex-col${mode === initialModeRef.current ? "" : " lh-rise"}`}>
				<div className="lh-scroll-fade flex min-h-0 flex-col gap-3.5 overflow-y-auto">
					{pending && kind !== "Question" && (
						<p data-testid="question-kind" className="shrink-0 font-count text-base text-ink-2">
							{kind}
						</p>
					)}
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
							busy={busy}
						/>
					)}
					{!pending && problem && (
						<>
							{problem.line && (
								<p data-testid="problem-line" className="shrink-0 font-count text-base text-ink-2">
									{problem.line}
								</p>
							)}
							<OpenProblemPane statement={problem.statement} source={problem.source} part={problem.part} />
						</>
					)}
					{!pending && !problem && !busy && (
						<p data-testid="nothing-to-answer" className="shrink-0 text-base text-ink-2">
							Nothing to answer right now.
						</p>
					)}
				</div>
			</div>

			{waitingForAgent && (
				<div data-testid="lesson-waiting" className="flex shrink-0 flex-col items-start gap-2">
					{agentName && <p className="text-[15px] text-ink-2">{teachStep(agentName)}</p>}
					<Link to="/settings?section=connection" data-testid="lesson-waiting-settings" className="lh-btn">
						Open Connection settings
					</Link>
				</div>
			)}
			{stuck && (
				<div data-testid="turn-stuck" className="flex shrink-0 flex-col items-start gap-2.5 bg-highlight px-3.5 py-3 text-base text-ink">
					Your agent took this {stuck.minutes} minutes ago and hasn't answered.
					<button type="button" data-testid="turn-stuck-stop" onClick={stuck.onStop} className="lh-btn">
						{stuck.label}
					</button>
				</div>
			)}
			{error && (
				<div className="flex shrink-0 flex-col items-start gap-2.5 border-[1.5px] border-line bg-panel px-3.5 py-3 text-base">
					<span data-testid="lesson-error" title={error.detail} className="text-ans-wrong">
						{error.text}
					</span>
					<button type="button" data-testid="lesson-error-retry" onClick={error.onRetry} className="lh-btn">
						Try again
					</button>
				</div>
			)}

			<LessonBox
				view={view}
				value={value}
				onChange={onChange}
				onAct={act}
				onFocus={() => questionRef.current?.fold()}
				queuedSteers={queuedSteers}
				attachments={attachments}
				boxRef={boxRef}
			/>
			<div className="flex shrink-0 items-center gap-2">
				<AttachButton draft={attachments} />
				<span className="flex-1" />
				{stats}
			</div>
			<NoAgentLine />
		</div>
	);
}

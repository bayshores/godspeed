import { useContext, useRef, useState, type CSSProperties, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";
import { answeredKindLabel } from "@/frontend/components/answered-card-model";
import { AgentCompact, useCompactShown } from "@/frontend/components/agent-setup/agent-card";
import { useEnterSubmits } from "@/frontend/components/enter-submits";
import { QuestionDock, type QuestionDockProps, type QuestionHandle } from "@/frontend/components/question-dock";
import { DEFAULT_TEACHER_NAME, DONT_KNOW, normalizeQuizType, questionKindLabel, type DockSelection, type findPendingToolCall, type ProblemChoices, type ProblemPieceText, type QuestionAnswerData, type QuestionFormDraft } from "@/shared/core";
import { useSettings } from "@/frontend/components/settings-context";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { cn } from "@/frontend/lib/utils";
import type { AttachmentDraft } from "./attachment-tray";
import { wordsOver } from "@/frontend/components/vault/note-pages-model";
import { EndNotes, NotesSaved } from "./end-notes";
import { LessonBox } from "./lesson-box";
import { HELP_LINES, lessonBox, lessonIdeas, questionTurn, type BoxAction, type BoxView } from "./lesson-box-model";
import { OpenProblemPane, type ProblemPicks } from "./open-problem-pane";
import { ProblemFile, type ProblemFileRef } from "./problem-file";
import { problemFolded } from "./turn-fold-model";
import { TurnScroll } from "./turn-scroll";
import { TurnPlaceContext, TurnSlotsContext } from "./turn-place";
import { TurnSwap } from "./turn-swap";
import { AnsweredTurn } from "./answered-turn";
import type { NextAction, TurnShown } from "./turn-next-model";

type Pending = NonNullable<ReturnType<typeof findPendingToolCall>>;

/** A finished task as "Your turn" keeps it: the question with the learner's answer, or the
 *  problem with its line ("Problem 2", practice only). */
export type KeptTask =
	| { kind: "question"; toolCallId: string; answer: QuestionAnswerData }
	| { kind: "problem"; toolCallId: string; statement: string; piece: ProblemPieceText | null; line: string | null; discarded: boolean };

export interface YourTurnProps {
	pending: Pending | null;
	initialQuestionDraft?: QuestionFormDraft;
	onSaveQuestionDraft: (draft: QuestionFormDraft) => void;
	onSubmitAnswer: (output: QuestionAnswerData) => void;
	/** Opens the skip confirm for the waiting question: the key of one that came through broken. */
	onSkipQuestion: () => void;
	/** His answer to a question from earlier was refused: it was no longer due. */
	reviewRefused: boolean;
	/** The open problem, with its line ("Problem 2", practice only), for a listed problem the part
	 *  the learner is on and the file it is from, and whether he has sent something since it opened. */
	problem: { toolCallId: string; statement: string; piece: ProblemPieceText | null; choices: ProblemChoices | null; line: string | null; part: string | null; file: ProblemFileRef | null; sent: boolean } | null;
	/** What is picked among the open problem's choices. */
	problemPicked: DockSelection;
	onPickProblem: (picked: DockSelection) => void;
	/** The answer box, for the problem row to bring him back to his work. */
	boxRef: RefObject<{ focus(): void } | null>;
	/** The task the learner last finished, kept above the box until the lesson goes on. */
	kept: KeptTask | null;
	/** With nothing to answer: what is next and its key, or what stays while the teacher writes. */
	shown: TurnShown;
	/** Changes when what waits changes: the part above the box swaps then. */
	swapKey: string;
	onNext: (action: NextAction) => void;
	busy: boolean;
	/** Stops the running turn; null with none running, and while the teacher reads ahead at a stop, which is not stopped. */
	onStop: (() => void) | null;
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
	/** The last send or reply failed. */
	error: { text: string; detail: string; onRetry: () => void } | null;
	/** Answers the "My words" ask at the last topic: with words, or by skipping it. */
	onAnswerAsk: (topicId: string, reply: { words: string } | { skip: true }) => void;
	/** Why the last answer to the ask was refused. */
	askError: string | null;
	/** The lesson page's glide (useSheetGlide), for the task. */
	sheetRef?: Ref<HTMLElement>;
	/** The space's pale color, for what is picked. */
	pale: string;
}

const HELP_KEY = "lh-btn lh-btn-small lh-btn-quiet";
const NO_SWITCHES: Readonly<Record<string, boolean>> = {};

/**
 * THE LEARNER'S TURN, there for the whole lesson once it has started
 * (turnDrawn), in two parts the lesson page places (LessonScroll).
 *
 * The task holds one of:
 * - a waiting question (QuestionDock);
 * - the open problem;
 * - the task the learner last finished, dimmed and not pressable (the
 *   question with his answer, AnsweredTurn, or the problem as it stood);
 * - the line that says what is next (turnNext), dimmed while the teacher
 *   writes (turnShown), and the lesson's notes at its end.
 * A small tag names what waits ("Quiz", "Problem 3"), with the task's own
 * keys at the row's end. With nothing to show it takes no room.
 *
 * The writing row is there in every state and stays still while the task
 * swaps: the learner answers in it, works in it and asks the teacher in it
 * (lessonBox), and the key that goes on ends its keys. Over it one row of
 * keys sends a line in one click: "Stuck?" with a question or a problem
 * waiting, "Try asking" with nothing waiting.
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
	boxRef,
	kept,
	shown,
	swapKey,
	onNext,
	busy,
	onStop,
	value,
	onChange,
	onSend,
	onHelpLine,
	attachments,
	questionRef,
	error,
	onAnswerAsk,
	askError,
	sheetRef,
	pale,
}: YourTurnProps) {
	// Whether the question above the box has an answer picked.
	// A send failed because the agent can't run: the setup card's compact form says why.
	const compactShown = useCompactShown();
	const [picked, setPicked] = useState(false);
	// The open problem's page in the theme's ink, or on white as its file prints it.
	const [printed, setPrinted] = useState(false);
	// The problem whose page did not load: its words show, so there is no page to turn white.
	const [pieceFailed, setPieceFailed] = useState<string | null>(null);
	// The problem the learner asked to see whole, or folded, with the key in the title's row.
	const [wholeChoice, setWholeChoice] = useState<{ of: string; whole: boolean } | null>(null);
	// The open problem is longer than the room it gets folded.
	const [long, setLong] = useState(false);
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;

	const next = !pending && !problem ? shown : null;
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

	const fileShown = pending ? null : (problem?.file ?? null);
	const fromEarlier = pending?.appPosed?.kind === "review";
	const keptProblem = kept?.kind === "problem" ? kept : null;
	const keptTag = kept?.kind === "question" ? answeredKindLabel(kept.answer) : null;

	const mode = pending ? "question" : problem ? "practice" : kept ? "kept" : "next";
	const place = useContext(TurnPlaceContext);
	const slots = useContext(TurnSlotsContext);
	// The tag says what waits, in the word its answered card will carry. A question carries its own after its text; with nothing asked there is none.
	const questionTag = fromEarlier ? "From earlier" : pending ? questionKindLabel(pending.tool, normalizeQuizType((pending.input as { type?: unknown } | null)?.type)) : null;
	const tag = pending ? null : ask ? "My words" : (problem?.line ?? keptProblem?.line ?? null);
	// An open problem pinned over the text folds so the text keeps its window. One with answers to click stays whole, as a question does.
	const folds = place === "pinned" && !pending && problem !== null && !problem.choices;
	const folded = folds ? problemFolded(problem.sent, wholeChoice?.of === problem.toolCallId ? wholeChoice.whole : null) : undefined;
	const shownProblem = problem ?? keptProblem;
	// The part that was open when the problem closed stays open, so the kept problem holds its height.
	const partRef = useRef<{ of: string; part: string | null } | null>(null);
	if (problem) partRef.current = { of: problem.toolCallId, part: problem.part };
	const shownPart = shownProblem && partRef.current?.of === shownProblem.toolCallId ? partRef.current.part : null;
	const pieceShown = !pending && problem?.piece && pieceFailed !== problem.toolCallId;
	// A problem in words with no tag, pinned over the text, keeps its keys in its corner, so they take no line of their
	// own. A page's piece keeps the whole width, which is what sets the size of its print.
	const hasKeys = (folds && long) || fileShown !== null || Boolean(pieceShown);
	// Outside the page's own text a problem lies on a plate, its keys in the plate's corner.
	const plated = !pending && shownProblem !== null && place !== "under";
	const corner = hasKeys && plated && !tag && !pieceShown;
	const keys = (
		// In a row with the tag the keys stay on its line while they fit: a file's name shortens before a key drops under it.
		<div data-testid="turn-keys" className={cn("flex items-center justify-end gap-2", corner ? "flex-wrap" : cn("flex-1 basis-0", fileShown ? "min-w-[min(100%,19rem)]" : "min-w-fit"))}>
			{folds && long && (
				<button type="button" data-testid="turn-whole" aria-expanded={!folded} onClick={() => setWholeChoice({ of: problem.toolCallId, whole: folded === true })} className="lh-btn lh-btn-small lh-btn-quiet">
					{folded ? "Whole problem" : "Less"}
				</button>
			)}
			{fileShown && <ProblemFile file={fileShown} />}
			{pieceShown && (
				<button type="button" data-testid="piece-printed" aria-pressed={printed} onClick={() => setPrinted((on) => !on)} className={cn("lh-btn lh-btn-small", printed ? "lh-btn-main" : "lh-btn-quiet")}>
					As printed
				</button>
			)}
		</div>
	);
	const nextLine = next?.next.line ?? null;
	// With nothing asked, no line to say and no notes, the task takes no room.
	const empty = !pending && !shownProblem && !kept && !nextLine && !notes && !reviewRefused;

	const nextRow = nextLine && (
		<p data-testid="turn-next-line" className={cn("font-prose text-[18px] leading-[28px]", next?.dim ? "text-ink-2" : "text-ink")}>
			{nextLine}
		</p>
	);
	const stand = slots.closing ? "lh-fade" : slots.stepIn && "lh-block-in";
	const stood = { "data-state": slots.closing ? "closed" : "open", inert: slots.closing, style: { "--lh-block-delay": "240ms", "--lh-pale": pale } as CSSProperties };

	const task = (
		<aside ref={sheetRef} data-testid="turn-sheet" aria-label="Your turn" data-plate={plated || undefined} {...stood} className={cn("lh-turn-task flex min-h-0 min-w-0 flex-col", stand, empty && "hidden")}>
			<div data-testid="your-turn" data-mode={mode} className="flex min-h-0 flex-1 flex-col gap-5">
				<TurnSwap key={place === "pinned" || place === "under" ? "column" : "page"} swapKey={empty ? "none" : swapKey}>
					{empty ? null : (
						<>
							{(tag || (hasKeys && !corner)) && (
								<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
									{tag && <h2 className="lh-kind">{tag}</h2>}
									{hasKeys && !corner && keys}
								</div>
							)}

							{reviewRefused && (
								<p data-testid="review-refused" className="text-base text-ink-2">
									That question is no longer due, so nothing was saved.
								</p>
							)}

							<div className={cn("lh-turn-body", corner && "lh-turn-cornered")}>
								<TurnScroll folded={folded} onLong={setLong}>
									{pending && (
										<QuestionDock
											ref={questionRef}
											toolName={pending.tool as QuestionDockProps["toolName"]}
											toolCallId={pending.toolCallId}
											tag={questionTag}
											onSkip={onSkipQuestion}
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
									{/* One element while the problem is open and after it closes, so its page is not drawn anew. */}
									{!pending && shownProblem && (
										<div data-testid={keptProblem ? "kept-problem" : undefined} inert={keptProblem !== null} className={cn("flex flex-col gap-7", keptProblem && "opacity-60")}>
											<OpenProblemPane statement={shownProblem.statement} piece={shownProblem.piece} printed={printed} onPieceFail={() => setPieceFailed(shownProblem.toolCallId)} part={shownPart} picks={problem ? picks : null} />
											{keptProblem?.discarded && (
												<p data-testid="kept-problem-discarded" className="text-[18px] leading-[28px]">
													Discarded
												</p>
											)}
										</div>
									)}
									{kept?.kind === "question" && <AnsweredTurn answer={kept.answer} tag={keptTag} />}
									{!kept && nextRow}
									{notes && <EndNotes notes={notes} />}
									{notes && <NotesSaved notes={notes} />}
								</TurnScroll>
								{corner && keys}
							</div>
							{/* Under a kept task the line stays in sight however long the task is. */}
							{kept && nextRow}
						</>
					)}
				</TurnSwap>
			</div>
		</aside>
	);

	const row = (
		<div data-testid="turn-row" {...stood} className={cn("lh-turn-row flex min-w-0 shrink-0 flex-col gap-3", stand)}>
			{error &&
				(compactShown ? (
					<AgentCompact />
				) : (
					<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 lh-well px-4 py-3 text-base">
						<span data-testid="lesson-error" title={error.detail} className="text-ans-wrong">
							{error.text}
						</span>
						<button type="button" data-testid="lesson-error-retry" onClick={error.onRetry} className="lh-btn lh-btn-main lh-btn-small shrink-0">
							Try again
						</button>
					</div>
				))}
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
			{(view.help || (turn.kind === "ask" && !busy)) && (
				// Keys that wrap line up under the first key, not under the label.
				<div data-testid="turn-foot" className="flex items-baseline gap-2.5">
					<span className="mr-1 shrink-0 text-base text-ink-2">{view.help ? "Stuck?" : "Try asking"}</span>
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
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
				</div>
			)}
			<LessonBox
				view={view}
				value={value}
				onChange={onChange}
				onAct={act}
				onFocus={() => questionRef.current?.fold()}
				attachments={attachments}
				boxRef={boxRef}
				// With a "My words" ask, the key that ends the day sits among the box's own keys.
				end={
					<>
						{onStop && (
							<button type="button" data-testid="stop-turn" onClick={onStop} className="lh-btn lh-btn-quiet shrink-0">
								Stop
							</button>
						)}
						{nextKey && ask === null && (
							<button type="button" data-testid="next-problem-button" data-action={nextKey.action} onClick={() => onNext(nextKey.action)} className="lh-btn lh-btn-main shrink-0">
								{nextKey.label}
							</button>
						)}
					</>
				}
			/>
		</div>
	);

	if (slots.task && slots.row)
		return (
			<>
				{createPortal(task, slots.task)}
				{createPortal(row, slots.row)}
			</>
		);
	return (
		<>
			{task}
			{row}
		</>
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

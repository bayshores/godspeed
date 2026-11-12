import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { ANSWER_ROW, DontKnowRow, PICKED, proseVars, QuestionText } from "@/frontend/components/lesson/question-parts";
import { ConfidenceMeter, ConfidenceSquares } from "@/frontend/components/confidence-meter";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { PickedRow } from "@/frontend/components/lesson/picked-row";
import { cn } from "@/frontend/lib/utils";
import { useSound } from "@/frontend/components/sounds";
import {
	answerSound,
	buildAnswer,
	normalizeQuizType,
	CONFIDENCE_STOPS,
	emptyDockSelection,
	normalizeOptions,
	resolveCorrect,
	seededRandom,
	shuffleOptions,
	toolQuestionKind,
	parseAskInput,
	parseQuizInput,
	parseExplainInput,
	parseWriteCodeInput,
	stepConfidence,
	toggleOption,
	toggleOther,
	type AnswerRequest,
	type AskToolInput,
	type ConfidenceLevel,
	type DockSelection,
	type ExplainDisplayInput,
	type QuestionAnswerData,
	type QuestionFormDraft,
	type QuestionData,
	type QuestionMode,
	type QuizDisplayInput,
	type SelectMode,
	type WriteCodeInput,
} from "@/shared/core";
import { CodeQuestion } from "@/frontend/components/lesson/code-question";

/**
 * THE WAITING QUESTION, above the lesson's writing box: the question, its
 * lettered choices (keys 1–n, 0 = I don't know) and the five "how sure"
 * squares (quiz only; ←/→ or click). It holds no text box and no buttons
 * of its own: the writing box under it carries the reasoning (or the
 * whole answer, for a question answered in words) and "Submit answer".
 *
 * The ask "Other…" choice is an editable row. A write_code question has
 * its own form (CodeQuestion).
 */

/** What the writing box asks of the question above it. */
export interface QuestionHandle {
	/** Sends the answer with the box's text. */
	submit(): void;
	/** The learner started writing: an answered list folds into one row. */
	fold(): void;
}

export interface QuestionDockProps {
	toolName: "quiz" | "probe" | "ask_user_question" | "explain" | "recall" | "write_code";
	toolCallId: string;
	input: unknown;
	onSubmit: (output: QuestionAnswerData) => void;
	/** The picks as the learner left them (this call's saved draft). */
	initialDraft?: QuestionFormDraft;
	/** Called on every change, so the picks survive leaving the lesson. */
	onSaveDraft?: (draft: QuestionFormDraft) => void;
	/** Whether an answer is picked, so the box's "Submit answer" follows it. */
	onReady: (ready: boolean) => void;
	/** What the writing box holds: the reasoning, or the answer itself for
	 *  a question answered in words. */
	boxText: string;
	/** Tab from the choices goes to the writing box. */
	onLeaveRows: () => void;
	/** The teacher is replying to a side question: submit waits. */
	busy?: boolean;
	ref?: React.Ref<QuestionHandle>;
}

export function QuestionDock(props: QuestionDockProps) {
	const { toolName, input } = props;
	// The probe-phase names canonicalize onto their teach twins for parsing:
	// the probe quiz is quiz-shaped, the probe recall is explain-shaped.
	const canonical = toolName === "probe" ? "quiz" : toolName === "recall" ? "explain" : toolName;
	// Parse, don't cast: the model authored this input. Anything that slips
	// past the bridge's validation renders the quiet fallback, never a crash.
	const parsed =
		canonical === "quiz"
			? parseQuizInput(input)
			: canonical === "explain"
				? parseExplainInput(input)
				: canonical === "write_code"
					? parseWriteCodeInput(input)
					: parseAskInput(input);
	if (!parsed) {
		return (
			<div data-testid="malformed-question" className="shrink-0 bg-tone px-3.5 py-3 text-base text-ink-2">
				This question came through broken. Skip it and the teacher will ask again.
			</div>
		);
	}
	if (canonical === "write_code") return <CodeQuestion {...props} input={parsed as WriteCodeInput} />;
	return <QuestionDockForm {...props} input={parsed as QuizDisplayInput | AskToolInput | ExplainDisplayInput} />;
}

const OPTION_ROW = cn(ANSWER_ROW, "items-start px-2.5 py-[9px]");
/** The dotted rule between two rows. */
const ROW_RULE = "border-t-2 border-dotted border-edge";

/** A choice's box: its letter, filled once picked. */
function OptionMark({ picked, children }: { picked: boolean; children?: React.ReactNode }) {
	return (
		<span aria-hidden className={cn("flex size-7 shrink-0 items-center justify-center rounded-[2px] border-[1.5px] border-ink text-sm font-medium", picked ? "bg-ink text-background" : "bg-panel text-ink")}>
			{children}
		</span>
	);
}

const letter = (i: number) => String.fromCharCode(65 + i);

/** A question with its choices (or, answered in words, the question alone). */
function QuestionDockForm({
	toolName,
	toolCallId,
	input,
	onSubmit,
	initialDraft,
	onSaveDraft,
	onReady,
	boxText,
	onLeaveRows,
	busy = false,
	ref,
}: Omit<QuestionDockProps, "input"> & { input: QuizDisplayInput | AskToolInput | ExplainDisplayInput }) {
	const kind = toolQuestionKind(toolName);
	const play = useSound();

	// Canonical QuestionData, built once per question. Quiz options are
	// shuffled deterministically (seeded by toolCallId) so position never
	// leaks correctness and server/client agree; the display order is
	// snapshotted into the answer at submit.
	const qd = useMemo<QuestionData>(() => {
		const quizInput = kind === "quiz" ? (input as QuizDisplayInput) : null;
		const askInput = kind === "ask" ? (input as AskToolInput) : null;
		const explainInput = kind === "explain" ? (input as ExplainDisplayInput) : null;
		const multi = input instanceof Object && "multiSelect" in input ? input.multiSelect === true : false;
		const mode: QuestionMode =
			kind === "quiz"
				? multi
					? "multi-select"
					: "single-select"
				: askInput?.options?.length
					? multi
						? "multi-select"
						: "single-select"
					: "text";
		const options = normalizeOptions((quizInput?.options ?? askInput?.options ?? []) as { label: string; value?: string }[]);
		const ordered = kind === "quiz" && options.length > 0 ? shuffleOptions(options, seededRandom(toolCallId)) : options;
		const q: QuestionData = {
			kind,
			questionType: kind === "quiz" ? normalizeQuizType((input as { type?: unknown }).type) : undefined,
			question: input.question,
			context: input.details,
			mode,
			options: ordered,
		};
		if (quizInput) {
			const resolved = resolveCorrect(quizInput.correctAnswer, ordered);
			if (resolved.error) console.error("[quiz] correctAnswer did not resolve:", resolved.error);
			q.correctIndices = resolved.indices;
			q.explanation = quizInput.explanation;
		}
		// The explain commitment rides the question data and snapshots into
		// the answer at submit (never shown before answering).
		if (explainInput) q.committedAnswer = explainInput.correctAnswer;
		return q;
	}, [toolCallId, kind, input]);

	// The selection machine lives in question-core (pure, tested).
	const [sel, setSel] = useState<DockSelection>(() => initialDraft?.selection ?? emptyDockSelection());
	const [other, setOther] = useState(initialDraft?.other ?? "");
	// Confidence: an index into CONFIDENCE_STOPS (level − 1), unset until
	// the learner picks one.
	const [confIdx, setConfIdx] = useState<number | undefined>(initialDraft?.confidenceIndex);
	const selectMode: SelectMode = qd.mode === "multi-select" ? "multi-select" : "single-select";

	// Every change is saved, so leaving the lesson keeps the picks.
	const saveDraftRef = useRef(onSaveDraft);
	saveDraftRef.current = onSaveDraft;
	useEffect(() => {
		saveDraftRef.current?.({ selection: sel, other, confidenceIndex: confIdx });
	}, [sel, other, confIdx]);

	const toggle = (idx: number) => setSel(toggleOption(selectMode, sel, idx));
	const toggleDontKnow = () =>
		setSel((prev) => ({ ...prev, selected: new Set(), otherSelected: false, dontKnow: !prev.dontKnow }));

	// Answered in words, the box decides when there is an answer.
	const canSubmit = qd.mode === "text" || sel.dontKnow || (sel.otherSelected && other.trim().length > 0) || sel.selected.size > 0;
	const readyRef = useRef(onReady);
	readyRef.current = onReady;
	useEffect(() => {
		readyRef.current(canSubmit);
		return () => readyRef.current(false);
	}, [canSubmit]);

	// Writing with an answer picked folds the list into one row (Change opens it).
	const [folded, setFolded] = useState(false);
	const showFolded = folded && canSubmit && qd.mode !== "text";

	const submit = () => {
		if (!canSubmit || busy) return;
		const req: AnswerRequest = {
			dontKnow: sel.dontKnow,
			values: [...sel.selected].map((i) => qd.options[i]!.value),
			other: sel.otherSelected ? other : undefined,
			text: qd.mode === "text" ? boxText : undefined,
			thinking: qd.mode !== "text" ? boxText.trim() || undefined : undefined,
			// Sent only once picked; buildAnswer drops it on "I don't know".
			confidence: kind === "quiz" && confIdx !== undefined ? CONFIDENCE_STOPS[confIdx] : undefined,
		};
		const answer = buildAnswer(qd, req, toolName);
		const sound = answerSound(answer);
		if (sound) play(sound);
		onSubmit(answer);
	};
	useImperativeHandle(ref, () => ({
		submit,
		fold() {
			if (canSubmit) setFolded(true);
		},
	}));

	const selectOther = () => setSel(toggleOther(selectMode, sel));

	/* ── The keyboard machine ──
	   1–9 pick an option, 0 = "I don't know" (quiz). ↑/↓ walk every row,
	   clamped at the ends; Space acts on the walked row like a click; Enter
	   submits once an answer exists. ←/→ move the confidence level. Tab
	   from the rows goes to the writing box. Keys typed into a field keep
	   their meaning, and modifier combos are never ours. */
	const [kbdIdx, setKbdIdx] = useState<number | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	const otherInputRef = useRef<HTMLInputElement>(null);
	// One row past the options: quiz → don't-know, ask → Other.
	const optionCount = qd.mode === "text" ? 0 : qd.options.length;
	const rowCount = qd.mode === "text" ? 0 : optionCount + 1;

	const kbdAct = (idx: number) => {
		if (idx < optionCount) toggle(idx);
		else if (kind === "quiz") toggleDontKnow();
		else if (sel.otherSelected) {
			// Deselecting Other keeps the typed text and leaves focus where it is.
			setSel((prev) => ({ ...prev, otherSelected: false, dontKnow: false }));
		} else {
			otherInputRef.current?.focus();
			selectOther();
		}
	};

	const focusRow = (idx: number) => {
		const row = rootRef.current?.querySelector(`[data-kbdrow="${idx}"]`) as HTMLElement | null;
		if (!row) return;
		((row.querySelector("input") as HTMLElement | null) ?? row).focus();
	};

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			const typing =
				!!t &&
				((t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") ||
					t.tagName === "TEXTAREA" ||
					t.isContentEditable);
			const modded = e.altKey || e.metaKey || e.ctrlKey;
			// Tab is ours only from the rows or nowhere; elsewhere (the writing
			// box included) it moves on as usual, so Submit stays reachable.
			const ownsTab = !t || t === document.body || !!t.closest?.("[data-kbdrow]");
			if (rowCount > 0 && e.key === "Tab" && !e.shiftKey && !modded && ownsTab) {
				e.preventDefault();
				e.stopPropagation();
				if (t?.closest?.("[data-kbdrow]")) onLeaveRows();
				else {
					const idx = kbdIdx ?? 0;
					setKbdIdx(idx);
					focusRow(idx);
				}
				return;
			}
			if (typing || modded) return;
			if (/^[0-9]$/.test(e.key) && rowCount > 0) {
				const n = Number(e.key);
				if (n === 0) {
					if (kind !== "quiz") return;
					e.preventDefault();
					setKbdIdx(optionCount);
					toggleDontKnow();
				} else if (n <= optionCount) {
					e.preventDefault();
					setKbdIdx(n - 1);
					toggle(n - 1);
				}
				return;
			}
			if (rowCount > 0 && e.key === "ArrowDown") {
				e.preventDefault();
				const next = Math.min((kbdIdx ?? -1) + 1, rowCount - 1);
				setKbdIdx(next);
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (rowCount > 0 && e.key === "ArrowUp") {
				e.preventDefault();
				const next = Math.max((kbdIdx ?? rowCount) - 1, 0);
				setKbdIdx(next);
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
				// Confidence; dead on "I don't know" (nothing is sent).
				if (kind !== "quiz" || sel.dontKnow) return;
				e.preventDefault();
				setConfIdx((i) => stepConfidence(i, e.key === "ArrowRight" ? 1 : -1));
			} else if (e.key === " ") {
				if (kbdIdx === null) return; // plain Space keeps scrolling
				e.preventDefault();
				kbdAct(kbdIdx);
			} else if (e.key === "Enter") {
				if (kbdIdx === null || !canSubmit) return;
				e.preventDefault();
				// The lesson's own Enter listener must not submit it again.
				e.stopPropagation();
				submit();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	// Keep the walked row visible (the column scrolls).
	useEffect(() => {
		if (kbdIdx === null) return;
		rootRef.current?.querySelector(`[data-kbdrow="${kbdIdx}"]`)?.scrollIntoView({ block: "nearest" });
	}, [kbdIdx]);

	const walked = (i: number, picked: boolean) => i === kbdIdx && !picked && "ring-2 ring-inset ring-ink-3";
	const level = confIdx === undefined ? null : ((confIdx + 1) as ConfidenceLevel);
	const pickedMarks = sel.dontKnow ? null : (
		<>
			{[...sel.selected].map((i) => (
				<OptionMark key={i} picked>
					{letter(i)}
				</OptionMark>
			))}
			{sel.otherSelected && <OptionMark picked />}
		</>
	);

	return (
		<div ref={rootRef} data-testid="question-dock" className="flex shrink-0 flex-col gap-3.5">
			<QuestionText>{qd.question}</QuestionText>
			{qd.context && (
				<div className="shrink-0" style={proseVars(15, 22, true)}>
					<ToolContentResponse>{qd.context}</ToolContentResponse>
				</div>
			)}
			{qd.mode === "multi-select" && !showFolded && <p className="shrink-0 text-[15px] text-ink-2">Select all that apply</p>}

			{showFolded && (
				<PickedRow
					marks={pickedMarks}
					label={
						sel.dontKnow ? (
							"I don't know"
						) : (
							<>
								{[...sel.selected].map((i, n) => (
									<span key={i}>
										{n > 0 && ", "}
										<InlineMath text={qd.options[i]!.label} />
									</span>
								))}
								{sel.otherSelected && `${sel.selected.size > 0 ? ", " : ""}“${other}”`}
							</>
						)
					}
					sure={kind === "quiz" && !sel.dontKnow && <ConfidenceSquares level={level} onChange={(next) => setConfIdx(next - 1)} />}
					onOpen={() => setFolded(false)}
				/>
			)}

			{qd.mode !== "text" && !showFolded && (
				<div className="flex shrink-0 flex-col" role={qd.mode === "multi-select" ? "group" : "radiogroup"}>
					{qd.options.map((opt, i) => {
						const isSel = sel.selected.has(i);
						return (
							<button
								key={opt.value}
								type="button"
								role={qd.mode === "multi-select" ? "checkbox" : "radio"}
								aria-checked={isSel}
								data-kbdrow={i}
								data-testid="question-option"
								onClick={() => toggle(i)}
								className={cn(OPTION_ROW, i > 0 && ROW_RULE, isSel ? PICKED : "hover:bg-tone", walked(i, isSel))}
							>
								<OptionMark picked={isSel}>{letter(i)}</OptionMark>
								<span className="min-w-0 flex-1" style={proseVars(17, 26)}>
									<ToolContentResponse>{opt.label}</ToolContentResponse>
									{kind !== "quiz" && opt.description && (
										// Only an ask's choices carry a second line: on a quiz it
										// would give the answer away.
										<span className="block" style={proseVars(15, 22, true)}>
											<ToolContentResponse>{opt.description}</ToolContentResponse>
										</span>
									)}
								</span>
							</button>
						);
					})}

					{kind === "quiz" && <DontKnowRow data-kbdrow={optionCount} picked={sel.dontKnow} onClick={toggleDontKnow} className={walked(optionCount, sel.dontKnow)} />}

					{kind === "ask" && (
						// The row is only a click target; its radio is the box, so the
						// field isn't nested inside another control.
						<div
							data-kbdrow={optionCount}
							onClick={selectOther}
							className={cn(OPTION_ROW, ROW_RULE, "cursor-text items-center", sel.otherSelected ? PICKED : "hover:bg-tone", walked(optionCount, sel.otherSelected))}
						>
							<button
								type="button"
								role={qd.mode === "multi-select" ? "checkbox" : "radio"}
								aria-checked={sel.otherSelected}
								data-testid="other-option"
								aria-label="Use your own answer"
								className="shrink-0"
							>
								<OptionMark picked={sel.otherSelected} />
							</button>
							<input
								ref={otherInputRef}
								value={other}
								onChange={(e) => {
									setOther(e.target.value);
									// Typing selects the row.
									setSel((prev) => (prev.otherSelected ? prev : toggleOther(selectMode, prev)));
								}}
								onKeyDown={(e) => {
									// Esc leaves the typing (the row stays selected) and is
									// claimed so the window chain doesn't read it as abort.
									if (e.key === "Escape") {
										e.preventDefault();
										e.stopPropagation();
										e.currentTarget.blur();
										setKbdIdx(optionCount);
									}
									// One-line field: Enter submits directly.
									if (e.key === "Enter") {
										e.preventDefault();
										submit();
									}
								}}
								placeholder="Type your own answer"
								aria-label="Your own answer"
								className="lh-input min-w-0 flex-1 bg-transparent font-prose text-[17px]! outline-none placeholder:text-ink-3"
								onClick={(e) => e.stopPropagation()}
							/>
						</div>
					)}
				</div>
			)}

			{kind === "quiz" && !showFolded && <ConfidenceMeter level={level} onChange={(next) => setConfIdx(next - 1)} disabled={sel.dontKnow} />}
		</div>
	);
}

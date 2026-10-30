import { useEffect, useMemo, useRef, useState } from "react";
import { LightbulbIcon } from "lucide-react";
import { useEnterSubmits } from "@/components/enter-submits";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { ConfidenceMeter } from "@/components/confidence-rail";
import { ActionBar, FieldLabel, KindChip, PANEL_FIELD, PanelBody, PanelHeader, fieldKeys } from "@/components/lesson/panel-parts";
import { cn } from "@/lib/utils";
import { useSound } from "@/components/sounds";
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
	type ExplainToolInput,
	type QuestionAnswerData,
	type QuestionFormDraft,
	type QuestionData,
	type QuestionMode,
	type QuizToolInput,
	type SelectMode,
	type WriteCodeInput,
} from "@/core";
import { CodeQuestion } from "@/components/lesson/code-question";

/**
 * THE QUESTION PANEL: a waiting quiz/ask/
 * explain fills the Your-turn panel — "Your turn" with the question's
 * kind, the question, numbered options (keys 1–n, 0 = I don't know), the
 * 5-bar confidence meter (quiz only; ←/→ or click), "Your thinking", and
 * the full-width "Submit answer · Enter" bar.
 *
 * "Your thinking" is the transfer channel of the whole product: never
 * called optional; Enter submits, Shift+Enter is a newline. The ask
 * "Other…" option is an editable row, so picking Other never displaces
 * the thinking. A write_code question has its own form (CodeQuestion).
 */

export interface QuestionDockProps {
	toolName: "quiz" | "probe" | "ask_user_question" | "explain" | "recall" | "write_code";
	toolCallId: string;
	input: QuizToolInput | AskToolInput | ExplainToolInput | WriteCodeInput;
	onSubmit: (output: QuestionAnswerData) => void;
	/** Restore only this call's unconfirmed submission after recovery. */
	initialDraft?: QuestionFormDraft;
	onSaveDraft?: (draft: QuestionFormDraft) => void;
	/** Compaction is running for this chat: the answer would block on the
	 *  server's compaction gate, so submit waits (the server is the real gate). */
	compactionRunning?: boolean;
	/** A quiet row under the field (the lesson's stats). */
	footer?: React.ReactNode;
}

/** The kind chip's label. The probe-phase names keep their own labels;
 *  a predict-type quiz reads "Prediction". */
export function questionKindLabel(toolName: QuestionDockProps["toolName"], input: unknown): string {
	if (toolName === "probe") return "Probe";
	if (toolName === "recall") return "Recall";
	if (toolName === "quiz") return normalizeQuizType((input as { type?: unknown } | null)?.type) === "predict" ? "Prediction" : "Check";
	if (toolName === "explain") return "Explain";
	if (toolName === "write_code") return "Code";
	return "Question";
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
			<PanelBody>
				<PanelHeader eyebrow="Your turn" />
				<div data-testid="malformed-question" className="mt-3 bg-tone px-3.5 py-3 text-sm text-ink-2">
					This question arrived malformed. The transcript keeps the retry.
				</div>
			</PanelBody>
		);
	}
	if (canonical === "write_code") return <CodeQuestion {...props} input={parsed as WriteCodeInput} />;
	return <QuestionDockForm {...props} input={parsed as QuizToolInput | AskToolInput | ExplainToolInput} />;
}

/** A picked row inverts: ink background, page-colored text. */
const PICKED_INK = "var(--background)";
const PICKED_TINT = "color-mix(in srgb, var(--background) 12%, transparent)";

/** Lesson prose at a given size and color (the markdown renderer reads
 *  these variables), for the question and option text. */
function proseVars(size: number, leading: number, ink?: string): React.CSSProperties {
	return {
		"--lh-prose-size": `${size}px`,
		"--lh-prose-leading": `${leading / size}`,
		...(ink ? { "--lh-ink-body": ink, "--lh-ink-strong": ink, "--lh-ink-italic": ink } : {}),
		// Bold words' block and inline code's block, made readable on the
		// inverted picked row (their dark fills would hide the dark text).
		...(ink === PICKED_INK ? { "--lh-mark-bg": PICKED_TINT, "--muted": PICKED_TINT } : {}),
	} as React.CSSProperties;
}

const OPTION_ROW = "lh-press flex w-full items-start gap-3 px-3.5 py-3 text-left outline-none transition-colors duration-(--lh-dur) ease-(--lh-ease-out)";

function KeyBox({ n, selected, outlined }: { n: React.ReactNode; selected: boolean; outlined?: boolean }) {
	return (
		<span
			aria-hidden
			className={cn(
				"flex size-6 shrink-0 items-center justify-center font-mono text-[13px] tabular-nums",
				selected
					? "bg-background font-bold text-ink"
					: outlined
						? "outline outline-1 -outline-offset-1 outline-tone-2 text-ink-3"
						: "bg-tone-2 font-bold text-ink-2",
			)}
		>
			{n}
		</span>
	);
}

/** The question form: everything in the panel while a question waits. */
function QuestionDockForm({
	toolName,
	toolCallId,
	input,
	onSubmit,
	initialDraft,
	onSaveDraft,
	compactionRunning = false,
	footer,
}: Omit<QuestionDockProps, "input"> & { input: QuizToolInput | AskToolInput | ExplainToolInput }) {
	const kind = toolQuestionKind(toolName);
	const play = useSound();

	// Canonical QuestionData, built once per question. Quiz options are
	// shuffled deterministically (seeded by toolCallId) so position never
	// leaks correctness and server/client agree; the display order is
	// snapshotted into the answer at submit.
	const qd = useMemo<QuestionData>(() => {
		const quizInput = kind === "quiz" ? (input as QuizToolInput) : null;
		const askInput = kind === "ask" ? (input as AskToolInput) : null;
		const explainInput = kind === "explain" ? (input as ExplainToolInput) : null;
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
			id: toolCallId,
			kind,
			questionType: kind === "quiz" ? normalizeQuizType((input as { type?: unknown }).type) : undefined,
			question: input.question,
			context: input.details,
			mode,
			options: ordered,
			createdAt: new Date().toISOString(),
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
	const [thinking, setThinking] = useState(initialDraft?.thinking ?? "");
	const [other, setOther] = useState(initialDraft?.other ?? "");
	const [text, setText] = useState(initialDraft?.text ?? "");
	// Refs mirror the two text fields: submit (also reached from the
	// window-level Enter) reads these.
	const thinkingTextRef = useRef(initialDraft?.thinking ?? "");
	const answerTextRef = useRef(initialDraft?.text ?? "");
	// Confidence: an index into CONFIDENCE_STOPS (level − 1), unset until
	// the learner picks one.
	const [confIdx, setConfIdx] = useState<number | undefined>(initialDraft?.confidenceIndex);
	const selectMode: SelectMode = qd.mode === "multi-select" ? "multi-select" : "single-select";

	const toggle = (idx: number) => setSel(toggleOption(selectMode, sel, idx));
	const toggleDontKnow = () =>
		setSel((prev) => ({ ...prev, selected: new Set(), otherSelected: false, dontKnow: !prev.dontKnow }));

	const canSubmit =
		qd.mode === "text"
			? text.trim().length > 0
			: sel.dontKnow || (sel.otherSelected && other.trim().length > 0) || sel.selected.size > 0;

	const submit = () => {
		if (!canSubmit || compactionRunning) return;
		const req: AnswerRequest = {
			dontKnow: sel.dontKnow,
			values: [...sel.selected].map((i) => qd.options[i]!.value),
			other: sel.otherSelected ? other : undefined,
			text: qd.mode === "text" ? answerTextRef.current : undefined,
			thinking: qd.mode !== "text" ? thinkingTextRef.current.trim() || undefined : undefined,
			// Sent only once picked; buildAnswer drops it on "I don't know".
			confidence: kind === "quiz" && confIdx !== undefined ? CONFIDENCE_STOPS[confIdx] : undefined,
		};
		// Snapshot before the optimistic submission unmounts the form.
		onSaveDraft?.({
			selection: { ...sel, selected: new Set(sel.selected) },
			thinking: thinkingTextRef.current,
			other,
			text: answerTextRef.current,
			confidenceIndex: confIdx,
		});
		const answer = buildAnswer(qd, req, toolName);
		const sound = answerSound(answer);
		if (sound) play(sound);
		onSubmit(answer);
	};

	// Enter submits from anywhere outside a typing surface.
	useEnterSubmits(submit);

	const selectOther = () => setSel(toggleOther(selectMode, sel));

	/* ── The keyboard machine ──
	   1–9 pick an option, 0 = "I don't know" (quiz). ↑/↓ walk every row,
	   clamped at the ends; Space acts on the walked row like a click; Enter
	   submits once an answer exists. ←/→ move the confidence level. Tab
	   toggles focus between the rows and the thinking field (Shift+Tab is
	   the global thinking-level cycle's). Keys typed into a field keep their
	   meaning, and modifier combos are never ours. */
	const [kbdIdx, setKbdIdx] = useState<number | null>(null);
	const rootRef = useRef<HTMLFormElement>(null);
	const otherInputRef = useRef<HTMLInputElement>(null);
	const thinkingRef = useRef<HTMLTextAreaElement>(null);
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
			if (rowCount > 0 && e.key === "Tab" && !e.shiftKey && !modded) {
				e.preventDefault();
				e.stopPropagation();
				if (t?.closest?.("[data-kbdrow]")) thinkingRef.current?.focus();
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
				submit();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	// Keep the walked row visible (the panel scrolls internally).
	useEffect(() => {
		if (kbdIdx === null) return;
		rootRef.current?.querySelector(`[data-kbdrow="${kbdIdx}"]`)?.scrollIntoView({ block: "nearest" });
	}, [kbdIdx]);

	const label = questionKindLabel(toolName, input);
	const walked = (i: number, selected: boolean) => i === kbdIdx && !selected && "ring-1 ring-inset ring-ink-3";

	return (
		<form
			ref={rootRef}
			data-testid="question-dock"
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<PanelBody>
				<PanelHeader
					eyebrow="Your turn"
					right={
						<KindChip testId="question-kind">
							{label === "Prediction" && <LightbulbIcon aria-hidden className="size-3.5" />}
							{label}
						</KindChip>
					}
				/>
				<div data-session-find-root="" className="mt-3 shrink-0 font-bold text-ink" style={proseVars(18, 25, "var(--foreground)")}>
					<ToolContentResponse>{qd.question}</ToolContentResponse>
				</div>
				{qd.context && (
					<div className="mt-2 shrink-0 text-ink-2" style={proseVars(14, 20, "var(--muted-foreground)")}>
						<ToolContentResponse>{qd.context}</ToolContentResponse>
					</div>
				)}
				{qd.mode === "multi-select" && <div className="mt-2 shrink-0 text-[13px] text-ink-3">Select all that apply</div>}

				{qd.mode !== "text" && (
					<div className="mt-4 flex shrink-0 flex-col gap-0.5" role={qd.mode === "multi-select" ? "group" : "radiogroup"}>
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
									className={cn(OPTION_ROW, isSel ? "bg-ink font-bold" : "bg-tone hover:bg-tone-2/60", walked(i, isSel))}
								>
									<KeyBox n={i + 1} selected={isSel} />
									<span className="min-w-0 flex-1 pt-0.5" style={proseVars(15, 21, isSel ? PICKED_INK : "var(--foreground)")}>
										<ToolContentResponse>{opt.label}</ToolContentResponse>
										{kind !== "quiz" && opt.description && (
											// Ask-option subtext (quiz options carry none — the model
											// used them to telegraph correctness).
											<span className="mt-0.5 block" style={proseVars(13, 18, isSel ? PICKED_INK : "var(--muted-foreground)")}>
												<ToolContentResponse>{opt.description}</ToolContentResponse>
											</span>
										)}
									</span>
								</button>
							);
						})}

						{kind === "quiz" && (
							<button
								type="button"
								data-kbdrow={optionCount}
								data-testid="dont-know-option"
								aria-pressed={sel.dontKnow}
								onClick={toggleDontKnow}
								className={cn(
									OPTION_ROW,
									"items-center py-2.5",
									sel.dontKnow ? "bg-ink font-bold text-background" : "text-ink-2 hover:bg-tone",
									walked(optionCount, sel.dontKnow),
								)}
							>
								<KeyBox n={0} selected={sel.dontKnow} outlined />
								<span className="text-[15px]">I don't know</span>
							</button>
						)}

						{kind === "ask" && (
							<div
								role={qd.mode === "multi-select" ? "checkbox" : "radio"}
								aria-checked={sel.otherSelected}
								data-testid="other-option"
								data-kbdrow={optionCount}
								onClick={selectOther}
								className={cn(
									OPTION_ROW,
									"cursor-text items-center py-2.5",
									sel.otherSelected ? "bg-ink text-background" : "hover:bg-tone",
									walked(optionCount, sel.otherSelected),
								)}
							>
								<KeyBox n="" selected={sel.otherSelected} outlined />
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
									placeholder="Type your own answer…"
									className={cn(
										"lh-input min-w-0 flex-1 bg-transparent text-[15px]! outline-none",
										sel.otherSelected ? "placeholder:text-background/50" : "placeholder:text-ink-3",
									)}
									onClick={(e) => e.stopPropagation()}
								/>
							</div>
						)}
					</div>
				)}

				{kind === "quiz" && (
					<div className="mt-[18px] shrink-0">
						<ConfidenceMeter
							level={confIdx === undefined ? null : ((confIdx + 1) as ConfidenceLevel)}
							onChange={(level) => setConfIdx(level - 1)}
							disabled={sel.dontKnow}
						/>
					</div>
				)}

				<div className="mt-[18px] flex min-h-0 flex-1 flex-col" data-testid={qd.mode === "text" ? "answer-field" : "thinking-field"}>
					<FieldLabel>{qd.mode === "text" ? "Your answer" : "Your thinking"}</FieldLabel>
					{qd.mode === "text" ? (
						<textarea
							value={text}
							onChange={(e) => {
								answerTextRef.current = e.target.value;
								setText(e.target.value);
							}}
							onKeyDown={(e) => fieldKeys(e, submit)}
							placeholder="Type your answer…"
							aria-label="Your answer"
							className={PANEL_FIELD}
						/>
					) : (
						<textarea
							ref={thinkingRef}
							value={thinking}
							onChange={(e) => {
								thinkingTextRef.current = e.target.value;
								setThinking(e.target.value);
							}}
							onKeyDown={(e) => fieldKeys(e, submit)}
							placeholder="Why this answer? Whatever comes to mind."
							aria-label="Your thinking"
							className={PANEL_FIELD}
						/>
					)}
				</div>
				{footer}
			</PanelBody>
			<ActionBar
				type="submit"
				testId="question-submit"
				label={compactionRunning ? "Compacting the lesson…" : "Submit answer"}
				disabled={!canSubmit || compactionRunning}
			/>
		</form>
	);
}

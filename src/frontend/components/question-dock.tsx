import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { proseVars, QuestionText } from "@/frontend/components/lesson/question-parts";
import { ChoiceRows, OptionMark, SelectAllHint } from "@/frontend/components/lesson/choice-rows";
import { choiceLetter } from "@/frontend/components/lesson/problem-choices-model";
import { typingIn, useChoiceKeys } from "@/frontend/components/lesson/use-choice-keys";
import { ConfidenceLine } from "@/frontend/components/confidence-line";
import { InlineMath } from "@/frontend/components/overview/inline-math";
import { PickedRow } from "@/frontend/components/lesson/picked-row";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { useSound } from "@/frontend/components/sounds";
import {
	answerSound,
	buildAnswer,
	normalizeQuizType,
	CONFIDENCE_STOPS,
	dontKnowRequest,
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
 * THE WAITING QUESTION, above the lesson's writing row: the question, the
 * largest text on the page, with its kind as a small tag; its lettered
 * choices (keys 1–n); and, once a quiz answer is picked, the "How sure?"
 * line (←/→ or click). It holds no text box
 * and no buttons of its own: the writing box under it carries the
 * reasoning (or the whole answer, for a question answered in words) and
 * "Submit answer". An ask with choices takes the box's text as the
 * learner's own answer when no choice is picked.
 *
 * A write_code question has its own form (CodeQuestion).
 */

/** What the writing box asks of the question above it. */
export interface QuestionHandle {
	/** Sends the answer with the box's text. */
	submit(): void;
	/** Answers "I don't know", with the box's text as the reasoning. */
	dontKnow(): void;
	/** The learner started writing: an answered list folds into one row. */
	fold(): void;
	/** The option labels picked so far, in the order shown. */
	picked(): string[];
}

export interface QuestionDockProps {
	toolName: "quiz" | "probe" | "ask_user_question" | "explain" | "recall" | "write_code";
	toolCallId: string;
	/** The question's kind in a word ("Quiz", "From earlier"), set after its text. */
	tag: string | null;
	/** Skips a question that came through broken, which cannot be answered. */
	onSkip: () => void;
	input: unknown;
	onSubmit: (output: QuestionAnswerData) => void;
	/** The picks as the learner left them (this call's saved draft). */
	initialDraft?: QuestionFormDraft;
	/** Called on every change, so the picks survive leaving the lesson. */
	onSaveDraft?: (draft: QuestionFormDraft) => void;
	/** Whether an answer is picked, so the box's "Submit answer" follows it. */
	onReady: (ready: boolean) => void;
	/** What the writing box holds: the reasoning, or the answer itself for
	 *  a question answered in words (and an ask with nothing picked). */
	boxText: string;
	/** Tab from the choices goes to the writing box. */
	onLeaveRows: () => void;
	/** The teacher is replying to a side question: submit waits. */
	busy?: boolean;
	ref?: React.Ref<QuestionHandle>;
}

export function QuestionDock(props: QuestionDockProps) {
	const { toolName, input } = props;
	// Parse, don't cast: the model authored this input. Anything that slips
	// past the bridge's validation renders the quiet fallback, never a crash.
	const kind = toolQuestionKind(toolName);
	const parsed =
		kind === "quiz"
			? parseQuizInput(input)
			: kind === "explain"
				? parseExplainInput(input)
				: kind === "code"
					? parseWriteCodeInput(input)
					: parseAskInput(input);
	if (!parsed) {
		return (
			<div data-testid="malformed-question" className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 lh-well lh-notch px-4 py-3 text-base text-ink-2">
				This question came through broken.
				<button type="button" data-testid="skip-broken-question" onClick={props.onSkip} className="lh-btn lh-btn-small shrink-0">
					Skip question
				</button>
			</div>
		);
	}
	if (kind === "code") return <CodeQuestion {...props} input={parsed as WriteCodeInput} />;
	return <QuestionDockForm {...props} input={parsed as QuizDisplayInput | AskToolInput | ExplainDisplayInput} />;
}

/** A question with its choices (or, answered in words, the question alone). */
function QuestionDockForm({
	toolName,
	toolCallId,
	tag,
	input,
	onSubmit,
	initialDraft,
	onSaveDraft,
	onReady,
	boxText,
	onLeaveRows,
	busy = false,
	ref,
}: Omit<QuestionDockProps, "input" | "onSkip"> & { input: QuizDisplayInput | AskToolInput | ExplainDisplayInput }) {
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
		const hasChoices = kind === "quiz" || Boolean(askInput?.options?.length);
		const mode: QuestionMode = !hasChoices ? "text" : multi ? "multi-select" : "single-select";
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

	// The selection machine lives in question-dock-state (pure, tested).
	const [sel, setSel] = useState<DockSelection>(() => initialDraft?.selection ?? emptyDockSelection());
	// Confidence: an index into CONFIDENCE_STOPS (level − 1), unset until
	// the learner picks one.
	const [confIdx, setConfIdx] = useState<number | undefined>(initialDraft?.confidenceIndex);
	const selectMode: SelectMode = qd.mode === "multi-select" ? "multi-select" : "single-select";
	// How sure is asked once a quiz answer is picked.
	const rated = kind === "quiz" && sel.selected.size > 0;

	// Every change is saved, so leaving the lesson keeps the picks.
	const saveDraftRef = useRef(onSaveDraft);
	saveDraftRef.current = onSaveDraft;
	useEffect(() => {
		saveDraftRef.current?.({ selection: sel, confidenceIndex: confIdx });
	}, [sel, confIdx]);

	const toggle = (idx: number) => setSel(toggleOption(selectMode, sel, idx));

	const picked = sel.selected.size > 0;
	// An ask with nothing picked takes the box's text as its own answer.
	const ownAnswer = kind === "ask" && qd.mode !== "text" && !picked;
	// Answered in words, the box decides when there is an answer.
	const canSubmit = qd.mode === "text" || picked || (ownAnswer && boxText.trim().length > 0);
	const readyRef = useRef(onReady);
	readyRef.current = onReady;
	useEffect(() => {
		readyRef.current(canSubmit);
		return () => readyRef.current(false);
	}, [canSubmit]);

	// Writing with an answer picked folds the list into one row (Change opens it).
	const [folded, setFolded] = useState(false);
	const showFolded = folded && picked && qd.mode !== "text";

	const answer = (req: AnswerRequest) => {
		const built = buildAnswer(qd, req, toolName);
		const sound = answerSound(built);
		if (sound) play(sound);
		onSubmit(built);
	};
	const submit = () => {
		if (!canSubmit || busy) return;
		answer({
			values: [...sel.selected].map((i) => qd.options[i]!.value),
			other: ownAnswer ? boxText : undefined,
			text: qd.mode === "text" ? boxText : undefined,
			thinking: qd.mode !== "text" && !ownAnswer ? boxText.trim() || undefined : undefined,
			// Sent only once picked.
			confidence: kind === "quiz" && confIdx !== undefined ? CONFIDENCE_STOPS[confIdx] : undefined,
		});
	};
	useImperativeHandle(ref, () => ({
		submit,
		dontKnow() {
			if (!busy) answer(dontKnowRequest(qd, boxText));
		},
		fold() {
			if (picked) setFolded(true);
		},
		picked: () => [...sel.selected].sort((a, b) => a - b).map((i) => qd.options[i]!.label),
	}));

	// The rows' keys (use-choice-keys); ←/→ move the confidence level once an answer is
	// picked (its line shows then).
	const rowCount = qd.mode === "text" ? 0 : qd.options.length;
	const { rootRef, walked } = useChoiceKeys({ count: rowCount, toggle, onLeaveRows, onEnter: canSubmit ? submit : null });
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if ((e.key !== "ArrowLeft" && e.key !== "ArrowRight") || !rated || typingIn(e.target as HTMLElement | null) || e.altKey || e.metaKey || e.ctrlKey) return;
			e.preventDefault();
			setConfIdx((i) => stepConfidence(i, e.key === "ArrowRight" ? 1 : -1));
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	// A picked quiz answer is rated next; its line can sit below the fold.
	const sureRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (rated) sureRef.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
	}, [rated]);

	const level = confIdx === undefined ? null : ((confIdx + 1) as ConfidenceLevel);
	const pickedMarks = [...sel.selected].map((i) => (
		<OptionMark key={i} picked>
			{choiceLetter(i)}
		</OptionMark>
	));

	return (
		<div ref={rootRef} data-testid="question-dock" className="flex flex-col gap-6">
			<QuestionText tag={tag}>{qd.question}</QuestionText>
			{qd.context && (
				<div className="-mt-4" style={proseVars(16, 24, true)}>
					<ToolContentResponse>{qd.context}</ToolContentResponse>
				</div>
			)}
			{qd.mode === "multi-select" && !showFolded && <SelectAllHint />}

			{showFolded && (
				<PickedRow
					marks={pickedMarks}
					label={[...sel.selected].map((i, n) => (
						<span key={i}>
							{n > 0 && ", "}
							<InlineMath text={qd.options[i]!.label} />
						</span>
					))}
					onOpen={() => setFolded(false)}
				/>
			)}

			{qd.mode !== "text" && !showFolded && (
				<ChoiceRows
					// Only an ask's choices carry a second line: on a quiz it would give the answer away.
					options={kind === "quiz" ? qd.options.map(({ label }) => ({ label })) : qd.options}
					selected={sel.selected}
					multi={qd.mode === "multi-select"}
					walked={walked}
					onToggle={toggle}
				/>
			)}

			{rated && <ConfidenceLine ref={sureRef} level={level} onChange={(next) => setConfIdx(next - 1)} />}
		</div>
	);
}

import { useState } from "react";
import { blurAfterPointerClick } from "@/frontend/components/focus-hygiene";
import { usePrint } from "@/frontend/components/presence";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { chip } from "@/frontend/components/ui/chip";
import { ThinkingBlock } from "@/frontend/components/thinking-block";
import { useFold } from "@/frontend/components/use-fold";
import { cn } from "@/frontend/lib/utils";
import { MessageResponse, ToolContentResponse } from "@/frontend/components/ai-elements/message";
import type { QuestionAnswerData } from "@/shared/core";
import { answerForPresentation, confidenceLevel, fencedCode, parseAskInput, parseQuizInput } from "@/shared/core";
import { answeredKindLabel, guessResultLine, isPrediction } from "./answered-card-model";

/** Lesson prose at a given size/leading/color (the markdown renderer reads
 *  these variables). */
export function proseVars(size: number, leading: number, ink: string): React.CSSProperties {
	return { "--lh-prose-size": `${size}px`, "--lh-prose-leading": `${leading / size}`, "--lh-ink-body": ink } as React.CSSProperties;
}

/** The board names a prediction as the learner's own; other kinds keep their word. */
const kindWords = (label: string) => (label === "Prediction" ? "Your prediction" : label);

/** The verdict tag: Right / Wrong / Didn't know (quiz answers only; a
 *  prediction is never marked). One just given (`fresh` as it is first drawn) prints its rows. */
export function ResultChip({ answer, fresh = false }: { answer: QuestionAnswerData; fresh?: boolean }) {
	const [tone, word] = answer.dontKnow ? (["plain", "Didn't know"] as const) : answer.correct ? (["right", "Right"] as const) : (["wrong", "Wrong"] as const);
	const print = usePrint(fresh);
	return (
		<span data-testid="answer-result" onAnimationEnd={print.onAnimationEnd} className={cn(chip(tone, "tag"), print.className)}>
			{word}
		</span>
	);
}

/** A graded quiz answer's Why: the options with his pick and the right
 *  one marked, his thinking and the explanation. */
export function QuizWhy({ answer }: { answer: QuestionAnswerData }) {
	const selectedIdx = new Set(answer.answers.map((a) => a.index));
	const correctIdx = new Set(answer.correctIndices ?? []);
	const thinking = answer.thinking ?? answer.note;
	return (
		<>
			{(answer.options?.length ?? 0) > 0 && (
				<div className="flex flex-col gap-1 text-ui">
					{answer.options?.map((opt) => {
						const sel = selectedIdx.has(opt.index);
						const key = correctIdx.has(opt.index);
						return (
							<div
								key={opt.index}
								data-testid="answered-option"
								className={cn("flex items-center gap-2.5 lh-notch bg-panel px-3 py-2", sel && "ring-2 ring-inset", sel && key && "ring-ans-right", sel && !key && "ring-ans-wrong")}
							>
								<span
									aria-hidden
									data-mark={key ? "check" : sel ? "x" : undefined}
									className={cn("flex w-3.5 shrink-0 items-center", key ? "text-ans-right" : "text-ans-wrong")}
								>
									{(key || sel) && <PixelIcon name={key ? "check" : "close"} />}
								</span>
								<span className={cn(!sel && !key && "text-ink-2")}>
									<ToolContentResponse>{opt.label}</ToolContentResponse>
								</span>
							</div>
						);
					})}
					{answer.dontKnow && <div className="px-3 py-1 text-ink-2">Answered “I don't know”.</div>}
				</div>
			)}
			{thinking && <ThinkingBlock testId="your-thinking" text={thinking} inCard />}
			{answer.explanation && (
				<div data-testid="tucked-explanation" className="lh-notch bg-panel px-3 py-2 text-ui text-ink-2">
					<ToolContentResponse className="[&>p:first-child]:mt-0">{answer.explanation}</ToolContentResponse>
				</div>
			)}
		</>
	);
}

/** Text squeezed onto one line that ends in an ellipsis; its math and code still draw. */
const ONE_LINE = "max-h-7 min-w-0 truncate [&>div]:inline [&>div]:whitespace-nowrap [&_p]:m-0 [&_p]:inline [&_pre]:inline [&_pre]:whitespace-pre";

/**
 * An answered question in the lesson, shrunk to one line: the verdict, the
 * question and what he picked or said, on a plate. A prediction has no
 * verdict; under the line it names the right answer when he missed, and on
 * a plot what the line gives. A click on the line opens the rest: the
 * question whole, "Quiz, sure 4 of 5", his written answer or code, the
 * graded options and the explanation (quiz), the committed answer
 * (explain), his thinking.
 *
 * Quiz answers are GRADED; ask answers are a plain record of what was
 * said (never graded); explain and code answers are graded by the teacher
 * in its next reply, so the line shows no verdict.
 */
export function AnsweredCard({
	answer: savedAnswer,
	input,
	defaultOpen = false,
	plotValue,
}: {
	answer: QuestionAnswerData;
	input?: unknown;
	/** Start with the details open (the toggle still closes them). */
	defaultOpen?: boolean;
	/** A plot guess: the drawn value it asked about (plot-view.ts). */
	plotValue?: number;
}) {
	const answer = answerForPresentation(savedAnswer, input);
	const [open, setOpen] = useState(defaultOpen);
	const fold = useFold(open);
	if (answer.dismissed) {
		return (
			<div data-testid="answered-card" className="flex items-baseline gap-1.5 text-ui text-ink-2">
				<span className="shrink-0">Skipped:</span>
				<div className={cn(ONE_LINE, "flex-1")}>
					<ToolContentResponse>{answer.questionText}</ToolContentResponse>
				</div>
			</div>
		);
	}

	const isQuiz = answer.kind === "quiz";
	const isExplain = answer.kind === "explain";
	const isAsk = answer.kind === "ask";
	const isCode = answer.kind === "code";
	const selectedIdx = new Set(answer.answers.map((a) => a.index));
	// The question's own context rides the ORIGINAL CALL:
	// the details line and ask option descriptions re-render from the call.
	const askInput = isAsk ? parseAskInput(input) : undefined;
	const parsedDetails = askInput?.details ?? (isQuiz ? parseQuizInput(input)?.details : undefined);
	const descByIndex = new Map((askInput?.options ?? []).map((o, i) => [i + 1, o.description]));
	const thinking = answer.thinking ?? answer.note;
	// What he picked or said stays on the line (it is the record); a quiz's right answer waits behind it.
	const said = isAsk || isQuiz ? (answer.options ?? []).filter((o) => selectedIdx.has(o.index)) : [];
	const resultLine = guessResultLine(answer, input, plotValue);
	const toggle = () => setOpen((v) => !v);

	return (
		<div data-testid="answered-card" className="lh-well lh-notch text-card-foreground">
			{/* The whole line opens the card for the mouse; the key at its end is the one the keyboard and a reader find. */}
			<div
				onClick={(e) => {
					if (!(e.target as Element).closest("a, button")) toggle();
				}}
				className="flex cursor-pointer items-baseline gap-3 px-4 py-2.5"
			>
				{isQuiz && !isPrediction(answer) && <ResultChip answer={answer} />}
				<div className={cn("min-w-0 flex-1 text-ink-2", !open && ONE_LINE)} style={proseVars(16, 24, "var(--muted-foreground)")}>
					<ToolContentResponse>{answer.questionText}</ToolContentResponse>
				</div>
				{/* His written answer starts on the line and is whole once the card is open. */}
				{answer.text && !open && (
					<div data-testid="answered-text" className="max-w-[45%] min-w-0 truncate text-ink">
						“{answer.text}”
					</div>
				)}
				{(said.length > 0 || answer.other) && (
					<div data-testid="answered-said" className={cn("flex max-w-[45%] min-w-0 flex-col items-end text-right text-ink", !open && ONE_LINE)} style={proseVars(16, 24, "var(--foreground)")}>
						{said.map((o) => (
							<div key={o.index} data-testid="answered-pick" className={cn(!open && "inline after:content-['_'] last:after:content-none")}>
								<ToolContentResponse>{o.label}</ToolContentResponse>
							</div>
						))}
						{/* The learner's own typed answer, quoted (the learner's words). */}
						{answer.other && (
							<div data-testid="answered-other" className={cn(!open && "inline")}>
								“{answer.other}”
							</div>
						)}
					</div>
				)}
				<button
					type="button"
					data-testid="answer-toggle"
					aria-expanded={open}
					aria-label={isQuiz ? "Why" : isExplain ? "Answer" : "Details"}
					onClick={(e) => {
						toggle();
						blurAfterPointerClick(e);
					}}
					className="lh-press grid size-6 shrink-0 place-items-center self-center text-ink-2 outline-none"
				>
					<PixelIcon name="chevron" className={cn("transition-transform duration-(--lh-dur) ease-(--lh-ease-out)", open ? "-rotate-90" : "rotate-90")} />
				</button>
			</div>
			{resultLine && (
				<div data-testid="guess-result" className="px-4 pb-2.5 text-ink" style={proseVars(16, 24, "var(--foreground)")}>
					<ToolContentResponse>{resultLine}</ToolContentResponse>
				</div>
			)}

			{fold.mounted && (
				<div className="lh-collapse" data-state={fold.state} data-testid="answer-details">
					<div className="flex flex-col gap-2.5 px-4 pb-4">
						<span className="font-count text-ui text-ink-2">
							<span data-testid="answer-kind">{kindWords(answeredKindLabel(answer))}</span>
							{isQuiz && !answer.dontKnow && answer.confidence != null && <span data-testid="answered-confidence">, sure {confidenceLevel(answer.confidence)} of 5</span>}
						</span>
						{answer.text && <div className="lh-prose whitespace-pre-wrap text-ink">“{answer.text}”</div>}
						{isCode && answer.code && (
							<div data-testid="answered-code">
								<MessageResponse>{fencedCode(answer.code, answer.language ?? "")}</MessageResponse>
							</div>
						)}
						{(isCode || isExplain) && answer.dontKnow && <div className="text-ui text-ink-2">Answered “I don't know”.</div>}
						{parsedDetails && (
							<div className="text-ink-2" style={proseVars(15, 22, "var(--muted-foreground)")}>
								<ToolContentResponse>{parsedDetails}</ToolContentResponse>
							</div>
						)}
						{isQuiz ? (
							<QuizWhy answer={answer} />
						) : (
							<>
								{isAsk && descByIndex.size > 0 && (
									<div className="flex flex-col gap-1 text-ui">
										{/* The wrappers keep each text block's height auto: inside the
										    fold's grid, the renderer's full height would otherwise fill
										    the row and push the description under the next option. */}
										{answer.options?.map((opt) => (
											<div key={opt.index} className="lh-notch bg-panel px-3 py-2">
												<div style={proseVars(15, 22, selectedIdx.has(opt.index) ? "var(--foreground)" : "var(--muted-foreground)")}>
													<ToolContentResponse>{opt.label}</ToolContentResponse>
												</div>
												{descByIndex.get(opt.index) && (
													<div className="mt-0.5" style={proseVars(14, 20, "var(--muted-foreground)")}>
														<ToolContentResponse>{descByIndex.get(opt.index)}</ToolContentResponse>
													</div>
												)}
											</div>
										))}
									</div>
								)}
								{thinking && <ThinkingBlock testId="your-thinking" text={thinking} inCard />}
								{isExplain && answer.committed && (
									<div data-testid="committed-answer" className="lh-notch bg-panel px-3 py-2 text-ui text-ink-2">
										<span className="font-medium text-ink">The answer: </span>
										<ToolContentResponse className="inline [&>p:first-child]:m-0 [&>p:first-child]:inline">{answer.committed}</ToolContentResponse>
									</div>
								)}
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

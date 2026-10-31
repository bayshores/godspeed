import { useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { GlyphMark } from "@/components/ui/glyph-mark";
import { ThinkingBlock } from "@/components/thinking-block";
import { useFold } from "@/components/use-fold";
import { useStepNumber } from "@/components/lesson/step-context";
import { cn } from "@/lib/utils";
import { MessageResponse, ToolContentResponse } from "@/components/ai-elements/message";
import type { QuestionAnswerData } from "@/core";
import { answerForPresentation, confidenceLevel, fencedCode, parseAskInput, parseQuizInput, questionKindLabel } from "@/core";

/** Lesson prose at a given size/leading/color (the markdown renderer reads
 *  these variables). */
function proseVars(size: number, leading: number, ink: string): React.CSSProperties {
	return { "--lh-prose-size": `${size}px`, "--lh-prose-leading": `${leading / size}`, "--lh-ink-body": ink } as React.CSSProperties;
}

/** Old answers carry no tool name: their kind stands in for it. */
const KIND_TOOL = { quiz: "quiz", explain: "explain", code: "write_code", ask: "ask" } as const;

/** The verdict chip: Right / Wrong / Didn't know (quiz answers only). */
function ResultChip({ answer }: { answer: QuestionAnswerData }) {
	const [cls, icon, word] = answer.dontKnow
		? ["bg-ans-dontknow text-ink", null, "Didn't know"]
		: answer.correct
			? ["bg-ans-right text-black", <CheckIcon key="i" aria-hidden className="size-3.5" strokeWidth={3} />, "Right"]
			: ["bg-ans-wrong text-black", <XIcon key="i" aria-hidden className="size-3.5" strokeWidth={3} />, "Wrong"];
	return (
		<span data-testid="answer-result" className={cn("flex shrink-0 items-center gap-1.5 px-2 py-[3px] text-[13px] font-extrabold", cls)}>
			{icon}
			{word}
		</span>
	);
}

/**
 * An answered question in the lesson: one
 * compact card — "Right · Check · step 10 · Sure 4 · Why ▾" over the
 * question. The rest opens under the toggle: the graded options and the
 * explanation (quiz), the committed answer (explain), the learner's
 * thinking.
 *
 * Quiz answers are GRADED; ask answers are a plain record of what was
 * said (never graded); explain and code answers are graded by the teacher
 * in its next reply, so the card shows no verdict.
 * A code answer shows the learner's code as a highlighted block.
 */
export function AnsweredCard({
	answer: savedAnswer,
	input,
	defaultOpen = false,
}: {
	answer: QuestionAnswerData;
	input?: unknown;
	/** Start with the details open (the toggle still closes them). */
	defaultOpen?: boolean;
}) {
	const answer = answerForPresentation(savedAnswer, input);
	const [open, setOpen] = useState(defaultOpen);
	const fold = useFold(open);
	const step = useStepNumber(input);
	if (answer.dismissed) {
		return (
			<div data-testid="answered-card" className="bg-panel px-4 py-3.5 text-sm text-ink-3">
				<span className="text-ink-2">{answer.questionText}</span> (skipped)
			</div>
		);
	}

	const isQuiz = answer.kind === "quiz";
	const isExplain = answer.kind === "explain";
	const isAsk = answer.kind === "ask";
	const isCode = answer.kind === "code";
	const selectedIdx = new Set(answer.answers.map((a) => a.index));
	const correctIdx = new Set(answer.correctIndices ?? []);
	// The question's own context rides the ORIGINAL CALL:
	// the details line and ask option descriptions re-render from the call.
	const askInput = isAsk ? parseAskInput(input) : undefined;
	const parsedDetails = askInput?.details ?? (isQuiz ? parseQuizInput(input)?.details : undefined);
	const descByIndex = new Map((askInput?.options ?? []).map((o, i) => [i + 1, o.description]));
	const thinking = answer.thinking ?? answer.note;
	const toggleLabel = isQuiz ? "Why" : isExplain ? "Answer" : "Details";
	const hasDetails = isQuiz
		? (answer.options?.length ?? 0) > 0 || !!answer.explanation || !!thinking
		: isExplain
			? !!answer.committed || !!thinking
			: isCode
				? !!thinking
				: !!parsedDetails || descByIndex.size > 0 || !!thinking;
	// What an ask or explain learner said stays in view (it is the record).
	const said = isAsk ? (answer.options ?? []).filter((o) => selectedIdx.has(o.index)) : [];

	return (
		<>
			{/* Thoughts noted while reading come before the question: their own
			    block above the card. */}
			{answer.readingThinking && (
				<ThinkingBlock testId="reading-thinking-block" label="Your thinking" text={answer.readingThinking} defaultOpen />
			)}
			<div data-testid="answered-card" className="flex flex-col gap-2 bg-panel px-4 py-3.5 text-card-foreground">
				<div className="flex items-center gap-2.5 text-[13px]">
					{isQuiz && <ResultChip answer={answer} />}
					<span data-testid="answer-kind" className="font-bold text-ink-3">
						{questionKindLabel(answer.tool ?? KIND_TOOL[answer.kind], answer.questionType)}
						{step !== undefined && ` · step ${step}`}
					</span>
					{isQuiz && !answer.dontKnow && answer.confidence != null && (
						<span data-testid="answered-confidence" className="text-ink-3">
							Sure {confidenceLevel(answer.confidence)}
						</span>
					)}
					<span className="flex-1" aria-hidden />
					{hasDetails && (
						<button
							type="button"
							data-testid="answer-toggle"
							aria-expanded={open}
							onClick={() => setOpen((v) => !v)}
							className="lh-press shrink-0 font-bold text-ink-2 hover:text-ink"
						>
							{toggleLabel} {open ? "▴" : "▾"}
						</button>
					)}
				</div>
				<div className="text-ink-2" style={proseVars(15, 21, "var(--muted-foreground)")}>
					<ToolContentResponse>{answer.questionText}</ToolContentResponse>
				</div>
				{(said.length > 0 || answer.other) && (
					<div data-testid="answered-said" className="flex flex-col gap-0.5 text-[15px] text-ink">
						{said.map((o) => (
							<div key={o.index} className="bg-tone px-3 py-2">
								<ToolContentResponse>{o.label}</ToolContentResponse>
							</div>
						))}
						{/* The learner's own typed answer: a row like its siblings,
						    quoted (the learner's words). */}
						{answer.other && (
							<div data-testid="answered-other" className="bg-tone px-3 py-2">
								“{answer.other}”
							</div>
						)}
					</div>
				)}
				{answer.text && <div className="lh-prose whitespace-pre-wrap text-ink">“{answer.text}”</div>}
				{isCode && answer.code && (
					<div data-testid="answered-code">
						<MessageResponse>{fencedCode(answer.code, answer.language ?? "")}</MessageResponse>
					</div>
				)}
				{isCode && answer.dontKnow && <div className="text-[15px] text-ink-2">Answered “I don't know”.</div>}

				{fold.mounted && (
					<div className="lh-collapse" data-state={fold.state} data-testid="answer-details">
						<div className="flex flex-col gap-2 pt-1">
							{parsedDetails && (
								<div className="text-ink-3" style={proseVars(14, 20, "var(--lh-ink-3)")}>
									<ToolContentResponse>{parsedDetails}</ToolContentResponse>
								</div>
							)}
							{isQuiz && (answer.options?.length ?? 0) > 0 && (
								<div className="flex flex-col gap-0.5 text-sm">
									{answer.options?.map((opt) => {
										const sel = selectedIdx.has(opt.index);
										const key = correctIdx.has(opt.index);
										return (
											<div
												key={opt.index}
												data-testid="answered-option"
												className={cn("flex items-center gap-2.5 bg-tone px-3 py-2", sel && "ring-1 ring-inset", sel && key && "ring-ans-right", sel && !key && "ring-ans-wrong")}
											>
												{/* The LaTeX \ding check/cross shapes (ui/glyph-mark). */}
												<span
													aria-hidden
													data-mark={key ? "check" : sel ? "x" : undefined}
													className={cn("flex w-3.5 shrink-0 items-center", key ? "text-ans-right" : "text-ans-wrong")}
												>
													{(key || sel) && <GlyphMark kind={key ? "check" : "x"} className="size-3.5" />}
												</span>
												<span className={cn(!sel && !key && "text-ink-2")}>
													<ToolContentResponse>{opt.label}</ToolContentResponse>
												</span>
											</div>
										);
									})}
									{answer.dontKnow && <div className="px-3 py-1 text-ink-3">Answered “I don't know”.</div>}
								</div>
							)}
							{isAsk && descByIndex.size > 0 && (
								<div className="flex flex-col gap-0.5 text-sm">
									{answer.options?.map((opt) => (
										<div key={opt.index} className={cn("bg-tone px-3 py-2", !selectedIdx.has(opt.index) && "text-ink-2")}>
											<ToolContentResponse>{opt.label}</ToolContentResponse>
											{descByIndex.get(opt.index) && (
												<ToolContentResponse className="block text-xs text-ink-3">{descByIndex.get(opt.index)}</ToolContentResponse>
											)}
										</div>
									))}
								</div>
							)}
							{thinking && <ThinkingBlock testId="your-thinking" label="Your thinking" text={thinking} inCard />}
							{isQuiz && answer.explanation && (
								<div data-testid="tucked-explanation" className="bg-tone px-3 py-2 text-sm text-ink-2">
									<ToolContentResponse className="[&>p:first-child]:mt-0">{answer.explanation}</ToolContentResponse>
								</div>
							)}
							{isExplain && answer.committed && (
								<div data-testid="committed-answer" className="bg-tone px-3 py-2 text-sm text-ink-2">
									<span className="font-bold text-ink">The answer: </span>
									<ToolContentResponse className="inline [&>p:first-child]:m-0 [&>p:first-child]:inline">{answer.committed}</ToolContentResponse>
								</div>
							)}
						</div>
					</div>
				)}
			</div>
		</>
	);
}

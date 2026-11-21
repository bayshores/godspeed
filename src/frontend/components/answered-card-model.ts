/**
 * The words an answered card adds under a guess. A guess is never marked
 * right or wrong: a missed one names the right answer, and a guess on a plot
 * says what the drawn line gives (his pick shows above it). Pure.
 */
import { questionKindLabel, type QuestionAnswerData } from "@/shared/core";
import { formatNumber } from "./lesson/plot-part-model";

/** Old answers carry no tool name: their kind stands in for it. */
const KIND_TOOL = { quiz: "quiz", explain: "explain", code: "write_code", ask: "ask" } as const;

/** The word an answered question is headed with (Prediction, Quiz, Explain, Code, Question). */
export function answeredKindLabel(answer: QuestionAnswerData): string {
	return questionKindLabel(answer.tool ?? KIND_TOOL[answer.kind], answer.questionType);
}

/** A prediction: the quiz the learner answers before the teaching. */
export function isPrediction(answer: QuestionAnswerData): boolean {
	return answer.kind === "quiz" && (answer.tool ?? "quiz") === "quiz" && answer.questionType === "predict";
}

/** "The answer was C, About 9%.", from the order he saw; null when the
 *  right option cannot be found. */
export function answerWasLine(answer: QuestionAnswerData): string | null {
	const options = answer.options ?? [];
	const correct = (answer.correctIndices ?? []).flatMap((i) => {
		const option = options.find((o) => o.index === i);
		return option ? [{ letter: String.fromCharCode(64 + i), label: option.label }] : [];
	});
	if (correct.length === 0) return null;
	return `The answer was ${correct.map((c) => c.letter).join(" and ")}, ${correct.map((c) => c.label).join(" and ")}.`;
}

/** The line under an answered prediction, or null: a plot guess always
 *  has one; a plain guess only when he missed. */
export function guessResultLine(answer: QuestionAnswerData, input: unknown, plotValue: number | undefined): string | null {
	if (!isPrediction(answer) || answer.dismissed) return null;
	const line = (input as { onPlot?: { line?: unknown } } | null | undefined)?.onPlot?.line;
	if (typeof line === "string" && plotValue !== undefined) return `The ${line} line gives ${formatNumber(plotValue)}.`;
	return answer.correct === true && !answer.dontKnow ? null : answerWasLine(answer);
}

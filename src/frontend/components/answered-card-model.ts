/**
 * The words an answered card adds under a guess. A guess is never marked
 * right or wrong: a missed one names the right answer, and a guess on a plot
 * says what he picked and what the drawn line gives. Pure.
 */
import type { QuestionAnswerData } from "@/shared/core";
import { formatNumber } from "./lesson/plot-part-model";

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

/** An option as part of a sentence: a capitalized first word in lower
 *  case (not "I"), and no closing full stop. */
function inSentence(label: string): string {
	const text = label.trim().replace(/\.$/, "");
	return /^[A-Z][a-z]*\b/.test(text) && !/^I\b/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}

/** A plot guess's line: "You picked: at 2, the leash's length. The penalty
 *  line gives 4." His pick is left out on "I don't know". */
function plotPickLine(answer: QuestionAnswerData, line: string, value: number): string {
	const gives = `The ${line} line gives ${formatNumber(value)}.`;
	const picked = answer.dontKnow ? [] : answer.answers.map((a) => answer.options?.find((o) => o.index === a.index)?.label ?? a.label);
	return picked.length > 0 ? `You picked: ${picked.map(inSentence).join(" and ")}. ${gives}` : gives;
}

/** The line under an answered prediction, or null: a plot guess always
 *  has one; a plain guess only when he missed. */
export function guessResultLine(answer: QuestionAnswerData, input: unknown, plotValue: number | undefined): string | null {
	if (!isPrediction(answer) || answer.dismissed) return null;
	const line = (input as { onPlot?: { line?: unknown } } | null | undefined)?.onPlot?.line;
	if (typeof line === "string" && plotValue !== undefined) return plotPickLine(answer, line, plotValue);
	return answer.correct === true && !answer.dontKnow ? null : answerWasLine(answer);
}

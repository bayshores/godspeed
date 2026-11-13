/**
 * One row of the From earlier card: the verdict, the topic and how sure he
 * was, and for a miss the question and the right answer. Pure.
 */
import type { ResultTone } from "@/frontend/components/result-tag";
import { confidenceLevel, type ReviewDetails } from "@/shared/core";

interface FromEarlierRow {
	tone: ResultTone;
	word: "Right" | "Wrong" | "Didn't know";
	topic: string;
	/** 1 to 5, or null when he did not know or gave none. */
	sure: number | null;
	/** A miss or "I don't know": the row also shows the question and the
	 *  right answer, so it has its own Why button. */
	missed: boolean;
	question: string;
	/** "The answer was C, About 9%.", from the order he saw. */
	answerLine: string | null;
}

export function fromEarlierRow(details: ReviewDetails): FromEarlierRow {
	const { answer } = details;
	const right = !answer.dontKnow && answer.correct === true;
	const options = answer.options ?? [];
	const correct = (answer.correctIndices ?? []).flatMap((i) => {
		const option = options.find((o) => o.index === i);
		return option ? [{ letter: String.fromCharCode(64 + i), label: option.label }] : [];
	});
	return {
		tone: answer.dontKnow ? "plain" : right ? "right" : "wrong",
		word: answer.dontKnow ? "Didn't know" : right ? "Right" : "Wrong",
		topic: details.topic || details.nodeId,
		sure: !answer.dontKnow && answer.confidence != null ? confidenceLevel(answer.confidence) : null,
		missed: !right,
		question: answer.questionText || details.quiz.question,
		answerLine:
			correct.length > 0 ? `The answer was ${correct.map((c) => c.letter).join(" and ")}, ${correct.map((c) => c.label).join(" and ")}.` : null,
	};
}

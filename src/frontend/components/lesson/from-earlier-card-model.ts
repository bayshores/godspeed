/**
 * One row of the From earlier card: the verdict, the topic and how sure he
 * was, for a miss the question and the right answer, and his kept sentence
 * on that topic with its phrase and source. Pure.
 */
import type { ResultTone } from "@/frontend/components/result-tag";
import { answerWasLine } from "@/frontend/components/answered-card-model";
import type { FileCite } from "@/frontend/components/citations/page-excerpt-model";
import { confidenceLevel, type ReviewDetails } from "@/shared/core";
import { keptSource, phraseLine } from "./kept-card-model";

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
	/** His kept sentence on the topic, never the analogy lines. A row with
	 *  one shows more than one line, so it has its own Why button. */
	kept: { text: string; phrase: string | null; source: FileCite | null } | null;
}

export function fromEarlierRow(details: ReviewDetails): FromEarlierRow {
	const { answer } = details;
	const right = !answer.dontKnow && answer.correct === true;
	return {
		tone: answer.dontKnow ? "plain" : right ? "right" : "wrong",
		word: answer.dontKnow ? "Didn't know" : right ? "Right" : "Wrong",
		topic: details.topic || details.nodeId,
		sure: !answer.dontKnow && answer.confidence != null ? confidenceLevel(answer.confidence) : null,
		missed: !right,
		question: answer.questionText || details.quiz.question,
		answerLine: answerWasLine(answer),
		kept: details.kept?.text
			? { text: details.kept.text, phrase: details.kept.phrase ? phraseLine(details.kept.phrase) : null, source: keptSource(details.kept.source) }
			: null,
	};
}

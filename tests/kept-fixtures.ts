/**
 * A quiz that carries a kept sentence, the server's verdict on it and his
 * answer, built by hand with made-up words, for the kept card's tests.
 */
import type { LhMessage } from "../src/shared/core/native-messages.ts";
import type { KeepCheckDetails } from "../src/shared/core/contracts/chat.ts";
import type { QuestionAnswerData } from "../src/shared/core/question-core.ts";
import { call, marker, result } from "./stop-fixtures.ts";

export const KEEP = {
	text: "$\\lambda$ prices large weights; it does not cap them.",
	source: '[[f_1a2b3c4d5e6f:7 "degree 12"]]',
	fits: "The leash fits one part: for the data you have, a larger $\\lambda$ gives a shorter leash.",
	stops: "It stops at new data: double the pull and every weight doubles.",
	phrase: "Price, not cap",
};

export const SOURCE_MARK = "[[f_1a2b3c4d5e6f/p. 14/Lecture 6.pdf|degree 12]]";

export const SHOWN: KeepCheckDetails = { quizCallId: "call_k", keep: "shown", fits: true, phrase: true, source: "ok", sourceMark: SOURCE_MARK };

const options = ["1.5", "6", "3", "0.375"].map((label, i) => ({ index: i + 1, label }));

const KEEP_QUIZ = {
	type: "check",
	nodeId: "reg",
	question: "A penalized fit at $\\lambda = 2$ puts one weight at $1.5$. Every $y_i$ is multiplied by 4 and $\\lambda$ stays 2. Where is that weight now?",
	options: options.map(({ label }) => ({ label })),
	explanation: "The fit scales with the data, so the weight moves to 6.",
	correctAnswer: "B",
	keep: KEEP,
};

/** His answer to the keep quiz: right picks B. */
export function keepAnswer(verdict: "right" | "wrong" | "dontKnow" | "dismissed"): QuestionAnswerData {
	const pick = verdict === "right" ? [options[1]!] : verdict === "wrong" ? [options[0]!] : [];
	return {
		kind: "quiz",
		tool: "quiz",
		questionType: "check",
		questionText: KEEP_QUIZ.question,
		options,
		dontKnow: verdict === "dontKnow",
		...(verdict === "dismissed" ? { dismissed: true } : {}),
		answers: pick.map((o) => ({ ...o, value: o.label })),
		correctIndices: [2],
		explanation: KEEP_QUIZ.explanation,
		correct: verdict === "right",
		confidence: 80,
		answeredAt: "2026-11-18T21:09:25.000Z",
	};
}

/** The quiz call (with `keep` as sent), its keep-check marker and his answer. */
export function keptLesson(opts: { verdict?: KeepCheckDetails | null; answer?: QuestionAnswerData | null; keep?: unknown } = {}): LhMessage[] {
	const verdict = opts.verdict === undefined ? SHOWN : opts.verdict;
	const answer = opts.answer === undefined ? keepAnswer("right") : opts.answer;
	return [
		call("call_k", "quiz", { ...KEEP_QUIZ, keep: opts.keep === undefined ? KEEP : opts.keep }, 8),
		...(verdict ? [marker("kc_1", "keep-check", verdict, 8)] : []),
		...(answer ? [result("call_k", "quiz", answer, 9)] : []),
	];
}

export function drop(kind: "analogy-drop" | "phrase-drop", back: boolean, minutes: number): LhMessage {
	return marker(`${kind}_${minutes}`, kind, { of: "call_k", ...(back ? { back: true } : {}), at: "2026-11-18T21:09:50.000Z" }, minutes);
}

import { useCallback, useEffect, useState } from "react";
import type { QuestionAnswerData, ReviewQuestion } from "@/shared/core";
import { jsonInit, send } from "@/frontend/lib/api";
import { fromEarlierAsk } from "./from-earlier-ask-model";

/** One request to the lesson's review route. */
function postReview(chatId: string, input: unknown) {
	return send(`/api/chats/${encodeURIComponent(chatId)}/review`, jsonInit("POST", { input }));
}

/** The question from earlier the lesson may show now, or null: none shows, or the ask failed
 *  (the next wait asks again). The lesson's loader asks once, whatever is open, so a reload
 *  shows the one he asked the teacher about. */
export async function askFromEarlier(chatId: string, signal?: AbortSignal): Promise<ReviewQuestion | null> {
	const { error, body } = await send(`/api/chats/${encodeURIComponent(chatId)}/review`, { ...jsonInit("POST", { input: { type: "next" } }), signal });
	return error ? null : ((body as { question?: ReviewQuestion | null }).question ?? null);
}

/**
 * Questions from earlier in a Study lesson. It opens with the one its
 * loader was served; then the route is asked while the teacher reads or
 * writes and nothing else is open, when that wait
 * begins and when a turn starts or ends; after an answer or a skip it is
 * asked again, until the wait ends (fromEarlierAsk). The server decides whether one may show, so no
 * question is a normal answer. The question on screen stays open after the
 * wait ends, to be answered or skipped.
 */
export function useFromEarlier({ chatId, opened, waiting, open, busy, onAnswered }: {
	chatId: string;
	/** The question the lesson opens with, as its loader was served it. */
	opened: ReviewQuestion | null;
	/** A Study lesson waiting on its teacher. */
	waiting: boolean;
	/** The teacher's question or a problem is open. */
	open: boolean;
	/** A turn runs. */
	busy: boolean;
	/** His answer was saved: show it, even while a turn runs. */
	onAnswered: () => void;
}) {
	const [question, setQuestion] = useState<ReviewQuestion | null>(opened);
	// An answer or a skip on its way: the next ask waits for it, or the
	// server would serve the same question again.
	const [sending, setSending] = useState(false);
	// His last answer was refused: the question was no longer due. Says so
	// until the next question shows or the wait ends.
	const [refused, setRefused] = useState(false);
	const ask = fromEarlierAsk({ waiting, open, shown: question !== null, sending, busy });

	useEffect(() => {
		if (!waiting) setRefused(false);
	}, [waiting]);

	useEffect(() => {
		if (ask === null) return;
		let live = true;
		void askFromEarlier(chatId).then((next) => {
			if (!live || !next) return;
			setQuestion(next);
			setRefused(false);
		});
		return () => {
			live = false;
		};
	}, [ask, chatId]);

	const settle = useCallback(
		async (input: Record<string, unknown>): Promise<"done" | "refused" | "unsent"> => {
			if (!question) return "unsent";
			const of = { chatId: question.of.chatId, toolCallId: question.of.toolCallId };
			setQuestion(null);
			setRefused(false);
			setSending(true);
			const { error, status } = await postReview(chatId, { ...input, of });
			setSending(false);
			// Not sent: it stays.
			if (status === 0) setQuestion(question);
			// Refused: it is no longer due, and the next ask says what shows.
			return !error ? "done" : status === 400 ? "refused" : "unsent";
		},
		[chatId, question],
	);

	const answer = useCallback(
		async (output: QuestionAnswerData): Promise<boolean> => {
			const got = await settle({ type: "answer", answer: output });
			if (got === "done") onAnswered();
			if (got === "refused") setRefused(true);
			return got === "done";
		},
		[settle, onAnswered],
	);
	const skip = useCallback(() => void settle({ type: "skip" }), [settle]);

	return { question, answer, skip, refused };
}

import { useCallback, useEffect, useState } from "react";
import type { QuestionAnswerData, ReviewQuestion } from "@/shared/core";
import { jsonInit, send } from "@/frontend/lib/api";
import { fromEarlierAsk } from "./from-earlier-ask-model";

/** One request to the lesson's review route. */
function postReview(chatId: string, input: unknown) {
	return send(`/api/chats/${encodeURIComponent(chatId)}/review`, jsonInit("POST", { input }));
}

/**
 * Questions from earlier in a Study lesson. The route is asked once when
 * the lesson opens; then, while the teacher reads or writes, or no agent is
 * teaching, and nothing else is open, when that wait begins and when a turn
 * starts or ends; after an answer or a skip it is asked again, until the
 * wait ends (fromEarlierAsk). The server decides whether one may show, so no
 * question is a normal answer. The question on screen stays open after the
 * wait ends, to be answered or skipped.
 */
export function useFromEarlier({ chatId, waiting, open, busy, onAnswered }: {
	chatId: string;
	/** A Study lesson waiting on its teacher or its agent. */
	waiting: boolean;
	/** The teacher's question or a problem is open. */
	open: boolean;
	/** A turn runs. */
	busy: boolean;
	/** His answer was saved: show it, even while a turn runs. */
	onAnswered: () => void;
}) {
	const [question, setQuestion] = useState<ReviewQuestion | null>(null);
	// An answer or a skip on its way: the next ask waits for it, or the
	// server would serve the same question again.
	const [sending, setSending] = useState(false);
	// His last answer was refused: the question was no longer due. Says so
	// until the next question shows or the wait ends.
	const [refused, setRefused] = useState(false);
	const [asked, setAsked] = useState(false);
	const ask = fromEarlierAsk({ first: !asked, waiting, open, shown: question !== null, sending, busy });

	useEffect(() => {
		if (!waiting) setRefused(false);
	}, [waiting]);

	useEffect(() => {
		if (ask === null) return;
		let live = true;
		// A failed ask shows none; the next wait asks again.
		void postReview(chatId, { type: "next" })
			.then(({ error, body }) => {
				const next = error ? null : (body as { question?: ReviewQuestion | null }).question;
				if (!live || !next) return;
				setQuestion(next);
				setRefused(false);
			})
			.finally(() => setAsked(true));
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

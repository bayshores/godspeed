import { useCallback, useEffect, useState } from "react";
import type { QuestionAnswerData, ReviewQuestion } from "@/shared/core";
import { fromEarlierAsk } from "./from-earlier-ask-model";

/** One request to the lesson's review route. */
function postReview(chatId: string, input: unknown): Promise<Response> {
	return fetch(`/api/chats/${encodeURIComponent(chatId)}/review`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ input }),
	});
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
		void postReview(chatId, { type: "next" })
			.then(async (res) => (res.ok ? ((await res.json()) as { question?: ReviewQuestion | null }) : null))
			.then((body) => {
				if (!live || !body?.question) return;
				setQuestion(body.question);
				setRefused(false);
			})
			.catch(() => {
				/* none shows; the next wait asks again */
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
			try {
				const res = await postReview(chatId, { ...input, of });
				// Refused: it is no longer due, and the next ask says what shows.
				return res.ok ? "done" : res.status === 400 ? "refused" : "unsent";
			} catch {
				// Not sent: it stays.
				setQuestion(question);
				return "unsent";
			} finally {
				setSending(false);
			}
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

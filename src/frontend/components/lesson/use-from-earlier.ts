import { useCallback, useEffect, useState } from "react";
import type { QuestionAnswerData, ReviewQuestion } from "@/shared/core";

/** One request to the lesson's review route. */
function postReview(chatId: string, input: unknown): Promise<Response> {
	return fetch(`/api/chats/${encodeURIComponent(chatId)}/review`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ input }),
	});
}

/**
 * Questions from earlier in a Study lesson. While the teacher reads or
 * writes, or no agent is teaching, and nothing else is open, the route is
 * asked once for a question; after an answer or a skip it is asked again,
 * until the wait ends. The server decides whether one may show, so no
 * question is a normal answer. The question on screen stays open after the
 * wait ends, to be answered or skipped.
 */
export function useFromEarlier({ chatId, waiting, open, onAnswered }: {
	chatId: string;
	/** A Study lesson waiting on its teacher or its agent. */
	waiting: boolean;
	/** The teacher's question or a problem is open. */
	open: boolean;
	/** His answer was saved: show it, even while a turn runs. */
	onAnswered: () => void;
}) {
	const [question, setQuestion] = useState<ReviewQuestion | null>(null);
	// An answer or a skip on its way: the next ask waits for it, or the
	// server would serve the same question again.
	const [sending, setSending] = useState(false);
	const ask = waiting && !open && question === null && !sending;

	useEffect(() => {
		if (!ask) return;
		let live = true;
		void postReview(chatId, { type: "next" })
			.then(async (res) => (res.ok ? ((await res.json()) as { question?: ReviewQuestion | null }) : null))
			.then((body) => {
				if (live && body?.question) setQuestion(body.question);
			})
			.catch(() => {
				/* none shows; the next wait asks again */
			});
		return () => {
			live = false;
		};
	}, [ask, chatId]);

	const settle = useCallback(
		async (input: Record<string, unknown>): Promise<boolean> => {
			if (!question) return false;
			const of = { chatId: question.of.chatId, toolCallId: question.of.toolCallId };
			setQuestion(null);
			setSending(true);
			try {
				const res = await postReview(chatId, { ...input, of });
				// Refused: it is no longer the open one, and the next ask says what is.
				return res.ok;
			} catch {
				// Not sent: it stays.
				setQuestion(question);
				return false;
			} finally {
				setSending(false);
			}
		},
		[chatId, question],
	);

	const answer = useCallback(
		async (output: QuestionAnswerData): Promise<boolean> => {
			const saved = await settle({ type: "answer", answer: output });
			if (saved) onAnswered();
			return saved;
		},
		[settle, onAnswered],
	);
	const skip = useCallback(() => void settle({ type: "skip" }), [settle]);

	return { question, answer, skip };
}

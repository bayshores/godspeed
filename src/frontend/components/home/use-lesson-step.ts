import { useEffect, useState } from "react";
import { lessonStep, type LessonStep, type LessonStepRecord } from "./suggestions-model";

/**
 * The Continue row's "step 3 / 11": reads the lesson (GET /api/chats/:id)
 * and derives its plan position. Re-reads when the lesson changes
 * (updatedAt moves with every turn) and keeps showing the last value for
 * the same lesson meanwhile; a stale answer is dropped.
 */
export function useLessonStep(chatId: string | null, updatedAt: string | null): LessonStep | null {
	const [state, setState] = useState<{ chatId: string; step: LessonStep | null } | null>(null);

	useEffect(() => {
		if (!chatId) return;
		let live = true;
		fetch(`/api/chats/${encodeURIComponent(chatId)}`)
			.then((res) => (res.ok ? (res.json() as Promise<LessonStepRecord>) : null))
			.then((record) => {
				if (live) setState({ chatId, step: record ? lessonStep(record) : null });
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [chatId, updatedAt]);

	return state && state.chatId === chatId ? state.step : null;
}

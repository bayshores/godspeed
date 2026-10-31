import { useCallback, useEffect, useState } from "react";
import type { LhMessage, QuestionDraft } from "@/core";
import {
	lessonDraftKey,
	parseLessonDraft,
	serializeLessonDraft,
	withComposer,
	withoutSettled,
	withProblem,
	withQuestion,
	type LessonDraft,
} from "./lesson-drafts-model";

/**
 * The lesson's unsent drafts, saved to localStorage on every change. The
 * draft is null until the stored copy is read after mount (the page is
 * server-rendered, so the first render can't see storage); saves before
 * then are ignored. Storage can be missing or full: the draft still lives
 * in memory for this visit.
 */
export function useLessonDrafts(chatId: string, record: readonly LhMessage[], activeProblemId: string | null) {
	const [draft, setDraft] = useState<LessonDraft | null>(null);
	const key = lessonDraftKey(chatId);

	useEffect(() => {
		let raw: string | null = null;
		try {
			raw = localStorage.getItem(key);
		} catch {
			/* no storage: start empty */
		}
		setDraft(parseLessonDraft(raw));
	}, [key]);

	useEffect(() => {
		if (!draft) return;
		const value = serializeLessonDraft(draft);
		try {
			if (value === null) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
		} catch {
			/* no storage or full: the draft stays in memory */
		}
	}, [key, draft]);

	const loaded = draft !== null;
	useEffect(() => {
		if (loaded) setDraft((d) => d && withoutSettled(d, record, activeProblemId));
	}, [loaded, record, activeProblemId]);

	const saveComposer = useCallback((text: string) => setDraft((d) => d && withComposer(d, text)), []);
	const saveQuestion = useCallback((id: string, patch: Partial<QuestionDraft>) => setDraft((d) => d && withQuestion(d, id, patch)), []);
	const saveProblem = useCallback((id: string, text: string) => setDraft((d) => d && withProblem(d, id, text)), []);

	return { draft, saveComposer, saveQuestion, saveProblem };
}

import { useCallback, useEffect, useState } from "react";
import type { LhMessage, QuestionDraft } from "@/shared/core";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import {
	lessonDraftKey,
	parseLessonDraft,
	serializeLessonDraft,
	withComposer,
	withoutEndedQuestions,
	withoutSettled,
	withQuestion,
	type LessonDraft,
} from "./lesson-drafts-model";

/**
 * The lesson's unsent drafts, read from localStorage for the first render
 * and saved on every change. The lesson page is drawn anew for each lesson,
 * so the stored copy is read once. Storage can be missing or full: the draft
 * still lives in memory for this visit.
 */
export function useLessonDrafts(chatId: string, record: readonly LhMessage[]) {
	const key = lessonDraftKey(chatId);
	const [draft, setDraft] = useState<LessonDraft>(() => withoutEndedQuestions(parseLessonDraft(readStorage(key)), record));

	useEffect(() => {
		writeStorage(key, serializeLessonDraft(draft));
	}, [key, draft]);

	useEffect(() => {
		setDraft((d) => withoutSettled(d, record));
	}, [record]);

	const saveComposer = useCallback((text: string) => setDraft((d) => withComposer(d, text)), []);
	const saveQuestion = useCallback((id: string, patch: Partial<QuestionDraft>) => setDraft((d) => withQuestion(d, id, patch)), []);

	return { draft, saveComposer, saveQuestion };
}

/** A deleted lesson's drafts go with it. */
export function forgetLessonDraft(chatId: string): void {
	writeStorage(lessonDraftKey(chatId), null);
}

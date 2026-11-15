import { useCallback, useEffect, useRef, useState } from "react";
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
 * The lesson's unsent drafts (and Talk's text), saved to localStorage on
 * every change. The draft is null until the stored copy is read after
 * mount, so the first render never depends on storage; saves before then
 * are ignored. Storage can be missing or full: the draft still lives in
 * memory for this visit.
 */
export function useLessonDrafts(chatId: string, record: readonly LhMessage[]) {
	const [draft, setDraft] = useState<LessonDraft | null>(null);
	const key = lessonDraftKey(chatId);
	const recordRef = useRef(record);
	recordRef.current = record;

	useEffect(() => {
		setDraft(withoutEndedQuestions(parseLessonDraft(readStorage(key)), recordRef.current));
	}, [key]);

	useEffect(() => {
		if (!draft) return;
		writeStorage(key, serializeLessonDraft(draft));
	}, [key, draft]);

	const loaded = draft !== null;
	useEffect(() => {
		if (loaded) setDraft((d) => d && withoutSettled(d, record));
	}, [loaded, record]);

	const saveComposer = useCallback((text: string) => setDraft((d) => d && withComposer(d, text)), []);
	const saveQuestion = useCallback((id: string, patch: Partial<QuestionDraft>) => setDraft((d) => d && withQuestion(d, id, patch)), []);

	return { draft, saveComposer, saveQuestion };
}

/** A deleted lesson's drafts go with it. */
export function forgetLessonDraft(chatId: string): void {
	writeStorage(lessonDraftKey(chatId), null);
}

import { useMemo } from "react";
import { NO_LESSON_WORK, readLessonWork, type LessonWork } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";

/** The lesson's work URL; the page's loader reads it too. */
export const lessonWorkUrl = (chatId: string): string => `/api/chats/${encodeURIComponent(chatId)}/work`;

/** What the teacher does in this lesson's running turn, read again on each step. `initial` is the
 *  loader's read, so a lesson opened mid-wait shows its desk as it stands. */
export function useLessonWork(chatId: string, initial: unknown): LessonWork {
	const { value } = useServerResource<unknown>(lessonWorkUrl(chatId), {
		on: { "lesson-work": (p) => p.chatId === chatId },
		initial: initial ?? undefined,
	});
	return useMemo(() => (value === null ? NO_LESSON_WORK : readLessonWork(value)), [value]);
}

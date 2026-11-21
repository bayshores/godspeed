import { useEffect } from "react";
import type { LessonDocuments } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";

/** What a lesson's Document panel shows (GET /api/chats/{id}/documents), from what the page's
 *  loader read (null when that read failed) and then read again when a space changes, so a file
 *  taken out of the space or a PDF built again shows. null until read, and for a lesson without
 *  documents (`loaded` undefined). */
export function useLessonDocuments(chatId: string, loaded: LessonDocuments | null | undefined): { documents: LessonDocuments | null; reload: () => Promise<void> } {
	const { value, error, reload } = useServerResource<LessonDocuments>(loaded === undefined ? null : `/api/chats/${encodeURIComponent(chatId)}/documents`, {
		on: { "spaces-changed": true },
		// Each read opens the lesson's PDFs, and a turn that posts or marks problems changes the space more than once.
		debounceMs: 250,
		initial: loaded ?? undefined,
	});
	// With no list the Document word stays away, so the reason is logged.
	useEffect(() => {
		if (error) console.error(`[lesson ${chatId}] couldn't read the lesson's documents: ${error}`);
	}, [chatId, error]);
	return { documents: value, reload };
}

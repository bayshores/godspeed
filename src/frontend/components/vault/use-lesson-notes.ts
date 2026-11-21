import { jsonInit, send } from "@/frontend/lib/api";
import { useServerResource } from "@/frontend/components/use-server-resource";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import type { LessonNotes } from "./note-pages-model";
import { useVault } from "./vault-context";

/**
 * A lesson's pages and the "My words" asks it still owes (read only once `active`, at its last
 * topic), and the way to answer the first ask: with words or with a skip.
 */
export function useLessonNotes(chatId: string | null, active: boolean) {
	const { status } = useVault();
	const url = active && chatId && status?.folder ? `/api/chats/${chatId}/vault-notes` : null;
	const { value, reload } = useServerResource<LessonNotes>(url, { on: { "vault-notes-changed": true } });
	const answering = useGuardedAction();
	const answer = (topicId: string, reply: { words: string } | { skip: true }) =>
		answering.run(async () => {
			const { error } = await send(`/api/chats/${chatId}/vault-words`, jsonInit("POST", { topicId, ...reply }));
			await reload();
			return error;
		});
	return { notes: value, obsidian: status?.obsidian ?? false, answer, answering };
}

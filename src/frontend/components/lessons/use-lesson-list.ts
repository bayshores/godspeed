import { useEffect } from "react";
import type { ChatListItem } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";

/**
 * THE LESSON LIST'S DATA: the /api/chats snapshot, kept fresh by events
 * (no poll). chats-changed / turn-started / turn-settled
 * refetch on a 250ms trailing debounce; a resync
 * refetches at once. lh:chat-renamed (a header rename) patches the
 * snapshot without a round trip. `failed`: the last read failed.
 */
export function useLessonList() {
	const { value, error, reload, update } = useServerResource<{ chats: ChatListItem[] }>("/api/chats", {
		on: { "chats-changed": true, "turn-started": true, "turn-settled": true },
		debounceMs: 250,
	});
	useEffect(() => {
		const onRenamed = (e: Event) => {
			const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
			update((list) => list && { chats: list.chats.map((c) => (c.id === id ? { ...c, title } : c)) });
		};
		window.addEventListener("lh:chat-renamed", onRenamed);
		return () => window.removeEventListener("lh:chat-renamed", onRenamed);
	}, [update]);
	return { chats: value?.chats ?? null, failed: error !== null, refresh: reload };
}

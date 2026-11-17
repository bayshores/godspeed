import { useCallback, useEffect, useRef, useState } from "react";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import type { ChatListItem } from "@/shared/core";

/**
 * THE LESSON LIST'S DATA: the /api/chats snapshot, kept fresh by events
 * (no poll). chats-changed / turn-started / turn-settled
 * refetch on a 250ms trailing debounce; a resync
 * refetches at once. lh:chat-renamed (a header rename) patches the
 * snapshot without a round trip. `failed` is set while no snapshot could
 * be read yet.
 */
export function useLessonList() {
	const [chats, setChats] = useState<ChatListItem[] | null>(null);
	const [failed, setFailed] = useState(false);

	const refreshInFlightRef = useRef(false);
	const refreshQueuedRef = useRef(false);
	const refresh = useCallback(async () => {
		// One fetch at a time; a call made during it runs once more after,
		// so the last event is never lost.
		if (refreshInFlightRef.current) {
			refreshQueuedRef.current = true;
			return;
		}
		refreshInFlightRef.current = true;
		try {
			const res = await fetch("/api/chats", { cache: "no-store" });
			if (!res.ok) throw new Error(String(res.status));
			const d = (await res.json()) as { chats: ChatListItem[] };
			setChats(d.chats);
			setFailed(false);
		} catch {
			// a transient failure keeps the last snapshot
			setFailed(true);
		} finally {
			refreshInFlightRef.current = false;
			if (refreshQueuedRef.current) {
				refreshQueuedRef.current = false;
				void refresh();
			}
		}
	}, []);

	useEffect(() => {
		const onRenamed = (e: Event) => {
			const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
			setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, title } : c)) : prev));
		};
		window.addEventListener("lh:chat-renamed", onRenamed);
		return () => window.removeEventListener("lh:chat-renamed", onRenamed);
	}, []);

	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const scheduleRefresh = () => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			debounceRef.current = undefined;
			void refreshRef.current();
		}, 250);
	};
	useServerEvent("chats-changed", scheduleRefresh);
	useServerEvent("turn-started", scheduleRefresh);
	useServerEvent("turn-settled", scheduleRefresh);
	useServerResync(() => void refreshRef.current());
	useEffect(
		() => () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		},
		[],
	);

	// The first read; from then on events own freshness.
	useEffect(() => {
		void refresh();
	}, [refresh]);

	return { chats, failed, refresh };
}

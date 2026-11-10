import { useCallback, useEffect, useRef, useState } from "react";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import type { ChatListItem } from "@/shared/core";

/**
 * THE LESSON LIST'S DATA: the /api/chats snapshot, kept fresh by events
 * (no poll). chats-changed / turn-started / turn-settled
 * refetch on a 250ms trailing debounce; a resync
 * refetches at once. Two same-tab instants patch the snapshot without a
 * round trip: lh:chat-renamed (a header rename) and lh:turn-state (the
 * open lesson's turn starting or settling). Rows that arrive after the
 * first snapshot are marked fresh so they rise in once. `failed` is set
 * while no snapshot could be read yet.
 */
export function useLessonList(open: boolean, pathname: string) {
	const [chats, setChats] = useState<ChatListItem[] | null>(null);
	const [failed, setFailed] = useState(false);
	const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(() => new Set());
	const knownIdsRef = useRef<Set<string> | null>(null);

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
			const known = knownIdsRef.current;
			if (known) {
				const added = d.chats.filter((c) => !known.has(c.id)).map((c) => c.id);
				if (added.length > 0) setFreshIds(new Set(added));
			}
			knownIdsRef.current = new Set(d.chats.map((c) => c.id));
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

	const chatsRef = useRef(chats);
	chatsRef.current = chats;
	useEffect(() => {
		const onTurnState = (e: Event) => {
			const { id, running } = (e as CustomEvent<{ id: string; running: boolean }>).detail;
			if (running) {
				if (chatsRef.current?.some((c) => c.id === id)) {
					setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, busy: true } : c)) : prev));
				} else {
					void refresh(); // a brand-new lesson isn't in the snapshot yet
				}
				return;
			}
			setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, busy: false } : c)) : prev));
			void refresh(); // settle: the server snapshot is truthful now
		};
		window.addEventListener("lh:turn-state", onTurnState);
		return () => window.removeEventListener("lh:turn-state", onTurnState);
	}, [refresh]);

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

	// Opening the sidebar and navigating refetch; while open, events own freshness.
	useEffect(() => {
		if (!open) return;
		void refresh();
	}, [open, pathname, refresh]);

	return { chats, setChats, freshIds, failed, refresh };
}

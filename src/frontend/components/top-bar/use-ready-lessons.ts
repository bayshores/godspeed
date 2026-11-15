import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import type { ChatListItem } from "@/shared/core";
import { useServerEvent } from "@/frontend/components/server-events";
import { keepReady, type ReadyLesson } from "./live-pill-model";

/** The lesson on screen, or null on another page. */
function lessonOnScreen(pathname: string): string | null {
	const id = /^\/chat\/([^/]+)/.exec(pathname)?.[1];
	return id === undefined ? null : decodeURIComponent(id);
}

/**
 * The lessons whose reply came while another page was open, oldest first.
 * A turn that settles in a lesson not on screen adds it (the other chats
 * are not in the lesson list, so theirs add nothing); opening
 * the lesson or a new turn in it takes it out, and so does deleting it.
 */
export function useReadyLessons(): ReadyLesson[] {
	const [ready, setReady] = useState<ReadyLesson[]>([]);
	const here = lessonOnScreen(useLocation().pathname);
	const hereRef = useRef(here);
	hereRef.current = here;
	const waiting = useRef(false);
	waiting.current = ready.length > 0;

	const drop = useCallback((id: string | null) => setReady((prev) => (prev.some((l) => l.id === id) ? prev.filter((l) => l.id !== id) : prev)), []);
	useEffect(() => drop(here), [drop, here]);

	const read = useCallback(async (add: string | null) => {
		try {
			const res = await fetch("/api/chats", { cache: "no-store" });
			if (!res.ok) return;
			const { chats } = (await res.json()) as { chats: ChatListItem[] };
			setReady((prev) => keepReady(prev, chats, add === hereRef.current ? null : add));
		} catch {
			// The next reply reads the list again.
		}
	}, []);

	useServerEvent("turn-started", ({ chatId }) => drop(chatId));
	useServerEvent("turn-settled", ({ chatId }) => {
		if (chatId !== hereRef.current) void read(chatId);
	});
	useServerEvent("chats-changed", () => {
		if (waiting.current) void read(null);
	});
	return ready;
}

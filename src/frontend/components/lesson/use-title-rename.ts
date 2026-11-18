import { useCallback, useEffect, useRef, useState } from "react";
import { jsonInit } from "@/frontend/lib/api";

/** PUT a lesson's title, then tell every listener (the lesson list and an
 *  open lesson's title) through lh:chat-renamed. Throws when the server says no. */
export async function renameLesson(id: string, title: string): Promise<void> {
	const res = await fetch(`/api/chats/${id}`, jsonInit("PUT", { title }));
	if (!res.ok) throw new Error(`rename failed: ${res.status}`);
	window.dispatchEvent(new CustomEvent("lh:chat-renamed", { detail: { id, title } }));
}

/**
 * The lesson title and its rename: F2 or a click on
 * the title opens edit mode with everything selected; Enter or a click
 * away commits (PUT /api/chats/:id); Escape discards. The lesson list learns
 * at once through the lh:chat-renamed window event, and a rename made in
 * the lesson list patches this title the same way.
 */
export function useTitleRename(chatId: string, initialTitle: string) {
	const [title, setTitle] = useState(initialTitle);
	const [renaming, setRenaming] = useState(false);
	const [draft, setDraft] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);

	const start = useCallback(() => {
		setDraft(title);
		setRenaming(true);
	}, [title]);

	const commit = useCallback(
		async (next: string) => {
			setRenaming(false);
			const t = next.trim();
			if (t === "" || t === title) return; // empty commit = discard
			try {
				await renameLesson(chatId, t);
				setTitle(t);
			} catch (err) {
				console.error("rename failed:", err); // keep the old title
			}
		},
		[chatId, title],
	);

	// Select-all on entry: the click means "replace".
	useEffect(() => {
		if (!renaming) return;
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [renaming]);

	// F2 (the keyboard registry's rename-session).
	useEffect(() => {
		window.addEventListener("lh:kbd-rename-session", start);
		return () => window.removeEventListener("lh:kbd-rename-session", start);
	}, [start]);

	// A rename from the lesson list patches this title in place.
	useEffect(() => {
		const onRenamed = (e: Event) => {
			const detail = (e as CustomEvent<{ id: string; title: string }>).detail;
			if (detail.id === chatId) setTitle((prev) => (detail.title !== prev ? detail.title : prev));
		};
		window.addEventListener("lh:chat-renamed", onRenamed);
		return () => window.removeEventListener("lh:chat-renamed", onRenamed);
	}, [chatId]);

	return { title, renaming, draft, setDraft, inputRef, start, commit, cancel: () => setRenaming(false) };
}

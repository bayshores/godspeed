import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The lesson title and its rename (owner, 2026-09-17): F2 or a click on
 * the title opens edit mode with everything selected; Enter or a click
 * away commits (PUT /api/chats/:id); Escape discards. The sidebar learns
 * at once through the lh:chat-renamed window event, and a rename made in
 * the sidebar patches this title the same way.
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
				const res = await fetch(`/api/chats/${chatId}`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title: t }),
				});
				if (!res.ok) throw new Error(`rename failed: ${res.status}`);
				setTitle(t);
				window.dispatchEvent(new CustomEvent("lh:chat-renamed", { detail: { id: chatId, title: t } }));
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

	// A rename from the sidebar patches this title in place.
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

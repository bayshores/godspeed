import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { DeleteSessionDialog } from "@/components/delete-session-dialog";
import { MoveLessonDialog } from "@/components/class-dialog";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { fuzzyScore, type ChatDeleteMode, type ChatListItem } from "@/core";
import { useRiseOnChange } from "@/components/sidebar/motion";
import { RenameRow, SessionRow } from "@/components/sidebar/session-row";
import { LessonMenu } from "@/components/sidebar/lesson-menu";
import { useLessonList } from "@/components/sidebar/use-lesson-list";
import { useMenuDismiss } from "@/components/use-menu-dismiss";

/**
 * THE LESSONS SECTION: the "Lessons" heading with its search toggle, the
 * active class's lessons, and the lesson menu (rename, export, move,
 * delete). The search icon (or ⌘⇧F) opens a fuzzy filter field: ↑/↓ walk
 * the matches, Enter opens the walked row (or the first match), Esc
 * closes the field.
 */
export function LessonsSection({
	open,
	toggle,
	pathname,
	activeClassId,
}: {
	open: boolean;
	toggle: () => void;
	pathname: string;
	activeClassId: string | null;
}) {
	const router = useRouter();
	const { chats, setChats, freshIds } = useLessonList(open, pathname);
	const [query, setQuery] = useState("");
	const [searchOpen, setSearchOpen] = useState(false);
	const focusSearchRef = useRef(false);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const [kbdIndex, setKbdIndex] = useState<number | null>(null);
	// Switching class swaps the list: it rises in.
	useRiseOnChange(listRef, activeClassId ?? "");

	const shown = useMemo(() => {
		if (!chats) return null;
		const list = chats.filter((c) => (c.classId ?? null) === activeClassId);
		const q = query.trim();
		if (!q) return list;
		return list
			.map((c) => ({ c, score: fuzzyScore(q, c.title) }))
			.filter((r): r is { c: ChatListItem; score: number } => r.score !== null)
			.sort((a, b) => b.score - a.score)
			.map((r) => r.c);
	}, [chats, query, activeClassId]);

	const openSearch = useCallback(() => {
		focusSearchRef.current = true;
		setSearchOpen(true);
		searchRef.current?.focus(); // already open: focus now
	}, []);
	const closeSearch = useCallback(() => {
		setSearchOpen(false);
		setQuery("");
		setKbdIndex(null);
	}, []);
	useEffect(() => {
		if (searchOpen && focusSearchRef.current) {
			focusSearchRef.current = false;
			searchRef.current?.focus();
		}
	}, [searchOpen]);

	// ⌘⇧F: open the sidebar if needed, then the search field.
	useEffect(() => {
		const onFocusSearch = () => {
			if (!open) toggle();
			openSearch();
		};
		window.addEventListener("lh:kbd-sessions-search", onFocusSearch);
		return () => window.removeEventListener("lh:kbd-sessions-search", onFocusSearch);
	}, [open, toggle, openSearch]);

	// Keep the walked row in view (rows are the list's only buttons).
	useEffect(() => {
		if (kbdIndex === null) return;
		listRef.current?.querySelectorAll("button")[kbdIndex]?.scrollIntoView({ block: "nearest" });
	}, [kbdIndex]);

	/* The lesson menu. The anchor is the right-clicked row, set before the
	   state flip so the shell measures it on its first pass. The last
	   menu's id stays set after close so the menu can play its exit. */
	const [ctxChatId, setCtxChatId] = useState<string | null>(null);
	const [ctxMenuId, setCtxMenuId] = useState<string | null>(null);
	const ctxAnchorRef = useRef<HTMLElement | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<ChatListItem | null>(null);
	const [moving, setMoving] = useState<ChatListItem | null>(null);

	const onContextMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>, chat: ChatListItem) => {
		e.preventDefault(); // suppress the native menu
		ctxAnchorRef.current = e.currentTarget;
		setCtxChatId(chat.id);
		setCtxMenuId(chat.id);
	}, []);

	const closeCtx = useCallback(() => setCtxChatId(null), []);
	useMenuDismiss(ctxChatId !== null, closeCtx, ctxAnchorRef);

	// Inline rename: PUT the title, then lh:chat-renamed patches every
	// listener (this list and an open lesson header). Empty = discard.
	const commitRename = useCallback(async (id: string, next: string) => {
		setRenamingId(null);
		const t = next.trim();
		if (t === "") return;
		try {
			const res = await fetch(`/api/chats/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: t }),
			});
			if (!res.ok) throw new Error(`rename failed: ${res.status}`);
			window.dispatchEvent(new CustomEvent("lh:chat-renamed", { detail: { id, title: t } }));
		} catch (err) {
			console.error("rename failed:", err); // keep the old title
		}
	}, []);

	// Deleted: patch the list, leave the lesson if it was open, and
	// announce the graph revision so the graph refetches.
	const onDeleted = useCallback(
		(id: string, _mode: ChatDeleteMode, graphRevision: number) => {
			setDeleting(null);
			setChats((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
			if (pathname === `/chat/${id}`) router.push("/");
			window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { revision: graphRevision } }));
		},
		[pathname, router, setChats],
	);

	const onOpen = useCallback(
		(id: string) => {
			setKbdIndex(null);
			router.push(`/chat/${id}`);
		},
		[router],
	);

	const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			e.stopPropagation(); // the window Esc chain (abort) must not also fire
			closeSearch();
			e.currentTarget.blur();
			return;
		}
		if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
		const n = shown?.length ?? 0;
		if (n === 0) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault(); // the rows move, not the caret
			const dir = e.key === "ArrowDown" ? 1 : -1;
			setKbdIndex((i) => (i === null || i >= n ? (dir === 1 ? 0 : n - 1) : (i + dir + n) % n));
			return;
		}
		if (e.key === "Enter") {
			const target = shown![kbdIndex !== null && kbdIndex < n ? kbdIndex : 0];
			if (!target) return;
			e.preventDefault();
			router.push(`/chat/${target.id}`);
			setKbdIndex(null);
			e.currentTarget.blur();
		}
	};

	return (
		<div className="flex min-h-0 w-full flex-1 flex-col">
			<div className="flex w-full items-center justify-between px-2.5 pt-1">
				<span className="text-[13px] font-bold text-ink-3">Lessons</span>
				<Hint label="Search lessons" side="right">
					<button
						type="button"
						data-testid="session-search-toggle"
						aria-label="Search lessons"
						aria-expanded={searchOpen}
						onClick={() => (searchOpen ? closeSearch() : openSearch())}
						className={cn("lh-press -m-1 flex size-6 items-center justify-center hover:text-ink", searchOpen ? "text-ink" : "text-ink-3")}
					>
						<SearchIcon className="size-3.5" />
					</button>
				</Hint>
			</div>

			<div className="lh-collapse w-full" data-state={searchOpen ? "open" : "closed"}>
				<div inert={!searchOpen}>
					<input
						ref={searchRef}
						data-testid="session-search"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setKbdIndex(null); // the list reorders under the query
						}}
						onKeyDown={onSearchKey}
						placeholder="Search lessons…"
						aria-label="Search lessons"
						spellCheck={false}
						className="mt-2 h-8 w-full border border-tone-2 bg-panel px-2.5 text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-3"
					/>
				</div>
			</div>

			<div ref={listRef} className="mt-3.5 flex w-full min-h-0 flex-1 flex-col gap-px overflow-y-auto">
				{shown === null ? (
					<div className="px-2.5 py-3 text-[12.5px] text-ink-3">Loading…</div>
				) : shown.length === 0 ? (
					<div className="px-2.5 py-3 text-[12.5px] text-ink-3">
						{query.trim() ? "No lessons match." : "No lessons yet."}
					</div>
				) : (
					shown.map((c, i) =>
						renamingId === c.id ? (
							<RenameRow
								key={c.id}
								chat={c}
								onCommit={(next) => void commitRename(c.id, next)}
								onCancel={() => setRenamingId(null)}
							/>
						) : (
							<SessionRow
								key={c.id}
								chat={c}
								active={pathname === `/chat/${c.id}`}
								kbdSelected={i === kbdIndex}
								fresh={freshIds.has(c.id)}
								onOpen={onOpen}
								onContextMenu={onContextMenu}
							/>
						),
					)
				)}
			</div>

			{ctxMenuId !== null && (
				<LessonMenu
					key={ctxMenuId}
					chatId={ctxMenuId}
					open={ctxChatId === ctxMenuId}
					anchorRef={ctxAnchorRef}
					onClose={closeCtx}
					onRename={() => {
						setRenamingId(ctxChatId);
						setCtxChatId(null);
					}}
					onMove={() => {
						const target = chats?.find((c) => c.id === ctxChatId);
						if (target) setMoving(target);
						setCtxChatId(null);
					}}
					onDelete={() => {
						const target = chats?.find((c) => c.id === ctxChatId);
						if (target) setDeleting(target);
						setCtxChatId(null);
					}}
				/>
			)}

			<DeleteSessionDialog chat={deleting} onClose={() => setDeleting(null)} onDeleted={onDeleted} />
			<MoveLessonDialog
				lesson={moving}
				onClose={() => setMoving(null)}
				onMoved={(id, classId) => {
					setMoving(null);
					setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, classId: classId ?? undefined } : c)) : prev));
					window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { revision: Date.now() } }));
				}}
			/>
		</div>
	);
}

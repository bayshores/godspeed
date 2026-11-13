import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useSpaces } from "@/frontend/components/space-context";
import { useTeacher } from "@/frontend/components/teacher/teacher-provider";
import { LoadFailed } from "@/frontend/components/load-failed";
import { useRiseOnChange } from "@/frontend/components/motion";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { DEFAULT_TEACHER_NAME, type ChatDeleteMode, type ChatListItem } from "@/shared/core";
import { DeleteLessonDialog } from "./delete-lesson-dialog";
import { LessonMenu } from "./lesson-menu";
import { LessonRow, RenameRow } from "./lesson-row";
import { matchLessons } from "./lessons-model";
import { MoveLessonDialog } from "./move-lesson-dialog";
import { useLessonList } from "./use-lesson-list";

/**
 * THE LESSONS TAB: "Study something new", the search field, then the
 * space's lessons and the lesson menu (rename, export, move, delete; a
 * row's More button or a right-click opens it). In the search field ↑/↓
 * walk the matches, Enter opens the walked row (or the first match) and
 * Esc clears the search.
 */
export function LessonsList() {
	const navigate = useNavigate();
	const { active: activeSpaceId } = useSpaces();
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const { chats, setChats, freshIds, failed, refresh } = useLessonList();
	const [query, setQuery] = useState("");
	const listRef = useRef<HTMLDivElement>(null);
	const [kbdIndex, setKbdIndex] = useState<number | null>(null);
	// Switching space swaps the list: it rises in.
	useRiseOnChange(listRef, activeSpaceId ?? "");

	const shown = useMemo(
		() => (chats ? matchLessons(chats.filter((c) => (c.spaceId ?? null) === activeSpaceId), query) : null),
		[chats, query, activeSpaceId],
	);

	// Keep the walked row in view.
	useEffect(() => {
		if (kbdIndex === null) return;
		listRef.current?.querySelectorAll("[data-teacher-target^='lesson:']")[kbdIndex]?.scrollIntoView({ block: "nearest" });
	}, [kbdIndex]);

	/* The lesson menu. The anchor is the right-clicked row or its More
	   button, set before the state flip so the shell measures it on its
	   first pass. The last menu's id stays set after close so the menu
	   can play its exit. */
	const [ctxChatId, setCtxChatId] = useState<string | null>(null);
	const [ctxMenuId, setCtxMenuId] = useState<string | null>(null);
	const ctxAnchorRef = useRef<HTMLElement | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameFailedId, setRenameFailedId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<ChatListItem | null>(null);
	const [moving, setMoving] = useState<ChatListItem | null>(null);

	const onMenu = useCallback((anchor: HTMLElement, chat: ChatListItem) => {
		// A second click on the same More closes the menu.
		const again = ctxAnchorRef.current === anchor;
		ctxAnchorRef.current = anchor;
		setCtxChatId((open) => (again && open === chat.id ? null : chat.id));
		setCtxMenuId(chat.id);
	}, []);

	const closeCtx = useCallback(() => setCtxChatId(null), []);
	useMenuDismiss(ctxChatId !== null, closeCtx, ctxAnchorRef);

	// Inline rename: PUT the title, then lh:chat-renamed patches every
	// listener (this list and an open lesson header). Empty = discard; a
	// failure keeps the old title and says so under the row.
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
		} catch {
			setRenameFailedId(id);
		}
	}, []);

	// Deleted: patch the list and announce the graph revision so the
	// graph refetches.
	const onDeleted = useCallback(
		(id: string, _mode: ChatDeleteMode, graphRevision: number) => {
			setDeleting(null);
			setChats((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
			window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { revision: graphRevision } }));
		},
		[setChats],
	);

	const onOpen = useCallback(
		(id: string) => {
			setKbdIndex(null);
			navigate(`/chat/${id}`);
		},
		[navigate],
	);

	const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			if (!query) return;
			e.stopPropagation(); // clears the search, nothing else
			setQuery("");
			setKbdIndex(null);
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
			navigate(`/chat/${target.id}`);
			setKbdIndex(null);
			e.currentTarget.blur();
		}
	};

	return (
		<div data-testid="lessons-list" className="mx-auto flex w-full max-w-[908px] flex-col gap-5 px-6 py-6">
			{/* New lessons start on the start page ("/new"). */}
			<Link to="/new" data-testid="new-session" className="lh-btn lh-btn-main h-auto w-full justify-center py-3 text-base">
				<PixelIcon name="play" />
				Study something new
			</Link>
			<input
				data-testid="session-search"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					setKbdIndex(null); // the list reorders under the query
				}}
				onKeyDown={onSearchKey}
				placeholder="Search lessons"
				aria-label="Search lessons"
				spellCheck={false}
				className="h-11 w-full rounded-[2px] border-2 border-ink bg-transparent px-3 text-base text-ink outline-none placeholder:text-ink-3"
			/>

			<div ref={listRef} className="flex w-full flex-col border-y-2 border-ink">
				{shown === null ? (
					failed ? (
						<LoadFailed message="Couldn't load your lessons." onRetry={() => void refresh()} className="px-2 py-4" />
					) : (
						<div className="px-2 py-4 text-[15px] text-ink-2">Loading…</div>
					)
				) : shown.length === 0 ? (
					<div className="px-2 py-4 text-[15px] text-ink-2">{query.trim() ? "No lessons match." : "No lessons yet."}</div>
				) : (
					shown.map((c, i) =>
						renamingId === c.id ? (
							<RenameRow key={c.id} chat={c} onCommit={(next) => void commitRename(c.id, next)} onCancel={() => setRenamingId(null)} />
						) : (
							<Fragment key={c.id}>
								<LessonRow chat={c} teacher={teacher} kbdSelected={i === kbdIndex} fresh={freshIds.has(c.id)} onOpen={onOpen} onMenu={onMenu} menuOpen={ctxChatId === c.id} />
								{renameFailedId === c.id && (
									<p role="alert" data-testid="session-rename-failed" className="px-2 pb-2 text-sm text-ans-wrong">
										Couldn&apos;t rename the lesson.
									</p>
								)}
							</Fragment>
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
						setRenameFailedId(null);
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

			<DeleteLessonDialog chat={deleting} onClose={() => setDeleting(null)} onDeleted={onDeleted} />
			<MoveLessonDialog
				lesson={moving}
				onClose={() => setMoving(null)}
				onMoved={(id, spaceId) => {
					setMoving(null);
					setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, spaceId: spaceId ?? undefined } : c)) : prev));
					window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { revision: Date.now() } }));
				}}
			/>
		</div>
	);
}

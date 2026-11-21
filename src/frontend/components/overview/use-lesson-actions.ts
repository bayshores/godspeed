import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { LessonProgress } from "@/shared/core";
import { renameLesson } from "@/frontend/components/lesson/use-title-rename";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { pendingEdits, withEdits, type LessonEdits } from "./lesson-record-model";

type Lesson = { id: string; title: string; spaceId?: string };

export interface LessonActions {
	/** The lessons with renames, deletes and moves shown at once; null while loading. */
	shown: LessonProgress[] | null;
	menuId: string | null;
	/** The last menu's lesson, kept after close so the menu can play its exit. */
	lastMenuId: string | null;
	anchorRef: RefObject<HTMLElement | null>;
	renamingId: string | null;
	renameFailedId: string | null;
	deleting: Lesson | null;
	moving: Lesson | null;
	/** Opens the lesson menu under its More button; again on the same one closes it. */
	onMenu: (anchor: HTMLElement, chatId: string) => void;
	closeMenu: () => void;
	startRename: () => void;
	commitRename: (lesson: LessonProgress, next: string) => void;
	cancelRename: () => void;
	startMove: () => void;
	startDelete: () => void;
	/** A dialog closed; `goneId` is the lesson it deleted or moved away. */
	endDialog: (goneId?: string) => void;
}

/**
 * The lesson menu behind every lesson row on Progress, whichever column the
 * row sits in: Rename in place, Export, Move, Delete. A rename, delete or
 * move shows at once, before the progress payload is read again; a failed
 * rename goes back to the old title and says so under the row.
 */
export function useLessonActions(lessons: readonly LessonProgress[] | null, spaceId: string | null): LessonActions {
	const [edits, setEdits] = useState<LessonEdits>({});
	useEffect(() => {
		if (lessons) setEdits((prev) => pendingEdits(prev, lessons));
	}, [lessons]);
	const shown = useMemo(() => (lessons ? withEdits(lessons, edits) : null), [lessons, edits]);
	const edit = useCallback((id: string, title: string | null | undefined) => {
		setEdits((prev) => {
			const next: Record<string, string | null> = { ...prev };
			if (title === undefined) delete next[id];
			else next[id] = title;
			return next;
		});
	}, []);

	// The anchor is set before the state flip so the shell measures it on its first pass.
	const [menuId, setMenuId] = useState<string | null>(null);
	const [lastMenuId, setLastMenuId] = useState<string | null>(null);
	const anchorRef = useRef<HTMLElement | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameFailedId, setRenameFailedId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<Lesson | null>(null);
	const [moving, setMoving] = useState<Lesson | null>(null);

	const onMenu = useCallback((anchor: HTMLElement, chatId: string) => {
		const again = anchorRef.current === anchor;
		anchorRef.current = anchor;
		setMenuId((open) => (again && open === chatId ? null : chatId));
		setLastMenuId(chatId);
	}, []);
	const closeMenu = useCallback(() => setMenuId(null), []);
	useMenuDismiss(menuId !== null, closeMenu, anchorRef);

	/** The menu's lesson, for a dialog; the menu closes. */
	const pick = (): Lesson | null => {
		const l = shown?.find((x) => x.chatId === menuId);
		setMenuId(null);
		return l ? { id: l.chatId, title: l.title, spaceId: spaceId ?? undefined } : null;
	};

	const commitRename = useCallback(
		async (lesson: LessonProgress, next: string) => {
			setRenamingId(null);
			const title = next.trim();
			if (title === "" || title === lesson.title) return;
			edit(lesson.chatId, title);
			try {
				await renameLesson(lesson.chatId, title);
			} catch {
				edit(lesson.chatId, undefined);
				setRenameFailedId(lesson.chatId);
			}
		},
		[edit],
	);

	return {
		shown,
		menuId,
		lastMenuId,
		anchorRef,
		renamingId,
		renameFailedId,
		deleting,
		moving,
		onMenu,
		closeMenu,
		startRename: () => {
			setRenameFailedId(null);
			setRenamingId(menuId);
			setMenuId(null);
		},
		commitRename: (lesson, next) => void commitRename(lesson, next),
		cancelRename: () => setRenamingId(null),
		startMove: () => setMoving(pick()),
		startDelete: () => setDeleting(pick()),
		endDialog: (goneId) => {
			setDeleting(null);
			setMoving(null);
			if (goneId) edit(goneId, null);
		},
	};
}

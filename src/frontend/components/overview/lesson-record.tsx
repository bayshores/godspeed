import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { LessonProgress } from "@/shared/core";
import { renameLesson } from "@/frontend/components/lesson/use-title-rename";
import { DeleteLessonDialog } from "@/frontend/components/lessons/delete-lesson-dialog";
import { LessonMenu } from "@/frontend/components/lessons/lesson-menu";
import { MoveLessonDialog } from "@/frontend/components/lessons/move-lesson-dialog";
import { CARD_HEAD, CARD_TITLE } from "@/frontend/components/home-page/styles";
import { Pane } from "@/frontend/components/ui/pane";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { lessonOrder, pendingEdits, shownRows, withEdits, type LessonEdits } from "./lesson-record-model";
import { LessonRow, RenameRow } from "./lesson-record-rows";

type Lesson = { id: string; title: string; spaceId?: string };

/**
 * LESSONS (Progress): one sheet with "Study something new" and the space's
 * lessons in one list, the unfinished ones first, each newest first, with
 * "Show all" for the rest. A row's More button or a right-click opens the
 * lesson menu (rename, export, move, delete); a rename, delete or move
 * shows at once, before the progress payload is read again.
 */
export const LessonRecord = memo(function LessonRecord({
	lessons,
	spaceId,
	nowMs,
}: {
	/** null while the payload is loading or failed. */
	lessons: readonly LessonProgress[] | null;
	/** The page's space (null: no space), where a move starts from. */
	spaceId: string | null;
	/** The window's clock (null before the first client render). */
	nowMs: number | null;
}) {
	const [edits, setEdits] = useState<LessonEdits>({});
	useEffect(() => {
		if (lessons) setEdits((prev) => pendingEdits(prev, lessons));
	}, [lessons]);
	const shown = useMemo(() => (lessons ? withEdits(lessons, edits) : null), [lessons, edits]);
	const ordered = useMemo(() => (shown ? lessonOrder(shown) : []), [shown]);
	const [shownAll, setShownAll] = useState(false);
	const { rows, showAll } = shownRows(ordered, shownAll);
	const keyId = ordered.find((l) => l.unfinished)?.chatId;
	const edit = useCallback((id: string, title: string | null | undefined) => {
		setEdits((prev) => {
			const next: Record<string, string | null> = { ...prev };
			if (title === undefined) delete next[id];
			else next[id] = title;
			return next;
		});
	}, []);

	/* The lesson menu. The anchor is the right-clicked row or its More
	   button, set before the state flip so the shell measures it on its
	   first pass. The last menu's id stays set after close so the menu
	   can play its exit. */
	const [menuId, setMenuId] = useState<string | null>(null);
	const [lastMenuId, setLastMenuId] = useState<string | null>(null);
	const anchorRef = useRef<HTMLElement | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [renameFailedId, setRenameFailedId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<Lesson | null>(null);
	const [moving, setMoving] = useState<Lesson | null>(null);

	const onMenu = useCallback((anchor: HTMLElement, chatId: string) => {
		// A second click on the same More closes the menu.
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

	// An empty or unchanged title is no rename; a failed one goes back to
	// the old title and says so under the row.
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

	return (
		<Pane data-testid="lesson-record" className="flex flex-col pb-5">
			<div className={CARD_HEAD}>
				<h2 className={CARD_TITLE}>Lessons</h2>
				<Link to="/new" data-testid="study-something-new" className="lh-btn shrink-0">
					Study something new
				</Link>
			</div>
			{shown?.length === 0 && <p className="px-6 text-base text-ink-2">No lessons yet.</p>}
			<ul className="flex flex-col px-3">
				{rows.map((l) =>
					renamingId === l.chatId ? (
						<RenameRow key={l.chatId} title={l.title} onCommit={(next) => void commitRename(l, next)} onCancel={() => setRenamingId(null)} />
					) : (
						<LessonRow
							key={l.chatId}
							lesson={l}
							nowMs={nowMs}
							withKey={l.chatId === keyId}
							menuOpen={menuId === l.chatId}
							renameFailed={renameFailedId === l.chatId}
							onMenu={onMenu}
						/>
					),
				)}
			</ul>
			{showAll !== null && (
				<button type="button" data-testid="lesson-show-all" onClick={() => setShownAll(true)} className="lh-btn lh-btn-quiet mt-1 ml-[50px] self-start text-[15px]">
					Show all {showAll}
				</button>
			)}

			{lastMenuId !== null && (
				<LessonMenu
					key={lastMenuId}
					chatId={lastMenuId}
					open={menuId === lastMenuId}
					anchorRef={anchorRef}
					onClose={closeMenu}
					onRename={() => {
						setRenameFailedId(null);
						setRenamingId(menuId);
						setMenuId(null);
					}}
					onMove={() => setMoving(pick())}
					onDelete={() => setDeleting(pick())}
				/>
			)}
			<DeleteLessonDialog
				chat={deleting}
				onClose={() => setDeleting(null)}
				onDeleted={(id) => {
					setDeleting(null);
					edit(id, null);
				}}
			/>
			<MoveLessonDialog
				lesson={moving}
				onClose={() => setMoving(null)}
				onMoved={(id) => {
					setMoving(null);
					edit(id, null);
				}}
			/>
		</Pane>
	);
});

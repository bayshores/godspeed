import { useCallback, useRef, useState } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { DeleteLessonDialog } from "@/frontend/components/lessons/delete-lesson-dialog";
import { LessonMenu } from "@/frontend/components/lessons/lesson-menu";
import { MoveLessonDialog } from "@/frontend/components/lessons/move-lesson-dialog";
import { barWord } from "@/frontend/components/top-bar/bar-look";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";

type Lesson = { id: string; title: string; spaceId?: string };

/**
 * More, the open lesson's last word in the top bar: the same lesson menu a
 * Progress row has, hanging from the bar. Rename turns the title into its
 * field; a delete leaves the lesson for its space's Progress page (the
 * lesson's space is the bar's lit tab); a move keeps the lesson open and
 * reads its record again, so the bar marks the new space.
 */
export function LessonMore({ chatId, title, spaceId, onRename }: { chatId: string; title: string; spaceId: string | undefined; onRename: () => void }) {
	const navigate = useNavigate();
	const revalidator = useRevalidator();
	const anchorRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [deleting, setDeleting] = useState<Lesson | null>(null);
	const [moving, setMoving] = useState<Lesson | null>(null);
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	const pick = (act: () => void) => () => {
		setOpen(false);
		act();
	};
	const lesson = { id: chatId, title, spaceId };
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				data-testid="lesson-more"
				aria-label={`More for ${title}`}
				aria-haspopup="menu"
				aria-expanded={open}
				onClick={() => setOpen((o) => !o)}
				className={barWord(open)}
			>
				More
			</button>
			<LessonMenu
				chatId={chatId}
				open={open}
				anchorRef={anchorRef}
				onClose={close}
				onRename={pick(onRename)}
				onMove={pick(() => setMoving(lesson))}
				onDelete={pick(() => setDeleting(lesson))}
				bar
			/>
			<DeleteLessonDialog chat={deleting} onClose={() => setDeleting(null)} onDeleted={() => void navigate("/space")} />
			<MoveLessonDialog
				lesson={moving}
				onClose={() => setMoving(null)}
				onMoved={() => {
					setMoving(null);
					void revalidator.revalidate();
				}}
			/>
		</>
	);
}

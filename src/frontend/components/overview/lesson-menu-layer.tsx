import { DeleteLessonDialog } from "@/frontend/components/lessons/delete-lesson-dialog";
import { LessonMenu } from "@/frontend/components/lessons/lesson-menu";
import { MoveLessonDialog } from "@/frontend/components/lessons/move-lesson-dialog";
import type { LessonActions } from "./use-lesson-actions";

/** The lesson menu and its delete and move dialogs, once for the whole page. */
export function LessonMenuLayer({ actions: a }: { actions: LessonActions }) {
	return (
		<>
			{a.lastMenuId !== null && (
				<LessonMenu
					key={a.lastMenuId}
					chatId={a.lastMenuId}
					open={a.menuId === a.lastMenuId}
					anchorRef={a.anchorRef}
					onClose={a.closeMenu}
					onRename={a.startRename}
					onMove={a.startMove}
					onDelete={a.startDelete}
				/>
			)}
			<DeleteLessonDialog chat={a.deleting} onClose={() => a.endDialog()} onDeleted={(id) => a.endDialog(id)} />
			<MoveLessonDialog lesson={a.moving} onClose={() => a.endDialog()} onMoved={(id) => a.endDialog(id)} />
		</>
	);
}

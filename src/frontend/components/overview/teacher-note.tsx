import { memo } from "react";
import { DEFAULT_TEACHER_NAME, type SpaceNote } from "@/shared/core";
import { useTeacher } from "@/frontend/components/teacher/teacher-provider";
import { Pane } from "@/frontend/components/ui/pane";
import { noteWhen } from "./overview-model";

/** THE TEACHER'S NOTE (Progress): what the teacher wrote about the space
 *  after a lesson, and when. */
export const TeacherNote = memo(function TeacherNote({ note, nowMs }: { note: SpaceNote; nowMs: number | null }) {
	const teacherName = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const when = nowMs !== null ? noteWhen(note.at, nowMs) : "";
	return (
		<Pane data-testid="teacher-note" className="lh-card gap-0.5">
			<p className="font-prose text-item leading-snug text-ink">{note.text}</p>
			{when && (
				<p className="font-count text-ui text-ink-2">
					{teacherName}, {when}
				</p>
			)}
		</Pane>
	);
});

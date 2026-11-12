import { memo } from "react";
import { DEFAULT_TEACHER_NAME, type ClassNote } from "@/shared/core";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { Pane } from "@/frontend/components/ui/pane";
import { noteWhen } from "./overview-model";

/** THE TEACHER'S NOTE (Progress): what the teacher wrote about the class
 *  after a lesson, and when. */
export const TeacherNote = memo(function TeacherNote({ note, nowMs }: { note: ClassNote; nowMs: number | null }) {
	const teacherName = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const when = nowMs !== null ? noteWhen(note.at, nowMs) : "";
	return (
		<Pane data-testid="teacher-note" className="flex flex-col gap-0.5 px-[18px] py-3.5">
			<p className="font-prose text-lg leading-snug text-ink">{note.text}</p>
			{when && (
				<p className="font-count text-base text-ink-2">
					{teacherName}, {when}
				</p>
			)}
		</Pane>
	);
});

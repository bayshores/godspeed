"use client";

import { useCallback, useMemo, useState } from "react";
import { PencilIcon } from "lucide-react";
import { useClasses } from "@/components/class-context";
import { ClassDialog } from "@/components/class-dialog";
import { LoadFailed } from "@/components/load-failed";
import { useMinute } from "@/components/countdown";
import { useLessonStart } from "@/components/home/use-lesson-start";
import { TopBar } from "@/components/top-bar";
import { useProgress } from "@/components/use-progress";
import { PickClass } from "@/components/pick-class";
import { OverviewBody } from "./overview-body";

/**
 * THE CLASS OVERVIEW — opened from the sidebar's
 * Overview row. The top bar holds "Edit class" (the existing class
 * dialog); the body reads the active class's progress (useProgress).
 *
 * The runway's rings open each deadline's page; "Most needed" → Study
 * starts a study session on that topic (useLessonStart, in the active class).
 */
export function ClassOverview() {
	const { active, activeClass } = useClasses();
	const { data, error, refresh } = useProgress();
	// "deadline" opens Edit class with a new deadline row.
	const [editing, setEditing] = useState<false | "class" | "deadline">(false);
	const lesson = useLessonStart();
	const nowMs = useMinute();

	// The dialog compares its mode by identity: one object per open.
	const editId = activeClass?.id ?? null;
	const editMode = useMemo(
		() => (editing && editId ? { kind: "edit" as const, classId: editId, ...(editing === "deadline" && { deadline: "new" }) } : null),
		[editing, editId],
	);

	// Progress for a class the window just left is never shown.
	const current = data && data.classId === active ? data : null;

	const { studyTopics } = lesson;
	const study = useCallback((topicId: string) => void studyTopics([topicId]), [studyTopics]);

	return (
		<div className="flex h-full flex-col">
			<TopBar>
				<div className="flex-1" />
				{activeClass && (
					<button
						type="button"
						data-testid="overview-edit-class"
						onClick={() => setEditing("class")}
						className="lh-press flex items-center gap-[7px] bg-panel px-2.5 py-[7px] text-sm text-ink hover:bg-tone"
					>
						<PencilIcon className="size-3.5" aria-hidden />
						Edit class
					</button>
				)}
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<OverviewBody
					key={active ?? "none"}
					name={activeClass?.name ?? "No class"}
					description={activeClass?.description ?? ""}
					hasClass={!!activeClass}
					classId={activeClass?.id ?? null}
					signature={activeClass?.signature}
					note={activeClass?.note}
					data={current}
					nowMs={nowMs}
					busy={lesson.busy}
					startError={lesson.error}
					onStudy={study}
					onAddSignature={() => setEditing("class")}
					onAddDeadline={() => setEditing("deadline")}
					pickClass={active ? undefined : <PickClass line="Pick a class to see how it's going." />}
				/>
				{!current && error && <LoadFailed message="Couldn't load this class's progress." onRetry={refresh} className="px-[52px]" />}
			</div>
			<ClassDialog mode={editMode} onClose={() => setEditing(false)} />
		</div>
	);
}

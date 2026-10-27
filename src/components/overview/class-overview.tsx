"use client";

import { useCallback, useMemo, useState } from "react";
import { PencilIcon } from "lucide-react";
import type { FileCoverage } from "@/core";
import { useClasses } from "@/components/class-context";
import { ClassDialog } from "@/components/class-dialog";
import { useLessonStart } from "@/components/home/use-lesson-start";
import { SetupDialog } from "@/components/setup-dialog";
import { TopBar } from "@/components/top-bar";
import { useProgress } from "@/components/use-progress";
import { OverviewBody } from "./overview-body";
import { displayName } from "./overview-model";

/**
 * THE CLASS OVERVIEW (redesign plan, Phase 4) — opened from the sidebar's
 * Overview row. The top bar holds "Edit class" (the existing class
 * dialog); the body reads the active class's progress (useProgress).
 *
 * "Learn this" starts a lesson on the Next-up file the way Home starts
 * lessons (useLessonStart: the file name is the lesson's title and first
 * message, in the active class, behind the same setup checks).
 */
export function ClassOverview({ initialConfigured }: { initialConfigured: boolean }) {
	const { active, activeClass } = useClasses();
	const { data } = useProgress();
	const [editing, setEditing] = useState(false);
	const lesson = useLessonStart(initialConfigured);
	const { start } = lesson;
	const learn = useCallback((file: FileCoverage) => void start({ title: displayName(file.name) }), [start]);

	// The dialog compares its mode by identity: one object per open.
	const editId = activeClass?.id ?? null;
	const editMode = useMemo(() => (editing && editId ? { kind: "edit" as const, classId: editId } : null), [editing, editId]);

	// Progress for a class the window just left is never shown.
	const current = data && data.classId === active ? data : null;

	return (
		<div className="flex h-full flex-col">
			<TopBar>
				<div className="flex-1" />
				{activeClass && (
					<button
						type="button"
						data-testid="overview-edit-class"
						onClick={() => setEditing(true)}
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
					data={current}
					busy={lesson.busy}
					onLearn={learn}
				/>
			</div>
			<ClassDialog mode={editMode} onClose={() => setEditing(false)} />
			<SetupDialog open={lesson.setupOpen} onClose={lesson.closeSetup} onDone={lesson.setupDone} />
		</div>
	);
}

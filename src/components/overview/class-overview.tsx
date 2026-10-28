"use client";

import { useCallback, useMemo, useState } from "react";
import { PencilIcon } from "lucide-react";
import type { DeadlineProgress, TopicProgress } from "@/core";
import { useClasses } from "@/components/class-context";
import { ClassDialog } from "@/components/class-dialog";
import { useMinute } from "@/components/countdown";
import { practicePicks, usePracticeStart } from "@/components/graph/practice";
import { useLessonStart } from "@/components/home/use-lesson-start";
import { TopBar } from "@/components/top-bar";
import { useProgress } from "@/components/use-progress";
import { OverviewBody } from "./overview-body";

/**
 * THE CLASS OVERVIEW — opened from the sidebar's
 * Overview row. The top bar holds "Edit class" (the existing class
 * dialog); the body reads the active class's progress (useProgress).
 *
 * The runway's rings start practice on a deadline's topics (the Graph
 * page's "Practice these N" path); "Most needed" → Learn this starts a
 * lesson on that topic the way the New lesson screen starts lessons
 * (useLessonStart: the topic name is the lesson's title and first message,
 * in the active class, and the topic's facts are its opening picks).
 */
export function ClassOverview() {
	const { active, activeClass } = useClasses();
	const { data } = useProgress();
	const [editing, setEditing] = useState(false);
	const lesson = useLessonStart();
	const practice = usePracticeStart();
	const nowMs = useMinute();

	// The dialog compares its mode by identity: one object per open.
	const editId = activeClass?.id ?? null;
	const editMode = useMemo(() => (editing && editId ? { kind: "edit" as const, classId: editId } : null), [editing, editId]);

	// Progress for a class the window just left is never shown.
	const current = data && data.classId === active ? data : null;

	const { start } = lesson;
	const learn = useCallback(
		(topicId: string) => {
			const topic = current?.topics.find((t) => t.id === topicId);
			if (topic) void start({ title: topic.name, picks: practicePicks([topic], current?.facts ?? []) });
		},
		[current, start],
	);
	const startPractice = practice.start;
	const practiceDeadline = useCallback(
		(d: DeadlineProgress) => {
			if (!current) return;
			const topics = d.topics.map((t) => current.topics.find((x) => x.id === t.id)).filter((t): t is TopicProgress => !!t);
			void startPractice(topics, current.facts);
		},
		[current, startPractice],
	);

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
					classId={activeClass?.id ?? null}
					data={current}
					nowMs={nowMs}
					busy={lesson.busy || practice.busy}
					onPractice={practiceDeadline}
					onLearn={learn}
				/>
			</div>
			<ClassDialog mode={editMode} onClose={() => setEditing(false)} />
		</div>
	);
}

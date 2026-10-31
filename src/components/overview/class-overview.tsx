"use client";

import { useCallback, useMemo, useState } from "react";
import { PencilIcon } from "lucide-react";
import type { DeadlineProgress, TopicProgress } from "@/core";
import { useClasses } from "@/components/class-context";
import { ClassDialog } from "@/components/class-dialog";
import { LoadFailed } from "@/components/load-failed";
import { useMinute } from "@/components/countdown";
import { practicePicks, practiceTitle } from "@/components/graph/practice";
import { useLessonStart } from "@/components/home/use-lesson-start";
import { TopBar } from "@/components/top-bar";
import { useProgress } from "@/components/use-progress";
import { OverviewBody } from "./overview-body";

/**
 * THE CLASS OVERVIEW — opened from the sidebar's
 * Overview row. The top bar holds "Edit class" (the existing class
 * dialog); the body reads the active class's progress (useProgress).
 *
 * The runway's rings start practice on a deadline's topics (the lesson
 * the Graph page's "Practice these N" starts); "Most needed" → Learn this
 * starts a lesson on that topic the way the New lesson screen starts
 * lessons (useLessonStart: the topic name is the lesson's title and first
 * message, in the active class, and the topic's facts are its opening
 * picks).
 */
export function ClassOverview() {
	const { active, activeClass } = useClasses();
	const { data, error, refresh } = useProgress();
	const [editing, setEditing] = useState(false);
	// One start for Learn this and the rings, so the card shows the error
	// of whichever start ran last.
	const lesson = useLessonStart();
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
	const practiceDeadline = useCallback(
		(d: DeadlineProgress) => {
			if (!current) return;
			const topics = d.topics.map((t) => current.topics.find((x) => x.id === t.id)).filter((t): t is TopicProgress => !!t);
			if (topics.length > 0) void start({ title: practiceTitle(topics), kind: "practice", picks: practicePicks(topics, current.facts) });
		},
		[current, start],
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
					signature={activeClass?.signature}
					note={activeClass?.note}
					data={current}
					nowMs={nowMs}
					busy={lesson.busy}
					startError={lesson.error}
					onPractice={practiceDeadline}
					onLearn={learn}
					onAddSignature={() => setEditing(true)}
				/>
				{!current && error && <LoadFailed message="Couldn't load this class's progress." onRetry={refresh} className="px-[52px]" />}
			</div>
			<ClassDialog mode={editMode} onClose={() => setEditing(false)} />
		</div>
	);
}

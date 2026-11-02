"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { planDays, type TopicProgress } from "@/core";
import { useClasses } from "@/components/class-context";
import { ClassDialog } from "@/components/class-dialog";
import { dueLabel } from "@/components/class-deadlines-model";
import { useMinute } from "@/components/countdown";
import { useClassRecord } from "@/components/files/class-files-api";
import { practicePicks, practiceTitle } from "@/components/graph/practice";
import { askTeacher } from "@/components/halley/ask-teacher";
import { useLessonStart } from "@/components/home/use-lesson-start";
import { LoadFailed } from "@/components/load-failed";
import { TopBar } from "@/components/top-bar";
import { useProgress } from "@/components/use-progress";
import { DeadlineBody } from "./deadline-body";
import { deadlineMaterial, syllabusCheckMessage } from "./deadline-model";

/**
 * A deadline's page, opened from its ring on the Overview or its row in
 * Coming up. The page makes the deadline's class the active one (Coming up
 * lists every class); switching class afterwards goes to that class's
 * Overview. Start practices today's topics (all its topics once every one
 * is strong).
 */
export function DeadlinePage({ classId, deadlineId }: { classId: string; deadlineId: string }) {
	const router = useRouter();
	const { active, setActive, activeClass } = useClasses();
	const [joined, setJoined] = useState(active === classId);
	useEffect(() => {
		if (!joined) {
			if (active === classId) setJoined(true);
			else setActive(classId);
		} else if (active !== classId) router.replace("/class");
	}, [active, classId, joined, setActive, router]);

	const { data, error, refresh } = useProgress();
	const { record } = useClassRecord(classId);
	const nowMs = useMinute();
	const lesson = useLessonStart();
	// "class": Edit class as it opens anywhere; "deadline": with this deadline's row open.
	const [editing, setEditing] = useState<"class" | "deadline" | null>(null);

	const current = data && data.classId === classId ? data : null;
	const deadline = current?.deadlines.find((d) => d.id === deadlineId) ?? null;
	const material = useMemo(
		() => (record && deadline ? deadlineMaterial(record.files, deadline.files.map((f) => f.id), current?.files ?? []) : null),
		[record, deadline, current?.files],
	);
	const plan = useMemo(() => (current && deadline ? planDays(current.today, deadline.date, deadline.topics) : []), [current, deadline]);

	const { start } = lesson;
	const onStart = useCallback(() => {
		if (!current || !deadline) return;
		const ids = plan.length > 0 ? plan[0]!.topics.map((t) => t.id) : deadline.topics.map((t) => t.id);
		const topics = ids.map((id) => current.topics.find((t) => t.id === id)).filter((t): t is TopicProgress => !!t);
		if (topics.length > 0) void start({ title: practiceTitle(topics), kind: "practice", picks: practicePicks(topics, current.facts) });
	}, [current, deadline, plan, start]);
	const onCheckSyllabus = useCallback(() => {
		if (deadline) askTeacher(syllabusCheckMessage(activeClass?.name ?? "class", { name: deadline.name, when: dueLabel(deadline.date, deadline.time) }));
	}, [deadline, activeClass?.name]);

	const editMode = useMemo(
		() => (editing ? { kind: "edit" as const, classId, deadline: editing === "deadline" ? deadlineId : undefined } : null),
		[editing, classId, deadlineId],
	);

	return (
		<div className="flex h-full flex-col">
			<TopBar>
				<nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-2 text-sm">
					<Link href="/class" className="lh-press shrink-0 text-ink-2 hover:text-ink">
						{activeClass?.name ?? "Class"}
					</Link>
					<span className="text-ink-3" aria-hidden>
						/
					</span>
					<span className="min-w-0 truncate font-bold text-ink">{deadline?.name ?? ""}</span>
				</nav>
				<button
					type="button"
					data-testid="deadline-edit-class"
					onClick={() => setEditing("class")}
					className="lh-press flex items-center gap-[7px] bg-panel px-2.5 py-[7px] text-sm text-ink hover:bg-tone"
				>
					<PencilIcon className="size-3.5" aria-hidden />
					Edit class
				</button>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{current && !deadline ? (
					<div data-testid="deadline-removed" className="flex flex-col items-start gap-3 px-[52px] py-6">
						<p className="text-base text-ink-2">This deadline was removed.</p>
						<Link href="/class" className="lh-press bg-tone px-3.5 py-2 text-sm font-bold text-ink hover:bg-tone-2">
							Go to the class
						</Link>
					</div>
				) : current && deadline && nowMs !== null ? (
					<DeadlineBody
						deadline={deadline}
						topics={current.topics}
						material={material}
						plan={plan}
						nowMs={nowMs}
						busy={lesson.busy}
						startError={lesson.error}
						onStart={onStart}
						onEditClass={() => setEditing("deadline")}
						onCheckSyllabus={onCheckSyllabus}
					/>
				) : error ? (
					<LoadFailed message="Couldn't load this deadline." onRetry={refresh} className="px-[52px] py-6" />
				) : (
					// Plain boxes until the class's progress arrives, so nothing jumps.
					<div className="flex flex-col gap-4 px-[52px] py-6" aria-hidden>
						<div className="h-[96px] w-full bg-panel" />
						<div className="h-[320px] w-full bg-panel" />
					</div>
				)}
			</div>
			<ClassDialog mode={editMode} onClose={() => setEditing(null)} />
		</div>
	);
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_TEACHER_NAME, planDays } from "@/shared/core";
import { useClasses } from "@/frontend/components/class-context";
import { ClassDialog } from "@/frontend/components/class-dialog";
import { studioPath } from "@/frontend/components/cheat-sheet/use-cheat-sheet";
import { dueLabel } from "@/frontend/components/class-deadlines-model";
import { useMinute } from "@/frontend/components/countdown";
import { useClassRecord } from "@/frontend/components/files/class-files-api";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { askTeacher } from "@/frontend/components/halley/ask-teacher";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { LoadFailed } from "@/frontend/components/load-failed";
import { TopBar } from "@/frontend/components/app-bar";
import { pathLabel } from "@/frontend/components/app-bar-model";
import { useProgress } from "@/frontend/components/use-progress";
import { DeadlineBody } from "./deadline-body";
import { coverageMessage, deadlineMaterial } from "./deadline-model";

/**
 * A deadline's page, opened from its ring on the Overview or its row in
 * Coming up. The page makes the deadline's class the active one (Coming up
 * lists every class); switching class afterwards goes to that class's
 * Overview. Study works on today's topics (all its topics once every one
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
	const { record, reload } = useClassRecord(classId);
	const teacherName = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const nowMs = useMinute();
	const lesson = useLessonStart();
	// "class": Edit class as it opens anywhere; "deadline": with this deadline's row open.
	const [editing, setEditing] = useState<"class" | "deadline" | null>(null);

	const current = data && data.classId === classId ? data : null;
	const deadline = current?.deadlines.find((d) => d.id === deadlineId) ?? null;
	const saved = record?.deadlines?.find((d) => d.id === deadlineId) ?? null;
	const material = useMemo(
		() => (record && saved ? deadlineMaterial(record.files, saved, record.deadlines ?? [], current?.files ?? []) : null),
		[record, saved, current?.files],
	);
	// Add puts files on the deadline; Leave out marks them as not on it.
	const saveFiles = useCallback(
		async (fileIds: string[], add: boolean) => {
			if (!saved) return;
			const ids = new Set(fileIds);
			const patch = add
				? { fileIds: [...saved.fileIds, ...fileIds.filter((id) => !saved.fileIds.includes(id))], leftOutIds: (saved.leftOutIds ?? []).filter((id) => !ids.has(id)) }
				: { leftOutIds: [...(saved.leftOutIds ?? []), ...fileIds] };
			setSaving(true);
			setSaveError(null);
			try {
				const res = await fetch(`/api/classes/${encodeURIComponent(classId)}/deadlines/${encodeURIComponent(deadlineId)}`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(patch),
				});
				if (!res.ok) throw new Error();
				await Promise.all([reload(), refresh()]);
			} catch {
				setSaveError("Couldn't save that. Try again.");
			} finally {
				setSaving(false);
			}
		},
		[saved, classId, deadlineId, reload, refresh],
	);
	const plan = useMemo(() => (current && deadline ? planDays(current.today, deadline.date, deadline.topics) : []), [current, deadline]);

	const { studyDeadline } = lesson;
	const onStart = useCallback(() => {
		if (deadline) void studyDeadline(deadline);
	}, [deadline, studyDeadline]);
	const onAsk = useCallback(() => {
		if (deadline) askTeacher(coverageMessage(activeClass?.name ?? "class", { name: deadline.name, when: dueLabel(deadline.date, deadline.time) }));
	}, [deadline, activeClass?.name]);

	const editMode = useMemo(
		() => (editing ? { kind: "edit" as const, classId, deadline: editing === "deadline" ? deadlineId : undefined } : null),
		[editing, classId, deadlineId],
	);

	return (
		<div className="flex h-full flex-col">
			<TopBar path={[{ label: deadline ? pathLabel(deadline.name) : "deadline", href: null }]}>
				<button
					type="button"
					data-testid="deadline-edit-class"
					onClick={() => setEditing("class")}
					className="lh-btn"
				>
					Edit class
				</button>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{current && !deadline ? (
					<div data-testid="deadline-removed" className="flex flex-col items-start gap-3 px-[52px] py-6">
						<p className="text-base text-ink-2">This deadline was removed.</p>
						<Link href="/class" className="lh-btn">
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
						startError={lesson.error ?? saveError}
						onStart={onStart}
						onEditClass={() => setEditing("deadline")}
						source={saved?.source}
						teacherName={teacherName}
						saving={saving}
						onAsk={onAsk}
						onAdd={(ids) => void saveFiles(ids, true)}
						onLeaveOut={(ids) => void saveFiles(ids, false)}
						onCheatSheet={() => router.push(studioPath(deadlineId))}
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

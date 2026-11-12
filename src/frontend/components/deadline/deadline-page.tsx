import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { DEFAULT_TEACHER_NAME, hasProblems, planDays } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { DeadlineDialog } from "@/frontend/components/space-page/deadline-dialog";
import { studioPath } from "@/frontend/components/cheat-sheet/use-cheat-sheet";
import { dueLabel } from "@/frontend/components/space-deadlines-model";
import { useMinute } from "@/frontend/components/countdown";
import { spaceFilePathOf, useSpaceRecord } from "@/frontend/components/files/space-files-api";
import { useHalley } from "@/frontend/components/halley/halley-provider";
import { askTeacher } from "@/frontend/components/halley/ask-teacher";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { LoadFailed } from "@/frontend/components/load-failed";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useProgress } from "@/frontend/components/use-progress";
import { DeadlineBody } from "./deadline-body";
import { HomeworkCard } from "./homework-card";
import { coverageMessage, deadlineMaterial } from "./deadline-model";

/**
 * A deadline's page, opened from its row on Today, the space's Deadlines
 * tab or its Progress tab. The page makes the deadline's space the active
 * one (Today lists every space); switching space afterwards goes to that
 * space. Study works on today's topics (all its topics once every one is
 * strong).
 */
export function DeadlinePage({ spaceId, deadlineId }: { spaceId: string; deadlineId: string }) {
	const navigate = useNavigate();
	const { active, setActive, activeSpace } = useSpaces();
	const [joined, setJoined] = useState(active === spaceId);
	useEffect(() => {
		if (!joined) {
			if (active === spaceId) setJoined(true);
			else setActive(spaceId);
		} else if (active !== spaceId) navigate("/space", { replace: true });
	}, [active, spaceId, joined, setActive, navigate]);

	const { data, error, refresh } = useProgress();
	const { record, reload } = useSpaceRecord(spaceId);
	const teacherName = useHalley()?.name ?? DEFAULT_TEACHER_NAME;
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const nowMs = useMinute();
	const lesson = useLessonStart();
	const [editing, setEditing] = useState(false);

	const current = data && data.spaceId === spaceId ? data : null;
	const deadline = current?.deadlines.find((d) => d.id === deadlineId) ?? null;
	const saved = record?.deadlines?.find((d) => d.id === deadlineId) ?? null;
	const material = useMemo(
		() => (record && saved ? deadlineMaterial(record.files, saved, record.deadlines ?? [], current?.files ?? []) : null),
		[record, saved, current?.files],
	);
	const save = useCallback(
		async (patch: Record<string, unknown>) => {
			setSaving(true);
			setSaveError(null);
			try {
				const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/deadlines/${encodeURIComponent(deadlineId)}`, {
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
		[spaceId, deadlineId, reload, refresh],
	);
	// Add puts files on the deadline; Leave out marks them as not on it.
	const saveFiles = useCallback(
		(fileIds: string[], add: boolean) => {
			if (!saved) return;
			const ids = new Set(fileIds);
			void save(
				add
					? { fileIds: [...saved.fileIds, ...fileIds.filter((id) => !saved.fileIds.includes(id))], leftOutIds: (saved.leftOutIds ?? []).filter((id) => !ids.has(id)) }
					: { leftOutIds: [...(saved.leftOutIds ?? []), ...fileIds] },
			);
		},
		[saved, save],
	);
	const plan = useMemo(() => (current && deadline ? planDays(current.today, deadline.date, deadline.topics) : []), [current, deadline]);

	const { studyDeadline, workOnHomework } = lesson;
	const assignmentId = saved?.assignmentFileId;
	const openAssignment = useMemo(() => {
		const desktop = typeof window !== "undefined" ? window.lh : undefined;
		const file = record?.files.find((f) => f.id === assignmentId);
		if (!file || !desktop) return undefined;
		const open = /\.pdf$/i.test(file.name) ? desktop.openPath : desktop.showInFolder;
		return open && (() => void spaceFilePathOf(spaceId, file.id).then((path) => {
				if (path) void open(path);
			}));
	}, [record, assignmentId, spaceId]);
	const onStart = useCallback(() => {
		if (deadline) void studyDeadline(deadline);
	}, [deadline, studyDeadline]);
	const onAsk = useCallback(() => {
		if (deadline) askTeacher(coverageMessage(activeSpace?.name ?? "space", { name: deadline.name, when: dueLabel(deadline.date, deadline.time) }));
	}, [deadline, activeSpace?.name]);

	// The dialog compares its mode by identity: one object per open.
	const files = record?.files;
	const editMode = useMemo(() => (editing && saved && files ? { spaceId, deadline: saved, files } : null), [editing, spaceId, saved, files]);

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto flex w-full max-w-[1128px] flex-col gap-[22px] px-6 pt-[22px] pb-9">
				<Link to="/space/deadlines" data-testid="page-back" className="lh-btn lh-btn-quiet -ml-1 self-start text-[15px]">
					<PixelIcon name="chevron" className="-scale-x-100" />
					Deadlines
				</Link>
				{current && !deadline ? (
					<p data-testid="deadline-removed" className="text-lg text-ink-2">
						This deadline was removed.
					</p>
				) : current && deadline && nowMs !== null ? (
					<DeadlineBody
						deadline={deadline}
						color={activeSpace ? spaceColorVar(activeSpace.color) : "var(--border)"}
						topics={current.topics}
						material={material}
						plan={plan}
						nowMs={nowMs}
						busy={lesson.busy}
						startError={lesson.error ?? saveError}
						onStart={onStart}
						onEdit={() => setEditing(true)}
						source={saved?.source}
						teacherName={teacherName}
						saving={saving}
						onAsk={onAsk}
						onAdd={(ids) => saveFiles(ids, true)}
						onLeaveOut={(ids) => saveFiles(ids, false)}
						onCheatSheet={() => navigate(studioPath(deadlineId))}
						homework={
							hasProblems(deadline.kind) && (
								<HomeworkCard
									deadline={deadline}
									problems={saved?.problems ?? []}
									files={record?.files ?? []}
									assignmentId={assignmentId}
									busy={lesson.busy}
									saving={saving}
									onWork={() => void workOnHomework(deadline)}
									onPickAssignment={(id) => void save({ assignmentFileId: id })}
									onOpenAssignment={openAssignment}
									onMarkDone={(done) => void save({ done })}
								/>
							)
						}
					/>
				) : error ? (
					<LoadFailed message="Couldn't load this deadline." onRetry={refresh} />
				) : (
					// Plain boxes until the space's progress arrives, so nothing jumps.
					<div className="flex flex-col gap-[22px]" aria-hidden>
						<div className="h-[120px] w-full bg-panel" />
						<div className="h-[320px] w-full bg-panel" />
					</div>
				)}
			</div>
			<DeadlineDialog mode={editMode} onClose={() => setEditing(false)} onRemoved={() => navigate("/space/deadlines")} />
		</div>
	);
}

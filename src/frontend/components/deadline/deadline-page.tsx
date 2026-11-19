import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { DEFAULT_TEACHER_NAME, hasProblems, planDays } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { DeadlineDialog } from "@/frontend/components/space-page/deadline-dialog";
import { studioPath } from "@/frontend/components/cheat-sheet/use-cheat-sheet";
import { useMinute } from "@/frontend/components/countdown";
import { spaceFilePathOf } from "@/frontend/components/files/space-files-api";
import { useSpaceRecord } from "@/frontend/components/files/space-record";
import { jsonInit } from "@/frontend/lib/api";
import { useTeacher } from "@/frontend/components/teacher/teacher-provider";
import { useLessonStart } from "@/frontend/components/home/use-lesson-start";
import { LoadFailed } from "@/frontend/components/load-failed";
import { useProgress } from "@/frontend/components/use-progress";
import { JobFrame } from "@/frontend/components/work/job-frame";
import { AboutSheet } from "./about-sheet";
import { DeadlineBody } from "./deadline-body";
import { HomeworkCard } from "./homework-card";
import { deadlineMaterial } from "./deadline-model";
import { canWriteMock, takesMocks } from "./mocks-model";
import { PathMocks } from "./path-mocks";
import { requestDoing, requestFailedLine, type RequestKind } from "./request-model";
import { useDeadlineAbout } from "./use-deadline-about";
import { useDeadlineMocks } from "./use-deadline-mocks";
import { useDeadlineRequest } from "./use-deadline-request";

/**
 * A deadline's page, opened from its row on Today, the space's Deadlines
 * tab or its Progress tab; the bar's tabs lead back. The page makes
 * the deadline's space the active one (Today lists every space);
 * switching space afterwards goes to that space. Study works on today's
 * topics (all its topics once every one is strong). A test or interview
 * also has its mocks.
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
	const teacherName = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
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
				const res = await fetch(`/api/spaces/${encodeURIComponent(spaceId)}/deadlines/${encodeURIComponent(deadlineId)}`, jsonInit("PUT", patch));
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
	const request = useDeadlineRequest(spaceId, deadlineId);
	const { state: requestState, askError, ask } = request;
	const requestLine = useCallback((kind: RequestKind) => requestFailedLine(requestState, askError, kind, teacherName), [requestState, askError, teacherName]);
	const onRequest = useCallback((kind: RequestKind) => void ask(kind), [ask]);
	const running = requestState?.running ?? null;

	const aboutFile = record?.files.find((f) => f.id === saved?.aboutFileId);
	const { about, reload: reloadAbout } = useDeadlineAbout(spaceId, deadlineId, aboutFile ? `${aboutFile.id}:${aboutFile.contentFp}` : null);
	const withMocks = !!deadline && takesMocks(deadline.kind);
	const mocks = useDeadlineMocks(spaceId, withMocks ? deadlineId : null);

	// The dialog compares its mode by identity: one object per open.
	const files = record?.files;
	const editMode = useMemo(() => (editing && saved && files ? { spaceId, deadline: saved, files } : null), [editing, spaceId, saved, files]);

	return (
		<JobFrame doing={running && requestDoing(running)}>
			<div className="h-full overflow-y-auto">
				<div className="lh-page pt-(--lh-page-top) pb-(--lh-page-end)">
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
							requesting={running !== null}
							requestLine={requestLine}
							onRequest={onRequest}
							onAdd={(ids) => saveFiles(ids, true)}
							onLeaveOut={(ids) => saveFiles(ids, false)}
							onCheatSheet={() => navigate(studioPath(deadlineId))}
							about={
								about && (
									<AboutSheet about={about} teacherName={teacherName} requesting={running !== null} requestLine={requestLine("about")} onAsk={() => onRequest("about")} onRetry={reloadAbout} />
								)
							}
							mocks={
								withMocks && (
									<PathMocks
										spaceId={spaceId}
										mocks={mocks.mocks}
										failed={mocks.failed}
										done={deadline.done}
										canTake={canWriteMock(deadline.topics.length > 0, about?.state === "ready")}
										nowMs={nowMs}
										onRetry={() => void mocks.reload()}
										onWrite={mocks.write}
										onRemove={mocks.remove}
									/>
								)
							}
							homework={
								hasProblems(deadline.kind) && (
									<HomeworkCard
										deadline={deadline}
										problems={saved?.problems ?? []}
										files={record?.files ?? []}
										assignmentId={assignmentId}
										busy={lesson.busy}
										error={lesson.error ?? saveError}
										saving={saving}
										onStudy={onStart}
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
						<div className="flex flex-col gap-(--lh-head-gap)" aria-hidden>
							<div className="h-[120px] w-full bg-panel" />
							<div className="h-[320px] w-full bg-panel" />
						</div>
					)}
				</div>
				<DeadlineDialog mode={editMode} onClose={() => setEditing(false)} onRemoved={() => navigate("/space/deadlines")} />
			</div>
		</JobFrame>
	);
}

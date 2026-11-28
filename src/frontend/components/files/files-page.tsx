import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/frontend/lib/utils";
import { LoadingLine, useWaited } from "@/frontend/components/loading";
import { DEFAULT_TEACHER_NAME, fileGroups, type FileCoverage, type FileWork, type FolderStatus } from "@/shared/core";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { useSpaces } from "@/frontend/components/space-context";
import { useMinute } from "@/frontend/components/countdown";
import { LoadFailed } from "@/frontend/components/load-failed";
import { Hint } from "@/frontend/components/ui/hint";
import { CountBlock } from "@/frontend/components/ui/count-block";
import { Pane } from "@/frontend/components/ui/pane";
import { spaceColorVar } from "@/frontend/components/space-color";
import { BarFind } from "@/frontend/components/top-bar/bar-find";
import { BarActions } from "@/frontend/components/top-bar/bar-slots";
import { useBarFind } from "@/frontend/components/use-bar-find";
import { useProgress } from "@/frontend/components/use-progress";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { ON_INK_MAIN, PICKED_COLUMN, PickedBar } from "@/frontend/components/picked-bar";
import { Key } from "@/frontend/components/ui/key";
import { useLessonStart } from "@/frontend/components/study-page/use-lesson-start";
import type { WriteResult } from "@/frontend/lib/api";
import { readStorage, writeStorage } from "@/frontend/lib/storage";
import { AddFilesButton } from "./add-files";
import {
	linkSpaceFolder,
	removeSpaceFile,
	retrySpaceFile,
	setSpaceFileKind,
	unlinkSpaceFolder,
	uploadSpaceFiles,
} from "./space-files-api";
import { showSpaceFile } from "./show-space-file";
import { useSpaceRecord } from "./space-record";
import { ConfirmDialog } from "./confirm-dialog";
import type { FileRowActions, RowPick } from "./file-row";
import { FileGroupSection } from "./files-sections";
import { askInsideLine, confirmCopy, dropTitle, entryRows, fileBrowserName, filesSummary, filterGroups, type FileConfirm } from "./files-model";
import { FULL_LINE, MAX_LESSON_FILES, keepListed, pickedNames, togglePick } from "./files-pick-model";
import { newSince } from "./folder-status-model";
import { FolderStatusLine, LinkedFolderButton, LinkFolderButton, LinkFolderField, ROW_BUTTON } from "./linked-folder";
import { RECENT_CHANGES_KEY, RecentChanges } from "./recent-changes";
import { recentChanges, removedLately } from "./recent-changes-model";
import { PickSpace } from "@/frontend/components/pick-space";

/**
 * THE FILES PAGE (a space tab): Find, the linked folder and Add files are
 * words in the top bar; on the page, the summary with the folder's live
 * line, then Recent changes and
 * the space's files in groups found from their names (a lecture's notes and
 * transcript together, with the date when a name has one). Files dropped
 * from Finder anywhere on the page are added too. Each added file's first
 * read sorts it into study material or space info. Unlink, Remove and Move
 * to Space info ask first, saying how many facts go.
 *
 * "Pick files to study" in the head, or a click on a row, starts picking: every
 * row shows a tick box and the picked bar rises, with the picked names, Clear
 * (Cancel while none is picked) and Study, which starts a lesson on them in the
 * order they were picked. Picks last while the learner stays on the page.
 *
 * Coverage and work (problems, lesson) per file come from the shared
 * progress payload; the record re-reads on spaces-changed, so statuses
 * update as files are built, and each minute while a folder is linked, so
 * its "checked" time stays true.
 */
export function FilesPage() {
	const { active } = useSpaces();
	// Keyed by space, so a space switch starts clean.
	return <FilesPageBody key={active ?? "none"} />;
}

const NO_FOLDER_STATUS: FolderStatus = { problem: null, checkedAt: null, settling: 0 };

const collapsedKey = (spaceId: string) => `lh:files-collapsed:${spaceId}`;

/** Folded groups, remembered per space in this browser only. */
function useCollapsed(spaceId: string | null) {
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
		if (!spaceId) return new Set();
		try {
			const saved: unknown = JSON.parse(readStorage(collapsedKey(spaceId)) ?? "[]");
			return new Set(Array.isArray(saved) ? saved.filter((k): k is string => typeof k === "string") : []);
		} catch {
			return new Set();
		}
	});
	const toggle = useCallback(
		(key: string) =>
			setCollapsed((prev) => {
				const next = new Set(prev);
				if (!next.delete(key)) next.add(key);
				if (spaceId) writeStorage(collapsedKey(spaceId), JSON.stringify([...next]));
				return next;
			}),
		[spaceId],
	);
	return { collapsed, toggle };
}

function FilesPageBody() {
	const { active, activeSpace } = useSpaces();
	const color = activeSpace ? spaceColorVar(activeSpace.color) : "var(--border)";
	const { record, folder, shortcuts, failed, reload } = useSpaceRecord(active);
	const waited = useWaited(!!record);
	const minute = useMinute();
	const linked = !!record?.linkedFolder;
	// A new minute (not the first one) re-reads the folder's status.
	const shownMinute = useRef(minute);
	useEffect(() => {
		const prev = shownMinute.current;
		shownMinute.current = minute;
		if (linked && prev !== null && minute !== prev) void reload();
	}, [linked, minute, reload]);
	const { data } = useProgress();
	const teacherApi = useTeacher();
	const teacher = teacherApi?.name ?? DEFAULT_TEACHER_NAME;
	const askTeacher = teacherApi?.canAsk ? teacherApi.ask : null;
	const [confirm, setConfirm] = useState<FileConfirm | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(0);
	const [linking, setLinking] = useState(false);
	const [finderDrag, setFinderDrag] = useState<number | null>(null);
	const { collapsed, toggle } = useCollapsed(active);
	const spaceId = record?.id ?? null;
	const find = useBarFind((record?.files.length ?? 0) > 0);
	const { query } = find;
	const folderStatus = folder ?? NO_FOLDER_STATUS;

	const coverage = useMemo(() => {
		const map = new Map<string, FileCoverage>();
		if (data && data.spaceId === active) for (const f of data.files) map.set(f.fileId, f);
		return map;
	}, [data, active]);
	const work = useMemo(() => {
		const map = new Map<string, FileWork>();
		if (data && data.spaceId === active) for (const w of data.fileWork) map.set(w.fileId, w);
		return map;
	}, [data, active]);

	const lesson = useLessonStart();
	const study = useGuardedAction();
	const { setError: setStudyError } = study;
	const [picked, setPicked] = useState<readonly string[]>([]);
	const [picking, setPicking] = useState(false);
	const boxes = picking || picked.length > 0;
	// A click on a held row says why it no longer picks, where a refusal shows.
	const onPick = useCallback(
		(fileId: string, held: boolean) => {
			setStudyError(held ? FULL_LINE : null);
			if (!held) setPicked((p) => togglePick(p, fileId));
		},
		[setStudyError],
	);
	const clearPicks = useCallback(() => {
		setStudyError(null);
		setPicked([]);
		setPicking(false);
	}, [setStudyError]);
	const full = picked.length >= MAX_LESSON_FILES;
	const pickOf = useCallback((fileId: string): RowPick => (picked.includes(fileId) ? "picked" : full ? "held" : "free"), [picked, full]);
	const pickedLine = useMemo(() => pickedNames(picked, new Map(record?.files.map((f) => [f.id, f.name]))), [picked, record]);
	const groups = useMemo(() => fileGroups(record?.files ?? []), [record]);
	// A picked file whose row goes (it left the space, or a .tex joined its PDF's row) leaves the picks.
	useEffect(() => {
		if (record) setPicked((p) => keepListed(p, new Set(groups.flatMap((g) => g.items.flatMap((i) => entryRows(i.files).map((r) => r.file.id))))));
	}, [record, groups]);
	const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
	const searching = query.trim() !== "";
	const arrived = useMemo(() => (record && minute !== null ? newSince(record.files, minute) : null), [record, minute]);
	const removed = useMemo(() => (record && minute !== null ? removedLately(record.removedFiles ?? [], minute) : null), [record, minute]);
	const changes = useMemo(() => (record && minute !== null ? recentChanges(record.files, record.removedFiles ?? [], minute) : []), [record, minute]);

	/** Run one write: busy while in flight, its error shown. */
	const run = useCallback(async (write: () => Promise<WriteResult>) => {
		setBusy((n) => n + 1);
		setError(null);
		try {
			const failed = await write();
			if (failed) setError(failed);
			return failed === null;
		} finally {
			setBusy((n) => n - 1);
		}
	}, []);

	const actions = useMemo<FileRowActions | null>(() => {
		if (!spaceId) return null;
		const desktop = typeof window !== "undefined" ? window.lh?.showInFolder : undefined;
		return {
			onKind: (file, kind) => {
				if (kind === "info") setConfirm({ kind: "move", file });
				else void run(() => setSpaceFileKind(spaceId, file.id, kind));
			},
			onRetry: (fileId) => void run(() => retrySpaceFile(spaceId, fileId)),
			onRemove: (file) => setConfirm({ kind: "remove", file }),
			show: desktop && {
				label: `Show in ${fileBrowserName(window.lh?.platform)}`,
				run: (fileId) =>
					void showSpaceFile(spaceId, fileId, "folder").then((failed) => {
						if (failed) setError(failed);
					}),
			},
		};
	}, [spaceId, run]);
	const openPath = typeof window !== "undefined" ? window.lh?.openPath : undefined;

	const link = useCallback(
		(path: string) => {
			if (!spaceId) return;
			void run(() => linkSpaceFolder(spaceId, path)).then((ok) => {
				if (ok) setLinking(false);
			});
		},
		[spaceId, run],
	);
	const onLinkFolder = useCallback(() => {
		const pick = typeof window !== "undefined" ? window.lh?.pickFolder : undefined;
		if (!pick) {
			setLinking(true);
			return;
		}
		void pick().then((path) => {
			if (path) link(path);
		});
	}, [link]);

	const disabled = busy > 0;
	const add = useCallback(
		(files: File[]) => {
			if (spaceId) void run(() => uploadSpaceFiles(spaceId, files));
		},
		[spaceId, run],
	);
	const confirmText = useMemo(() => (confirm && record ? confirmCopy(confirm, record.name, record.files, coverage) : null), [confirm, record, coverage]);
	const closeConfirm = useCallback(() => setConfirm(null), []);
	const onConfirm = () => {
		setConfirm(null);
		if (!spaceId || !confirm) return;
		if (confirm.kind === "unlink") void run(() => unlinkSpaceFolder(spaceId));
		else if (confirm.kind === "remove") void run(() => removeSpaceFile(spaceId, confirm.file.id));
		else void run(() => setSpaceFileKind(spaceId, confirm.file.id, "info"));
	};

	const showRecent = !searching && changes.length > 0;
	const noMatch = (
		<p data-testid="files-no-match" className="text-ui text-ink-2">
			No file names have “{query.trim()}”.
		</p>
	);
	const showInFinder = shortcuts && openPath && (
		<Hint label={`Shortcuts to these files in your godspeed folder, for you and ${teacher}.`} side="bottom">
			<button type="button" data-testid="files-show-shortcuts" onClick={() => void openPath(shortcuts)} className={ROW_BUTTON}>
				Show in {fileBrowserName(window.lh?.platform)}
			</button>
		</Hint>
	);

	return (
		<div
			className={cn("h-full overflow-y-auto", PICKED_COLUMN)}
			data-testid="files-page"
			onDragOver={(e) => {
				if (!Array.from(e.dataTransfer.types).includes("Files")) return;
				e.preventDefault();
				const takes = !!record && !disabled;
				e.dataTransfer.dropEffect = takes ? "copy" : "none";
				if (takes) setFinderDrag(e.dataTransfer.items.length);
			}}
			onDragLeave={(e) => {
				if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
				setFinderDrag(null);
			}}
			onDrop={(e) => {
				e.preventDefault();
				setFinderDrag(null);
				const files = Array.from(e.dataTransfer.files);
				if (record && !disabled && files.length > 0) add(files);
			}}
		>
			<h1 className="sr-only">Files</h1>
			<div className={cn("@container/page lh-page flex flex-1 flex-col gap-(--lh-gap) pt-(--lh-gap) pb-(--lh-page-end)", waited && "lh-set")}>
				{!active && <PickSpace line="Pick a space to see its files." />}
				{active && !record && !failed && <LoadingLine className="text-ui" />}
				{active && !record && failed && <LoadFailed message="Couldn't load this space's files." onRetry={() => void reload()} />}
				{record && actions && (
					<>
						<BarActions>
							{record.files.length > 0 && (
								<BarFind label="Find a file" testIds={{ key: "files-find", field: "files-search" }} open={find.open} onOpen={find.start} query={find.query} onQuery={find.setQuery} inputRef={find.inputRef} keyRef={find.keyRef} onKeyDown={find.onKeyDown} onClose={find.close} />
							)}
							{!find.open && (
								<>
									{record.linkedFolder ? (
										<LinkedFolderButton
											path={record.linkedFolder}
											status={folderStatus}
											disabled={disabled}
											open={openPath && { label: `Show in ${fileBrowserName(window.lh?.platform)}`, run: () => void openPath(record.linkedFolder!) }}
											onPickAgain={onLinkFolder}
											onUnlink={() => setConfirm({ kind: "unlink" })}
										/>
									) : (
										!linking && <LinkFolderButton disabled={disabled} onClick={onLinkFolder} />
									)}
									<AddFilesButton disabled={disabled} onAdd={add} />
								</>
							)}
						</BarActions>
						{linking && <LinkFolderField initial={record.linkedFolder ?? ""} disabled={disabled} onLink={link} onCancel={() => setLinking(false)} />}
						{(record.files.length > 0 || record.linkedFolder || showInFinder) && (
							<Pane data-testid="files-head" className="flex items-center overflow-hidden">
								{record.files.length > 0 && (
									<CountBlock color={color} count={String(record.files.length)} unit={record.files.length === 1 ? "file" : "files"} size="card" className="min-h-[96px]" />
								)}
								{/* The keys drop under the words where the words would be squeezed. */}
								<div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-2.5 px-(--lh-inset) py-4">
									<div className="flex min-w-0 flex-1 basis-[240px] flex-col gap-1">
										{record.files.length > 0 && (
											<p data-testid="files-summary" className="text-head leading-tight text-ink">
												{filesSummary(record.files)}
												{arrived && `, ${arrived}`}
												{removed && `, ${removed}`}
											</p>
										)}
										{record.linkedFolder && <FolderStatusLine path={record.linkedFolder} status={folderStatus} now={minute} />}
									</div>
									{showInFinder}
									{record.files.length > 0 && !boxes && (
										<button type="button" data-testid="files-pick" onClick={() => setPicking(true)} className="lh-btn shrink-0">
											Pick files to study
										</button>
									)}
								</div>
							</Pane>
						)}
						{error && (
							<p role="alert" data-testid="space-files-error" className="text-ui whitespace-pre-wrap text-ans-wrong">
								{error}
							</p>
						)}
						{finderDrag !== null && (
							<div data-testid="files-drop" className="flex h-[110px] items-center justify-center lh-well lh-notch px-4 text-center text-item font-medium text-ink">
								{dropTitle(finderDrag)}
							</div>
						)}
						{record.files.length === 0 && finderDrag === null && (
							<Pane data-testid="files-empty" className="lh-card gap-1.5">
								<span className="text-item text-ink">Add notes, readings, recordings or a syllabus, or drop them here.</span>
								<span className="text-ui text-ink-2">PDF, Markdown, text, VTT/SRT, audio, video</span>
							</Pane>
						)}
						{searching && shown.length === 0 && (
							askTeacher ? (
								<Pane className="lh-card flex-row flex-wrap items-center justify-end gap-4">
									<div className="min-w-0 flex-1 basis-[160px]">{noMatch}</div>
									<Key data-testid="files-ask-inside" onClick={() => askTeacher(askInsideLine(query))} className="shrink-0">
										Ask {teacher} to look inside
									</Key>
								</Pane>
							) : (
								noMatch
							)
						)}
						{(showRecent || shown.length > 0) && (
							// Wide, recent changes take a column beside the files.
							<div data-testid="files-list" className="grid items-start gap-(--lh-gap) @[1100px]/page:grid-cols-[minmax(0,1fr)_400px]">
								{showRecent && (
									<div className="@[1100px]/page:col-start-2 @[1100px]/page:row-start-1">
										<RecentChanges changes={changes} collapsed={collapsed.has(RECENT_CHANGES_KEY)} onToggle={toggle} />
									</div>
								)}
								<div className="flex min-w-0 flex-col gap-3 @[1100px]/page:row-start-1">
									{shown.map((group) => (
										<FileGroupSection
											key={group.key}
											group={group}
											collapsed={!searching && collapsed.has(group.key)}
											onToggle={toggle}
											coverage={coverage}
											work={work}
											pickOf={pickOf}
											onPick={onPick}
											boxes={boxes}
											disabled={disabled}
											teacher={teacher}
											actions={actions}
										/>
									))}
								</div>
							</div>
						)}
					</>
				)}
			</div>
			<PickedBar open={boxes} line={picked.length > 0 ? pickedLine : "No files picked yet"} clearLabel={picked.length > 0 ? "Clear" : "Cancel"} failure={study.error} testids={{ bar: "files-picked-bar", line: "files-picked-names", clear: "files-picked-clear" }} onClear={clearPicks}>
				<Key data-testid="files-picked-study" busy={study.busy} disabled={picked.length === 0} onClick={() => void study.run(() => lesson.studyFiles(picked))} className={ON_INK_MAIN}>
					Study
				</Key>
			</PickedBar>
			<ConfirmDialog copy={confirmText} onConfirm={onConfirm} onClose={closeConfirm} />
		</div>
	);
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileGroups, type FileCoverage, type FolderStatus } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useClasses } from "@/frontend/components/class-context";
import { useMinute } from "@/frontend/components/countdown";
import { LoadFailed } from "@/frontend/components/load-failed";
import { Hint } from "@/frontend/components/ui/hint";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useProgress } from "@/frontend/components/use-progress";
import { AddFilesButton } from "./add-files";
import {
	classFilePathOf,
	linkClassFolder,
	removeClassFile,
	retryClassFile,
	setClassFileKind,
	unlinkClassFolder,
	uploadClassFiles,
	useClassRecord,
	type WriteResult,
} from "./class-files-api";
import { ConfirmDialog } from "./confirm-dialog";
import type { FileRowActions } from "./file-row";
import { FileGroupSection, FinderDropTargets } from "./files-sections";
import { confirmCopy, fileBrowserName, filesSummary, filterGroups, listRules, type FileConfirm } from "./files-model";
import { newSince } from "./folder-status-model";
import { FolderStatusLine, LinkedFolderButton, LinkFolderButton, LinkFolderField, ROW_BUTTON } from "./linked-folder";
import { RECENT_CHANGES_KEY, RecentChanges } from "./recent-changes";
import { recentChanges, removedLately } from "./recent-changes-model";
import { PickClass } from "@/frontend/components/pick-class";

/**
 * THE FILES PAGE (a class tab): Add files (pick the kind first), a search
 * field, the linked folder, the summary and the folder's live line, then
 * Recent changes and the class's files in groups found from their names
 * (a lecture's notes and transcript together, with the date when a name
 * has one). Dragging files from Finder over the page shows two
 * places to drop them: Study material or Course info. Unlink, Remove and
 * Move to Course info ask first, saying how many facts go.
 *
 * Coverage per file comes from the shared progress payload; the record
 * re-reads on classes-changed, so statuses update as files are built, and
 * each minute while a folder is linked, so its "checked" time stays true.
 */
export function FilesPage() {
	const { active } = useClasses();
	// Keyed by class, so a class switch starts clean.
	return <FilesPageBody key={active ?? "none"} />;
}

const NO_FOLDER_STATUS: FolderStatus = { problem: null, checkedAt: null, settling: 0 };

const collapsedKey = (classId: string) => `lh:files-collapsed:${classId}`;

/** Folded groups, remembered per class in this browser only. */
function useCollapsed(classId: string | null) {
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
		if (!classId) return new Set();
		try {
			const saved: unknown = JSON.parse(window.localStorage.getItem(collapsedKey(classId)) ?? "[]");
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
				try {
					if (classId) window.localStorage.setItem(collapsedKey(classId), JSON.stringify([...next]));
				} catch {
					// Only a convenience: the page works without it.
				}
				return next;
			}),
		[classId],
	);
	return { collapsed, toggle };
}

function FilesPageBody() {
	const { active } = useClasses();
	const { record, folder, shortcuts, failed, reload } = useClassRecord(active);
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
	const agentTeaching = useAgentStatus()?.teaching ?? true;
	const [confirm, setConfirm] = useState<FileConfirm | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(0);
	const [linking, setLinking] = useState(false);
	const [query, setQuery] = useState("");
	const [finderDrag, setFinderDrag] = useState<number | null>(null);
	const { collapsed, toggle } = useCollapsed(active);
	const classId = record?.id ?? null;
	const folderStatus = folder ?? NO_FOLDER_STATUS;

	const coverage = useMemo(() => {
		const map = new Map<string, FileCoverage>();
		if (data && data.classId === active) for (const f of data.files) map.set(f.fileId, f);
		return map;
	}, [data, active]);
	const groups = useMemo(() => fileGroups(record?.files ?? []), [record]);
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
		if (!classId) return null;
		const showInFolder = typeof window !== "undefined" ? window.lh?.showInFolder : undefined;
		return {
			onKind: (file, kind) => {
				if (kind === "info") setConfirm({ kind: "move", file });
				else void run(() => setClassFileKind(classId, file.id, kind));
			},
			onRetry: (fileId) => void run(() => retryClassFile(classId, fileId)),
			onRemove: (file) => setConfirm({ kind: "remove", file }),
			show: showInFolder && {
				label: `Show in ${fileBrowserName(window.lh?.platform)}`,
				run: (fileId) =>
					void classFilePathOf(classId, fileId).then((path) => {
						if (path) void showInFolder(path);
						else setError("Can't find this file on your computer.");
					}),
			},
		};
	}, [classId, run]);
	const openPath = typeof window !== "undefined" ? window.lh?.openPath : undefined;

	const link = useCallback(
		(path: string) => {
			if (!classId) return;
			void run(() => linkClassFolder(classId, path)).then((ok) => {
				if (ok) setLinking(false);
			});
		},
		[classId, run],
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
		(kind: "study" | "info", files: File[]) => {
			setFinderDrag(null);
			if (classId) void run(() => uploadClassFiles(classId, files, kind));
		},
		[classId, run],
	);
	const confirmText = useMemo(() => (confirm && record ? confirmCopy(confirm, record.name, record.files, coverage) : null), [confirm, record, coverage]);
	const closeConfirm = useCallback(() => setConfirm(null), []);
	const onConfirm = () => {
		setConfirm(null);
		if (!classId || !confirm) return;
		if (confirm.kind === "unlink") void run(() => unlinkClassFolder(classId));
		else if (confirm.kind === "remove") void run(() => removeClassFile(classId, confirm.file.id));
		else void run(() => setClassFileKind(classId, confirm.file.id, "info"));
	};

	const showRecent = !searching && changes.length > 0;
	const rules = listRules([...(showRecent ? [true] : []), ...shown.map((g) => searching || !collapsed.has(g.key))]);
	const groupRules = showRecent ? rules.slice(1) : rules;
	const showInFinder = shortcuts && openPath && (
		<Hint label="Shortcuts to these files in your godspeed folder, for you and your agent." side="bottom">
			<button type="button" data-testid="files-show-shortcuts" onClick={() => void openPath(shortcuts)} className={ROW_BUTTON}>
				Show in {fileBrowserName(window.lh?.platform)}
			</button>
		</Hint>
	);

	return (
		<div
			className="h-full overflow-y-auto"
			data-testid="files-page"
			onDragOver={(e) => {
				if (!Array.from(e.dataTransfer.types).includes("Files")) return;
				// Only the two drop targets take files.
				e.preventDefault();
				e.dataTransfer.dropEffect = "none";
				if (record && !disabled) setFinderDrag(e.dataTransfer.items.length);
			}}
			onDragLeave={(e) => {
				if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
				setFinderDrag(null);
			}}
			onDrop={(e) => {
				e.preventDefault();
				setFinderDrag(null);
			}}
		>
			<h1 className="sr-only">Files</h1>
			<div className="mx-auto flex w-full max-w-[908px] flex-col gap-[18px] px-6 pt-[18px] pb-10">
				{!active && <PickClass line="Pick a class to see its files." />}
				{active && !record && !failed && <p className="text-[15px] text-ink-2">Loading…</p>}
				{active && !record && failed && <LoadFailed message="Couldn't load this class's files." onRetry={() => void reload()} />}
				{record && actions && (
					<>
						<AddFilesButton disabled={disabled} onAdd={add} />
						<div className="flex flex-wrap items-center gap-2.5">
							{record.files.length > 0 && <SearchBox value={query} onChange={setQuery} />}
							{record.linkedFolder ? (
								<LinkedFolderButton
									path={record.linkedFolder}
									status={folderStatus}
									disabled={disabled}
									open={openPath && { label: `Open in ${fileBrowserName(window.lh?.platform)}`, run: () => void openPath(record.linkedFolder!) }}
									onPickAgain={onLinkFolder}
									onUnlink={() => setConfirm({ kind: "unlink" })}
								/>
							) : (
								!linking && <LinkFolderButton disabled={disabled} onClick={onLinkFolder} />
							)}
							{showInFinder}
						</div>
						{linking && <LinkFolderField initial={record.linkedFolder ?? ""} disabled={disabled} onLink={link} onCancel={() => setLinking(false)} />}
						{(record.files.length > 0 || record.linkedFolder) && (
							<div className="flex flex-col gap-[3px]">
								{record.files.length > 0 && (
									<p data-testid="files-summary" className="text-[15px] text-ink-2">
										{filesSummary(record.files)}
										{arrived && `, ${arrived}`}
										{removed && `, ${removed}`}
									</p>
								)}
								{record.linkedFolder && <FolderStatusLine path={record.linkedFolder} status={folderStatus} now={minute} />}
							</div>
						)}
						{error && (
							<p role="alert" data-testid="class-files-error" className="text-[15px] whitespace-pre-wrap text-ans-wrong">
								{error}
							</p>
						)}
						{finderDrag !== null && <FinderDropTargets count={finderDrag} onDrop={add} />}
						{record.files.length === 0 && finderDrag === null && (
							<Pane data-testid="files-empty" className="flex flex-col gap-1.5 p-7">
								<span className="text-[17px] text-ink">Add lecture notes, readings, recordings or the syllabus, or drop them here.</span>
								<span className="text-[15px] text-ink-2">PDF, Markdown, text, VTT/SRT, audio, video</span>
							</Pane>
						)}
						{searching && shown.length === 0 && (
							<p data-testid="files-no-match" className="text-[15px] text-ink-2">
								No file names have “{query.trim()}”.
							</p>
						)}
						{rules.length > 0 && (
							<div data-testid="files-list" className="flex flex-col border-y-[1.5px] border-ink">
								{showRecent && <RecentChanges changes={changes} collapsed={collapsed.has(RECENT_CHANGES_KEY)} onToggle={toggle} />}
								{shown.map((group, i) => (
									<FileGroupSection
										key={group.key}
										group={group}
										rule={groupRules[i] ?? null}
										collapsed={!searching && collapsed.has(group.key)}
										onToggle={toggle}
										coverage={coverage}
										disabled={disabled}
										agentTeaching={agentTeaching}
										actions={actions}
									/>
								))}
							</div>
						)}
					</>
				)}
			</div>
			<ConfirmDialog copy={confirmText} onConfirm={onConfirm} onClose={closeConfirm} />
		</div>
	);
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	return (
		<label className="flex h-10 min-w-[200px] flex-1 items-center gap-2 rounded border-[1.5px] border-ink bg-background px-3 text-ink-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ink">
			<input
				type="search"
				data-testid="files-search"
				aria-label="Find a file"
				placeholder="Find a file"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
			/>
			{value && (
				<button type="button" aria-label="Clear" data-testid="files-search-clear" onClick={() => onChange("")} className="lh-press shrink-0 hover:text-ink">
					<PixelIcon name="close" className="h-2.5" />
				</button>
			)}
		</label>
	);
}

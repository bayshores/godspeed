"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderOpenIcon, SearchIcon, XIcon } from "lucide-react";
import { fileGroups, type FileCoverage } from "@/core";
import { useAgentStatus } from "@/components/agent-status";
import { useClasses } from "@/components/class-context";
import { useMinute } from "@/components/countdown";
import { LoadFailed } from "@/components/load-failed";
import { TopBar } from "@/components/top-bar";
import { Hint } from "@/components/ui/hint";
import { useProgress } from "@/components/use-progress";
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
import { confirmCopy, fileBrowserName, filesSummary, filterGroups, type FileConfirm } from "./files-model";
import { newSince } from "./folder-status-model";
import { LinkedFolderChip, LinkFolderButton, LinkFolderField } from "./linked-folder";
import { PickClass } from "@/components/pick-class";

/**
 * THE FILES PAGE: the active class's files in groups found from their
 * names (a lecture's notes and transcript together, with the date when a
 * name has one), a search box, Add files (pick the kind first) and the
 * linked folder. Dragging files from Finder over the page shows two
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

	const coverage = useMemo(() => {
		const map = new Map<string, FileCoverage>();
		if (data && data.classId === active) for (const f of data.files) map.set(f.fileId, f);
		return map;
	}, [data, active]);
	const groups = useMemo(() => fileGroups(record?.files ?? []), [record]);
	const names = useMemo(() => new Map((record?.files ?? []).map((f) => [f.id, f.name])), [record]);
	const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
	const searching = query.trim() !== "";
	const arrived = useMemo(() => (record && minute !== null ? newSince(record.files, minute) : null), [record, minute]);

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

	return (
		<div
			className="flex h-full flex-col"
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
			<TopBar>
				<div className="flex-1" />
				{record && (
					<>
						{record.linkedFolder ? (
							<LinkedFolderChip
								path={record.linkedFolder}
								status={folder ?? { problem: null, checkedAt: null, settling: 0 }}
								now={minute}
								disabled={disabled}
								open={openPath && { label: `Open in ${fileBrowserName(window.lh?.platform)}`, run: () => void openPath(record.linkedFolder!) }}
								onPickAgain={onLinkFolder}
								onUnlink={() => setConfirm({ kind: "unlink" })}
							/>
						) : (
							!linking && <LinkFolderButton disabled={disabled} onClick={onLinkFolder} />
						)}
						{shortcuts && openPath && (
							<Hint label="Shortcuts to these files in your godspeed folder, for you and your agent." side="bottom">
								<button
									type="button"
									data-testid="files-show-shortcuts"
									onClick={() => void openPath(shortcuts)}
									className="lh-press flex items-center gap-1.5 px-2.5 py-1.5 text-[13.5px] font-bold text-ink-2 hover:bg-tone hover:text-ink"
								>
									<FolderOpenIcon className="size-[13px]" aria-hidden />
									Show in {fileBrowserName(window.lh?.platform)}
								</button>
							</Hint>
						)}
						<AddFilesButton disabled={disabled} onAdd={add} />
					</>
				)}
			</TopBar>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				{!active && (
					<div className="m-auto px-[52px]">
						<PickClass line="Pick a class to see its files." />
					</div>
				)}
				{active && !record && !failed && <p className="m-auto text-sm text-ink-2">Loading…</p>}
				{active && !record && failed && <LoadFailed message="Couldn't load this class's files." onRetry={() => void reload()} className="m-auto" />}
				{record && actions && (
					<div className="flex w-full flex-col gap-4 px-[52px] pb-8">
						<header className="flex flex-wrap items-end gap-x-6 gap-y-3 py-6">
							<div className="flex min-w-0 flex-1 flex-col gap-2">
								<h1 className="font-title text-[40px] leading-[48px] tracking-tight text-ink">Files</h1>
								<p data-testid="files-summary" className="text-base leading-6 text-ink-2">
									{filesSummary(record.files)}
									{arrived && ` · ${arrived}`}
								</p>
							</div>
							{record.files.length > 0 && <SearchBox value={query} onChange={setQuery} />}
						</header>
						{linking && <LinkFolderField initial={record.linkedFolder ?? ""} disabled={disabled} onLink={link} onCancel={() => setLinking(false)} />}
						{error && (
							<div role="alert" data-testid="class-files-error" className="whitespace-pre-wrap border border-ans-wrong/50 px-3 py-2 text-[13px] text-ans-wrong">
								{error}
							</div>
						)}
						{finderDrag !== null && <FinderDropTargets count={finderDrag} onDrop={add} />}
						{record.files.length === 0 && finderDrag === null && (
							<div data-testid="files-empty" className="flex h-[200px] flex-col items-center justify-center gap-2 bg-panel p-4 text-center">
								<span className="text-[14.5px] text-ink-2">Add lecture notes, readings, recordings or the syllabus, or drop them here.</span>
								<span className="text-[12.5px] text-ink-3">PDF · Markdown · text · VTT/SRT · audio · video</span>
							</div>
						)}
						{searching && shown.length === 0 && (
							<p data-testid="files-no-match" className="py-6 text-sm text-ink-2">
								No file names have “{query.trim()}”.
							</p>
						)}
						{shown.map((group) => (
							<FileGroupSection
								key={group.key}
								group={group}
								collapsed={!searching && collapsed.has(group.key)}
								onToggle={toggle}
								coverage={coverage}
								disabled={disabled}
								agentTeaching={agentTeaching}
								names={names}
								actions={actions}
							/>
						))}
					</div>
				)}
			</div>
			<ConfirmDialog copy={confirmText} onConfirm={onConfirm} onClose={closeConfirm} />
		</div>
	);
}

function SearchBox({ value, onChange }: { value: string; onChange: (value: string) => void }) {
	return (
		<label className="flex h-9 w-[260px] items-center gap-2 bg-panel px-3 text-ink-3 focus-within:outline focus-within:outline-1 focus-within:outline-tone-2">
			<SearchIcon className="size-3.5 shrink-0" aria-hidden />
			<input
				type="search"
				data-testid="files-search"
				aria-label="Find a file"
				placeholder="Find a file"
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-3 [&::-webkit-search-cancel-button]:hidden"
			/>
			{value && (
				<button type="button" aria-label="Clear" data-testid="files-search-clear" onClick={() => onChange("")} className="lh-press shrink-0 hover:text-ink">
					<XIcon className="size-3.5" aria-hidden />
				</button>
			)}
		</label>
	);
}

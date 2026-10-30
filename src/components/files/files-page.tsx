"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClassFile, FileCoverage } from "@/core";
import { useClasses } from "@/components/class-context";
import { TopBar } from "@/components/top-bar";
import { useProgress } from "@/components/use-progress";
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
import type { FileRowActions } from "./file-row";
import { FileSection, type SectionDrag } from "./files-sections";
import { fileAnchorId, fileBrowserName, fileIdFromHash, splitByKind } from "./files-model";
import { LinkedFolderChip, LinkFolderButton, LinkFolderField } from "./linked-folder";

/** How long a row a "#file-<id>" link landed on stays outlined. */
const FLASH_MS = 1600;

/**
 * THE FILES PAGE: the
 * active class's files in two stacked panels, "Study material" and
 * "Course info" (files-sections.tsx). Each panel has its own Add and is a
 * drop zone for files from Finder; dragging a row into the other panel
 * (or its ⋯ menu's "Move to …") switches its kind. The linked folder (or
 * Link folder) sits in the Study material header.
 *
 * Coverage per file comes from the shared progress payload; the record
 * re-reads on classes-changed, so statuses update as files are built.
 * A "#file-<id>" hash (the Overview's coverage blocks) scrolls to that row
 * and outlines it briefly.
 */
export function FilesPage() {
	const { active } = useClasses();
	// Keyed by class, so a class switch starts clean.
	return <FilesPageBody key={active ?? "none"} />;
}

function FilesPageBody() {
	const { active } = useClasses();
	const { record, folderProblem, failed } = useClassRecord(active);
	const { data } = useProgress();
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(0);
	const [linking, setLinking] = useState(false);
	const classId = record?.id ?? null;

	const coverage = useMemo(() => {
		const map = new Map<string, FileCoverage>();
		if (data && data.classId === active) for (const f of data.files) map.set(f.fileId, f);
		return map;
	}, [data, active]);
	const sections = useMemo(() => splitByKind(record?.files ?? []), [record]);

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
			onKind: (fileId, kind) => void run(() => setClassFileKind(classId, fileId, kind)),
			onRetry: (fileId) => void run(() => retryClassFile(classId, fileId)),
			onRemove: (fileId) => void run(() => removeClassFile(classId, fileId)),
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

	const flashId = useHashFlash(record !== null);
	const disabled = busy > 0;

	// Drag and drop: a row being moved, and what is over which panel.
	const [rowDrag, setRowDrag] = useState<ClassFile | null>(null);
	const [over, setOver] = useState<{ kind: "study" | "info"; drag: SectionDrag } | null>(null);
	const onDrag = useCallback((file: ClassFile | null) => {
		setRowDrag(file);
		if (!file) setOver(null);
	}, []);
	const rowActions = useMemo(() => (actions ? { ...actions, onDrag } : null), [actions, onDrag]);
	const onDragOverSection = useCallback(
		(kind: "study" | "info", drag: { type: "finder"; count: number } | { type: "row" }): boolean => {
			if (drag.type === "row") {
				if (!rowDrag || rowDrag.kind === kind) return false;
				setOver((prev) => (prev?.kind === kind && prev.drag.type === "row" ? prev : { kind, drag: { type: "row", file: rowDrag } }));
				return true;
			}
			setOver((prev) => (prev?.kind === kind && prev.drag.type === "finder" && prev.drag.count === drag.count ? prev : { kind, drag }));
			return true;
		},
		[rowDrag],
	);
	const onDragLeaveSection = useCallback((kind: "study" | "info") => setOver((prev) => (prev?.kind === kind ? null : prev)), []);
	const onMoveHere = useCallback(
		(kind: "study" | "info") => {
			if (rowDrag && rowDrag.kind !== kind) actions?.onKind(rowDrag.id, kind);
			setRowDrag(null);
			setOver(null);
		},
		[rowDrag, actions],
	);
	const addStudy = useCallback(
		(files: File[]) => {
			if (classId) void run(() => uploadClassFiles(classId, files, "study"));
		},
		[classId, run],
	);
	const addInfo = useCallback(
		(files: File[]) => {
			if (classId) void run(() => uploadClassFiles(classId, files, "info"));
		},
		[classId, run],
	);
	const overFor = (kind: "study" | "info") => (over?.kind === kind ? over.drag : null);
	const finderOver = over?.drag.type === "finder" ? over.kind : null;

	return (
		<div
			className="flex h-full flex-col"
			data-testid="files-page"
			// Files dropped outside the two panels do nothing.
			onDragOver={(e) => {
				if (!Array.from(e.dataTransfer.types).includes("Files")) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = "none";
			}}
			onDrop={(e) => {
				e.preventDefault();
				setOver(null);
			}}
		>
			<TopBar>
				<h1 className="pl-4 text-[15px] font-bold text-ink">Files</h1>
			</TopBar>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				{!active && <p className="m-auto text-sm text-ink-3">Pick a class to see its files.</p>}
				{active && !record && failed && <p className="m-auto text-sm text-ink-3">Couldn&apos;t load this class&apos;s files.</p>}
				{record && rowActions && (
					<div className="flex w-full flex-col gap-6 px-7 pt-2 pb-7">
						{error && (
							<div role="alert" data-testid="class-files-error" className="whitespace-pre-wrap border border-ans-wrong/50 px-3 py-2 text-[13px] text-ans-wrong">
								{error}
							</div>
						)}
						<FileSection
							kind="study"
							files={sections.study}
							coverage={coverage}
							disabled={disabled}
							flashId={flashId}
							actions={rowActions}
							headerExtra={
								record.linkedFolder ? (
									<LinkedFolderChip
										path={record.linkedFolder}
										problem={folderProblem}
										disabled={disabled}
										open={openPath && { label: `Open in ${fileBrowserName(window.lh?.platform)}`, run: () => void openPath(record.linkedFolder!) }}
										onPickAgain={onLinkFolder}
										onUnlink={() => void run(() => unlinkClassFolder(record.id))}
									/>
								) : (
									!linking && <LinkFolderButton disabled={disabled} onClick={onLinkFolder} />
								)
							}
							beforeRows={linking ? <LinkFolderField initial={record.linkedFolder ?? ""} disabled={disabled} onLink={link} onCancel={() => setLinking(false)} /> : null}
							draggingId={rowDrag?.id ?? null}
							over={overFor("study")}
							dim={finderOver === "info"}
							onAddFiles={addStudy}
							onDragOverSection={onDragOverSection}
							onDragLeaveSection={onDragLeaveSection}
							onMoveHere={onMoveHere}
						/>
						<FileSection
							kind="info"
							files={sections.info}
							coverage={coverage}
							disabled={disabled}
							flashId={flashId}
							actions={rowActions}
							draggingId={rowDrag?.id ?? null}
							over={overFor("info")}
							dim={finderOver === "study"}
							onAddFiles={addInfo}
							onDragOverSection={onDragOverSection}
							onDragLeaveSection={onDragLeaveSection}
							onMoveHere={onMoveHere}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

/** The row a "#file-<id>" hash points at: scrolled into view once the
 *  rows exist, outlined for FLASH_MS, then null. */
function useHashFlash(ready: boolean): string | null {
	const [flashId, setFlashId] = useState<string | null>(null);
	const [target, setTarget] = useState<string | null>(null);
	useEffect(() => {
		const read = () => setTarget(fileIdFromHash(window.location.hash));
		read();
		window.addEventListener("hashchange", read);
		return () => window.removeEventListener("hashchange", read);
	}, []);
	useEffect(() => {
		if (!ready || !target) return;
		const el = document.getElementById(fileAnchorId(target));
		if (!el) return;
		const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
		el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
		const start = setTimeout(() => setFlashId(target), 0);
		const end = setTimeout(() => {
			setFlashId(null);
			setTarget(null);
		}, FLASH_MS);
		return () => {
			clearTimeout(start);
			clearTimeout(end);
		};
	}, [ready, target]);
	return flashId;
}

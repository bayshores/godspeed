"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderSyncIcon, PlusIcon } from "lucide-react";
import type { FileCoverage } from "@/core";
import { useClasses } from "@/components/class-context";
import { MenuShell } from "@/components/menu-shell";
import { TopBar } from "@/components/top-bar";
import { useProgress } from "@/components/use-progress";
import {
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
import { FileSection } from "./files-sections";
import { CLASS_FILE_ACCEPT, fileAnchorId, fileIdFromHash, splitByKind } from "./files-model";
import { LinkFolderField, LinkedFolderRow } from "./linked-folder";
import { useMenuDismiss } from "./use-menu-dismiss";

/** How long a row a "#file-<id>" link landed on stays outlined. */
const FLASH_MS = 1600;

/**
 * THE FILES PAGE (redesign plan, Phase 6 — docs/design/exports/files.html): the
 * active class's files. Top bar: "Link folder" and "Add files" (as study
 * material or course info). Body: the linked folder with Unlink, then
 * "Study material" and "Course info" rows (files-sections.tsx).
 *
 * Coverage per file comes from the shared progress payload; the record
 * re-reads on classes-changed, so statuses update as files are built.
 * A "#file-<id>" hash (the Overview's coverage blocks) scrolls to that row
 * and outlines it briefly.
 */
export function FilesPage() {
	const { active } = useClasses();
	const { record } = useClassRecord(active);
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
		return {
			onKind: (fileId, kind) => void run(() => setClassFileKind(classId, fileId, kind)),
			onRetry: (fileId) => void run(() => retryClassFile(classId, fileId)),
			onRemove: (fileId) => void run(() => removeClassFile(classId, fileId)),
		};
	}, [classId, run]);

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

	return (
		<div className="flex h-full flex-col" data-testid="files-page">
			<TopBar>
				<h1 className="pl-4 text-[15px] font-bold text-ink">Files</h1>
				<div className="flex-1" />
				{classId && (
					<div className="flex items-center gap-0.5">
						<button
							type="button"
							data-testid="class-pick-folder"
							disabled={disabled}
							onClick={onLinkFolder}
							className="lh-press flex items-center gap-[7px] bg-tone px-3 py-2 text-[13.5px] font-bold text-ink hover:bg-tone-2 disabled:opacity-60"
						>
							<FolderSyncIcon className="size-3.5" aria-hidden />
							Link folder
						</button>
						<AddFilesButton disabled={disabled} onFiles={(files, kind) => void run(() => uploadClassFiles(classId, files, kind))} />
					</div>
				)}
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{record && actions && (
					<div className="flex w-full flex-col gap-7 px-7 py-5">
						{error && (
							<div role="alert" data-testid="class-files-error" className="whitespace-pre-wrap border border-ans-wrong/50 px-3 py-2 text-[13px] text-ans-wrong">
								{error}
							</div>
						)}
						{linking ? (
							<LinkFolderField initial={record.linkedFolder ?? ""} disabled={disabled} onLink={link} onCancel={() => setLinking(false)} />
						) : (
							record.linkedFolder && (
								<LinkedFolderRow path={record.linkedFolder} disabled={disabled} onUnlink={() => void run(() => unlinkClassFolder(record.id))} />
							)
						)}
						<FileSection kind="study" files={sections.study} coverage={coverage} disabled={disabled} flashId={flashId} actions={actions} />
						<FileSection kind="info" files={sections.info} coverage={coverage} disabled={disabled} flashId={flashId} actions={actions} />
					</div>
				)}
			</div>
		</div>
	);
}

/** "Add files": a small menu — as study material or as course info — then
 *  the system file picker. */
function AddFilesButton({ disabled, onFiles }: { disabled?: boolean; onFiles: (files: File[], kind: "study" | "info") => void }) {
	const [open, setOpen] = useState(false);
	const anchorRef = useRef<HTMLButtonElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const kindRef = useRef<"study" | "info">("study");
	const close = useCallback(() => setOpen(false), []);
	useMenuDismiss(open, close, anchorRef);
	const choose = (kind: "study" | "info") => {
		kindRef.current = kind;
		setOpen(false);
		inputRef.current?.click();
	};
	const item = "lh-press flex items-center px-2.5 py-1.5 text-left text-ink hover:bg-tone";
	return (
		<>
			<input
				ref={inputRef}
				type="file"
				multiple
				accept={CLASS_FILE_ACCEPT}
				className="hidden"
				data-testid="class-file-input"
				onChange={(e) => {
					const files = Array.from(e.target.files ?? []);
					e.target.value = "";
					if (files.length > 0) onFiles(files, kindRef.current);
				}}
			/>
			<button
				ref={anchorRef}
				type="button"
				data-testid="class-add-files"
				aria-haspopup="menu"
				aria-expanded={open}
				disabled={disabled}
				onClick={() => setOpen((o) => !o)}
				className="lh-press flex items-center gap-[7px] bg-ink px-3 py-2 text-[13.5px] font-bold text-black hover:bg-white disabled:opacity-60"
			>
				<PlusIcon className="size-3.5" aria-hidden />
				Add files
			</button>
			<MenuShell
				open={open}
				anchorRef={anchorRef}
				testid="class-add-kind"
				preferredSide="down"
				menuClass="flex w-44 flex-col gap-0.5 border border-tone-2 bg-panel p-1.5 text-[13px] shadow-xl"
			>
				<button type="button" data-testid="class-add-study" onClick={() => choose("study")} className={item}>
					Study material
				</button>
				<button type="button" data-testid="class-add-info" onClick={() => choose("info")} className={item}>
					Course info
				</button>
			</MenuShell>
		</>
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

/**
 * The corner notices when a class's linked folder brings new files (say,
 * a new lecture landing in a synced Google Drive folder) or loses some:
 * "3 new files in CSE 21" with See files, "2 files removed from CSE 21"
 * with See changes, and a close button. Each stays until one is clicked,
 * and never shows on that class's own Files page (its New badges and
 * Recent changes say it). With no agent connected, the new-files notice
 * says the study material waits for one.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { FolderInputIcon, FolderMinusIcon, XIcon } from "lucide-react";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useClasses } from "@/frontend/components/class-context";
import { NOTICE_STACK_ID } from "@/frontend/components/notice-stack";
import { useServerEvent } from "@/frontend/components/server-events";
import { changeNames, changeTitle, mergeChange, type FolderChange } from "./files-notice-model";

export function FilesNotice() {
	const [changes, setChanges] = useState<FolderChange[]>([]);
	const { classes, active, setActive } = useClasses();
	const agent = useAgentStatus();
	const navigate = useNavigate();
	// The class whose Files page is open, if any.
	const onFilesOf = useLocation().pathname === "/class/files" ? active : null;
	const onFilesRef = useRef(onFilesOf);
	useEffect(() => {
		onFilesRef.current = onFilesOf;
		if (onFilesOf) setChanges((list) => (list.some((e) => e.classId === onFilesOf) ? list.filter((e) => e.classId !== onFilesOf) : list));
	}, [onFilesOf]);
	useServerEvent("files-added", (next) => {
		if (next.classId !== onFilesRef.current) setChanges((list) => mergeChange(list, { classId: next.classId, change: "added", files: next.files }));
	});
	useServerEvent("files-removed", (next) => {
		if (next.classId !== onFilesRef.current) setChanges((list) => mergeChange(list, { classId: next.classId, change: "removed", files: next.files }));
	});
	const dismiss = (entry: FolderChange) => setChanges((list) => list.filter((e) => e !== entry));
	if (typeof document === "undefined") return null;
	return createPortal(
		<FilesNoticeView
			changes={changes}
			agentConnected={agent?.connected !== false}
			nameOf={(id) => classes.find((c) => c.id === id)?.name ?? null}
			onSee={(entry) => {
				dismiss(entry);
				setActive(entry.classId);
				navigate("/class/files");
			}}
			onDismiss={dismiss}
		/>,
		document.getElementById(NOTICE_STACK_ID) ?? document.body,
	);
}

export function FilesNoticeView({
	changes,
	agentConnected,
	nameOf,
	onSee,
	onDismiss,
}: {
	changes: readonly FolderChange[];
	/** False while no agent is connected (unknown counts as connected). */
	agentConnected: boolean;
	/** The class's name; null hides its entry (the class was deleted). */
	nameOf: (classId: string) => string | null;
	onSee: (entry: FolderChange) => void;
	onDismiss: (entry: FolderChange) => void;
}) {
	return (
		<>
			{changes.map((entry) => {
				const name = nameOf(entry.classId);
				if (!name) return null;
				const Icon = entry.change === "added" ? FolderInputIcon : FolderMinusIcon;
				return (
					<div
						key={`${entry.classId}:${entry.change}`}
						data-testid={`files-notice-${entry.change}`}
						role="status"
						className="lh-rise lh-popup flex w-[340px] max-w-full items-start gap-3 px-4 py-3 font-ui text-[13.5px] text-ink"
					>
						<Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<p className="font-bold">{changeTitle(entry, name, agentConnected)}</p>
							<p className="truncate text-xs text-ink-3" title={entry.files.map((f) => f.name).join("\n")}>
								{changeNames(entry.files)}
							</p>
							<div className="pt-1.5">
								<button
									type="button"
									data-testid="files-notice-see"
									onClick={() => onSee(entry)}
									className="lh-press border border-tone-2 px-3 py-1 text-[13px] font-bold hover:bg-tone"
								>
									{entry.change === "added" ? "See files" : "See changes"}
								</button>
							</div>
						</div>
						<button type="button" data-testid="files-notice-close" aria-label="Close" onClick={() => onDismiss(entry)} className="lh-press text-ink-3 hover:text-ink">
							<XIcon className="size-3.5" aria-hidden />
						</button>
					</div>
				);
			})}
		</>
	);
}

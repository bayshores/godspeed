/**
 * The corner notices when a space's linked folder brings new files (say,
 * a new lecture landing in a synced Google Drive folder) or loses some:
 * "3 new files in CSE 21" with See files, "2 files removed from CSE 21"
 * with See changes, and a close button. Each stays until one is clicked,
 * and never shows on that space's own Files page (its New badges and
 * Recent changes say it). With no agent connected, the new-files notice
 * says the study material waits for one.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useLocation } from "react-router";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useSpaces } from "@/frontend/components/space-context";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { NOTICE_STACK_ID } from "@/frontend/components/notice-stack";
import { useServerEvent } from "@/frontend/components/server-events";
import { changeNames, changeTitle, mergeChange, type FolderChange } from "./files-notice-model";

export function FilesNotice() {
	const [changes, setChanges] = useState<FolderChange[]>([]);
	const { spaces, active, setActive } = useSpaces();
	const agent = useAgentStatus();
	const navigate = useNavigate();
	// The space whose Files page is open, if any.
	const onFilesOf = useLocation().pathname === "/space/files" ? active : null;
	const onFilesRef = useRef(onFilesOf);
	useEffect(() => {
		onFilesRef.current = onFilesOf;
		if (onFilesOf) setChanges((list) => (list.some((e) => e.spaceId === onFilesOf) ? list.filter((e) => e.spaceId !== onFilesOf) : list));
	}, [onFilesOf]);
	useServerEvent("files-added", (next) => {
		if (next.spaceId !== onFilesRef.current) setChanges((list) => mergeChange(list, { spaceId: next.spaceId, change: "added", files: next.files }));
	});
	useServerEvent("files-removed", (next) => {
		if (next.spaceId !== onFilesRef.current) setChanges((list) => mergeChange(list, { spaceId: next.spaceId, change: "removed", files: next.files }));
	});
	const dismiss = (entry: FolderChange) => setChanges((list) => list.filter((e) => e !== entry));
	if (typeof document === "undefined") return null;
	return createPortal(
		<FilesNoticeView
			changes={changes}
			agentConnected={agent?.connected !== false}
			nameOf={(id) => spaces.find((c) => c.id === id)?.name ?? null}
			onSee={(entry) => {
				dismiss(entry);
				setActive(entry.spaceId);
				navigate("/space/files");
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
	/** The space's name; null hides its entry (the space was deleted). */
	nameOf: (spaceId: string) => string | null;
	onSee: (entry: FolderChange) => void;
	onDismiss: (entry: FolderChange) => void;
}) {
	return (
		<>
			{changes.map((entry) => {
				const name = nameOf(entry.spaceId);
				if (!name) return null;
				return (
					<NoticeCard
						key={`${entry.spaceId}:${entry.change}`}
						data-testid={`files-notice-${entry.change}`}
						role="status"
						title={changeTitle(entry, name, agentConnected)}
						close={{ onClick: () => onDismiss(entry), testId: "files-notice-close" }}
						actions={
							<button type="button" data-testid="files-notice-see" onClick={() => onSee(entry)} className="lh-btn text-[15px]">
								{entry.change === "added" ? "See files" : "See changes"}
							</button>
						}
					>
						<NoticeText title={entry.files.map((f) => f.name).join("\n")}>{changeNames(entry.files)}</NoticeText>
					</NoticeCard>
				);
			})}
		</>
	);
}

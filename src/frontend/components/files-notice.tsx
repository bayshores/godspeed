/**
 * The corner notices when a space's linked folder brings new files (say,
 * a new lecture landing in a synced Google Drive folder) or loses some:
 * "3 new files in CSE 21" with See files, "2 files removed from CSE 21"
 * with See changes, and a close button. Each stays until one is clicked,
 * and never shows on that space's own Files page (its New badges and
 * Recent changes say it). With no agent connected, the new-files notice
 * says the study material waits for the teacher.
 */

import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { useSpaces } from "@/frontend/components/space-context";
import { useOpenInSpace } from "@/frontend/components/use-join-space";
import { NoticeCard, NoticeText } from "@/frontend/components/notice-card";
import { InNoticeStack } from "@/frontend/components/strip/peek-sheet";
import { useServerEvent } from "@/frontend/components/server-events";
import { changeNames, changeTitle, mergeChange, type FolderChange } from "./files-notice-model";

export function FilesNotice() {
	const [changes, setChanges] = useState<FolderChange[]>([]);
	const { spaces, active } = useSpaces();
	const agent = useAgentStatus();
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const openInSpace = useOpenInSpace();
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
	return (
		<InNoticeStack>
			<FilesNoticeView
				changes={changes}
				agentConnected={agent?.connected !== false}
				teacher={teacher}
				nameOf={(id) => spaces.find((c) => c.id === id)?.name ?? null}
				onSee={(entry) => {
					dismiss(entry);
					openInSpace(entry.spaceId, "/space/files");
				}}
				onDismiss={dismiss}
			/>
		</InNoticeStack>
	);
}

export function FilesNoticeView({
	changes,
	agentConnected,
	teacher,
	nameOf,
	onSee,
	onDismiss,
}: {
	changes: readonly FolderChange[];
	/** False while no agent is connected (unknown counts as connected). */
	agentConnected: boolean;
	teacher: string;
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
						title={changeTitle(entry, name, agentConnected, teacher)}
						close={{ onClick: () => onDismiss(entry), testId: "files-notice-close" }}
						actions={
							<button type="button" data-testid="files-notice-see" onClick={() => onSee(entry)} className="lh-btn">
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

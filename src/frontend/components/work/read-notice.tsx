import { useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { useMinute } from "@/frontend/components/countdown";
import { useSpaceRecord } from "@/frontend/components/files/space-record";
import { NoticeCard } from "@/frontend/components/notice-card";
import { useSpaces } from "@/frontend/components/space-context";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { NOTICE_STACK_ID } from "@/frontend/components/top-bar/pill-panel";
import { readNews } from "./work-model";

/**
 * What the agent read in the open space's last round of files, as a notice
 * that folds into the live pill. Closing it clears the round, which also
 * clears it for a day.
 */
export function ReadNotice() {
	const { active } = useSpaces();
	const { record } = useSpaceRecord(active);
	const teacher = useTeacher()?.name ?? DEFAULT_TEACHER_NAME;
	const nowMs = useMinute();
	/** The round closed here. */
	const [closed, setClosed] = useState<string | null>(null);
	if (!record || nowMs === null || typeof document === "undefined") return null;
	const round = `${record.id}:${record.lastWork?.startedAt ?? ""}`;
	const title = closed === round ? null : readNews({ files: record.files, work: record.lastWork, nowMs }, teacher);
	if (title === null) return null;
	const close = () => {
		setClosed(round);
		void fetch(`/api/spaces/${encodeURIComponent(record.id)}/work`, { method: "DELETE" });
	};
	return createPortal(
		<NoticeCard data-testid="read-notice" role="status" title={title} close={{ onClick: close, testId: "read-notice-close" }} />,
		document.getElementById(NOTICE_STACK_ID) ?? document.body,
	);
}

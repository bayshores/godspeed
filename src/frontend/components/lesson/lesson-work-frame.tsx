import type { ReactNode } from "react";
import { useActivity } from "@/frontend/components/activity-dock";
import { JobFrame } from "@/frontend/components/work/job-frame";

/** The work frame around a lesson while its facts are added to the graph. */
export function LessonWorkFrame({ chatId, children }: { chatId: string; children: ReactNode }) {
	const { feed } = useActivity();
	const adding = feed.extractions.some((run) => run.kind === "chat" && run.chatId === chatId);
	return <JobFrame doing={adding ? "adding its facts to the graph" : null}>{children}</JobFrame>;
}

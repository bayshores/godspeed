import type { ReactNode } from "react";
import { useActivity } from "@/frontend/components/activity-dock";
import { useSpaceRecord } from "@/frontend/components/files/space-files-api";
import { useSpaces } from "@/frontend/components/space-context";
import { StartAgentAction } from "./start-agent-action";
import { useWorker } from "./use-worker";
import { WorkFrame, type Frame } from "./work-frame";
import { spaceFrame, workState } from "./work-model";

/**
 * The work frame around every tab of a space: while its files are read or
 * its facts are grouped into topics, or wait for the teacher. `wide`: the
 * tab's page is the wide one.
 */
export function SpaceWorkFrame({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
	const { active } = useSpaces();
	const { record } = useSpaceRecord(active);
	const { worker, teacher } = useWorker();
	const { feed } = useActivity();

	let frame: Frame | null = null;
	if (record) {
		const grouping = feed.extractions.some((run) => run.kind === "topics" && run.chatId === `topics:${record.id}`);
		const state = workState({ files: record.files, work: record.lastWork, grouping, working: worker !== null });
		if (state) frame = { ...spaceFrame(state, teacher), actions: state.kind === "waiting" ? <StartAgentAction /> : null };
	}
	return (
		<WorkFrame frame={frame} column={wide ? "wide" : "page"}>
			{children}
		</WorkFrame>
	);
}

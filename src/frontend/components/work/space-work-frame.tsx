import { useState, type ReactNode } from "react";
import { useActivity } from "@/frontend/components/activity-dock";
import { useMinute } from "@/frontend/components/countdown";
import { useSpaceRecord } from "@/frontend/components/files/space-files-api";
import { useSpaces } from "@/frontend/components/space-context";
import { OpenAgentAction } from "./open-agent-action";
import { useWorker } from "./use-worker";
import { WorkFrame, type Frame } from "./work-frame";
import { spaceFrame, workState } from "./work-model";

/**
 * The work frame around every tab of a space: while its files are read or
 * its facts are grouped into topics, then what the round read until it is
 * closed (or a day passed). `wide`: the tab's page is the wide one.
 */
export function SpaceWorkFrame({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
	const { active } = useSpaces();
	const { record } = useSpaceRecord(active);
	const nowMs = useMinute();
	const { worker, teacher } = useWorker();
	const { feed } = useActivity();
	/** The round whose summary was closed here. */
	const [closed, setClosed] = useState<string | null>(null);

	let frame: Frame | null = null;
	if (record && nowMs !== null) {
		const grouping = feed.extractions.some((run) => run.kind === "topics" && run.chatId === `topics:${record.id}`);
		const state = workState({ files: record.files, work: record.lastWork, grouping, working: worker !== null, nowMs });
		const round = `${record.id}:${record.lastWork?.startedAt ?? ""}`;
		if (state && !(state.kind === "done" && closed === round)) {
			const close = () => {
				setClosed(round);
				void fetch(`/api/spaces/${encodeURIComponent(record.id)}/work`, { method: "DELETE" });
			};
			frame = {
				...spaceFrame(state, worker ?? teacher),
				actions:
					state.kind === "waiting" ? (
						<OpenAgentAction />
					) : state.kind === "done" ? (
						<button type="button" data-testid="work-frame-close" onClick={close} className="lh-btn lh-btn-quiet h-7 shrink-0 text-ink">
							Close
						</button>
					) : null,
			};
		}
	}
	return (
		<WorkFrame frame={frame} column={wide ? "wide" : "page"}>
			{children}
		</WorkFrame>
	);
}

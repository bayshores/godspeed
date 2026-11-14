import type { ReactNode } from "react";
import { OpenAgentAction } from "./open-agent-action";
import { useWorker } from "./use-worker";
import { WorkFrame } from "./work-frame";
import { jobFrame } from "./work-model";

/** The work frame around a page one job works on. `doing`: what the job
 *  does, or null while none runs. */
export function JobFrame({ doing, children }: { doing: string | null; children: ReactNode }) {
	const { worker } = useWorker();
	const words = doing === null ? null : jobFrame(worker, doing);
	return (
		<WorkFrame frame={words && { ...words, actions: words.state === "waiting" ? <OpenAgentAction /> : null }}>
			{children}
		</WorkFrame>
	);
}

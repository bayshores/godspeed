import type { ReactNode } from "react";
import { useWorker } from "./use-worker";
import { WorkFrame } from "./work-frame";
import { jobFrame } from "./work-model";

/** The work frame around a page one job works on, while an agent has the
 *  job. `doing`: what the job does, or null while none runs. */
export function JobFrame({ doing, children }: { doing: string | null; children: ReactNode }) {
	const { worker } = useWorker();
	return <WorkFrame frame={doing === null ? null : jobFrame(worker, doing)}>{children}</WorkFrame>;
}

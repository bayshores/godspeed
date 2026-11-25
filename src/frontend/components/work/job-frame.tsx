import type { ReactNode } from "react";
import { WorkFrame } from "./work-frame";
import { workFrame } from "./work-model";

/** The work frame around a page one job works on (a lesson, a cheat sheet). `doing`: what the
 *  job does, or null while none runs. */
export function JobFrame({ doing, children }: { doing: string | null; children: ReactNode }) {
	return <WorkFrame frame={doing === null ? null : workFrame(doing)}>{children}</WorkFrame>;
}

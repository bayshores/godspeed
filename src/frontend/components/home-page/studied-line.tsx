import { useMemo } from "react";
import { localDay, type ProgressPayload } from "@/shared/core";
import { studiedLine } from "./studied-model";

type Lessons = Pick<ProgressPayload, "lessons">;

/** Beside Home's date: how many of the last 7 days had an answer, and how many answers. */
export function StudiedLine({ progress, noSpace, nowMs }: { progress: ReadonlyMap<string, Lessons>; noSpace: Lessons | null; nowMs: number }) {
	// Home renders every minute and on every event; the answers are
	// counted again only when the progress or the day changes.
	const day = localDay(nowMs);
	const line = useMemo(() => studiedLine(noSpace ? [...progress.values(), noSpace] : [...progress.values()], nowMs), [progress, noSpace, day]);
	return (
		<p data-testid="today-studied" className="min-w-0 flex-[1_1_220px] text-[15px] leading-snug text-ink-2">
			{line}
		</p>
	);
}

/** Follow's slip, kept for the window (TeacherProvider owns it): the round's rows, kept through
 *  its "Done" and while its list is open, the clock that turns a step's words into "Thinking"
 *  and lets "Done" leave, and whether its list is open. follow-slip-model.ts decides the rest. */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { TeacherWork } from "@/shared/core";
import { slipView, type SlipView } from "./follow-slip-model";
import type { TourPause } from "./use-tour";
import type { TimelineRow } from "./timeline-model";

interface Kept {
	since: string;
	rows: TimelineRow[];
	/** When the round was seen to end. */
	endedAt: number | null;
}

export interface FollowSlip {
	view: SlipView;
	/** Shown since the window's first read of the round: it is simply there, nothing moves. */
	still: boolean;
	open: boolean;
	setOpen: (open: boolean) => void;
}

export function useFollowSlip(i: { follow: boolean; work: TeacherWork | null; timeline: TimelineRow[]; pause: TourPause | null; path: string; room: boolean }): FollowSlip | null {
	const { follow, work, timeline, pause, path, room } = i;
	const live = !!work?.live;
	const [kept, setKept] = useState<Kept | null>(null);
	if (live && work?.since && (kept?.since !== work.since || kept.rows !== timeline || kept.endedAt !== null)) setKept({ since: work.since, rows: timeline, endedAt: null });
	useEffect(() => {
		if (work && !work.live && kept && kept.endedAt === null) setKept({ ...kept, endedAt: Date.now() });
	}, [work, kept]);

	const [open, setOpenState] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	// A new row, the round's end or a pause: read the clock again.
	const newest = timeline.at(-1)?.id;
	useEffect(() => setNow(Date.now()), [newest, live, pause]);
	const view = useMemo(
		() => slipView({ follow, path, room, live, rows: kept?.rows ?? [], endedAt: kept?.endedAt ?? null, pause, open, now }),
		[follow, path, room, live, kept, pause, open, now],
	);
	const [still, setStill] = useState(true);
	if (still && work !== null && view === null) setStill(false);
	const changesAt = view?.changesAt ?? null;
	useEffect(() => {
		if (changesAt === null) return;
		const t = setTimeout(() => setNow(Date.now()), Math.max(0, changesAt - Date.now()));
		return () => clearTimeout(t);
	}, [changesAt]);
	// Gone, its list is shut for next time.
	const shown = view !== null;
	useEffect(() => {
		if (!shown) setOpenState(false);
	}, [shown]);
	const setOpen = useCallback((next: boolean) => {
		setOpenState(next);
		setNow(Date.now());
	}, []);
	return useMemo(() => (view ? { view, still, open, setOpen } : null), [view, still, open, setOpen]);
}

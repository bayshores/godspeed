/**
 * The deadlines of every space not closed (GET /api/deadlines): the open
 * ones, for Home and the welcome screen, and the ones
 * ticked done today, which Home keeps with Undo, and the gaps: spaces that
 * look to be missing a deadline. One shared read in
 * OpenDeadlinesProvider: it re-reads when spaces change (every deadline
 * edit announces spaces-changed), after the events channel reconnects and
 * when the day changes in an open window (a gap depends on today).
 * `markDone` ticks one done and `undo` unticks it (PUT done); a save that
 * fails says so in a notice. `answerGap` waves a gap off.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { localDay, readGaps, type SpaceGap } from "@/shared/core";
import { useMinute } from "@/frontend/components/countdown";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { DoneNotice } from "@/frontend/components/done-notice";
import { useServerResource } from "@/frontend/components/use-server-resource";
import { jsonInit, send, type WriteResult } from "@/frontend/lib/api";

interface Fetched {
	open: OpenDeadline[];
	doneToday: OpenDeadline[];
	/** The overdue ones the learner already answered Not yet to. */
	overdueAsked: string[];
	gaps: SpaceGap[];
}

interface SharedDeadlines {
	/** null until the first response. */
	fetched: Fetched | null;
	/** Why the last read failed; null once one succeeds. */
	error: string | null;
	load: () => Promise<void>;
	/** Save a deadline's done and read the lists again; `failed` is the
	 *  notice when the save doesn't work. */
	setDone: (d: OpenDeadline, done: boolean, failed: string) => void;
}

const OpenDeadlinesContext = createContext<SharedDeadlines>({ fetched: null, error: null, load: async () => {}, setDone: () => {} });

export function OpenDeadlinesProvider({ children }: { children: React.ReactNode }) {
	// A failed read keeps what we have; the error only matters before a first list.
	const { value: read, error, reload: load } = useServerResource<{ deadlines?: OpenDeadline[]; doneToday?: OpenDeadline[]; overdueAsked?: string[]; gaps?: unknown }>("/api/deadlines", {
		on: { "spaces-changed": true },
	});
	const fetched = useMemo<Fetched | null>(
		() =>
			read && {
				open: Array.isArray(read.deadlines) ? read.deadlines : [],
				doneToday: Array.isArray(read.doneToday) ? read.doneToday : [],
				overdueAsked: Array.isArray(read.overdueAsked) ? read.overdueAsked : [],
				gaps: readGaps(read.gaps),
			},
		[read],
	);

	// A gap depends on today, so a window left open overnight reads again once the day turns.
	const minute = useMinute();
	const day = minute === null ? null : localDay(minute);
	const lastDay = useRef(day);
	useEffect(() => {
		const before = lastDay.current;
		if (day === before) return;
		lastDay.current = day;
		if (before !== null) void load();
	}, [day, load]);

	const [notice, setNotice] = useState<string | null>(null);
	const clearNotice = useCallback(() => setNotice(null), []);
	const setDone = useCallback(
		(d: OpenDeadline, done: boolean, failed: string) => {
			setNotice(null);
			void (async () => {
				const { error } = await send(`/api/spaces/${encodeURIComponent(d.spaceId)}/deadlines/${encodeURIComponent(d.id)}`, jsonInit("PUT", { done }));
				if (error) setNotice(failed);
				else await load();
			})();
		},
		[load],
	);

	const value = useMemo(() => ({ fetched, error, load, setDone }), [fetched, error, load, setDone]);
	return (
		<OpenDeadlinesContext.Provider value={value}>
			{children}
			{notice && <DoneNotice text={notice} onExpire={clearNotice} />}
		</OpenDeadlinesContext.Provider>
	);
}

interface OpenDeadlinesState {
	/** The open deadlines; null until the first response. */
	deadlines: OpenDeadline[] | null;
	/** The ones ticked done today. */
	doneToday: OpenDeadline[];
	/** The overdue ones the learner already answered Not yet to. */
	overdueAsked: string[];
	/** The spaces that look to be missing a deadline, one each. */
	gaps: SpaceGap[];
	/** Why the last read failed; null once one succeeds. */
	error: string | null;
	markDone: (d: OpenDeadline) => void;
	undo: (d: OpenDeadline) => void;
	/** Wave a space's gap off (its key), then read the lists again; the error line, or null. */
	answerGap: (spaceId: string, key: string) => Promise<WriteResult>;
	/** Read the lists again now (Try again). */
	reload: () => Promise<void>;
}

const NONE: OpenDeadline[] = [];
const NO_IDS: string[] = [];
const NO_GAPS: SpaceGap[] = [];

export function useOpenDeadlines(): OpenDeadlinesState {
	const { fetched, error, load, setDone } = useContext(OpenDeadlinesContext);
	const markDone = useCallback((d: OpenDeadline) => setDone(d, true, "Couldn't mark it done. Try again."), [setDone]);
	const undo = useCallback((d: OpenDeadline) => setDone(d, false, "Couldn't undo that. Try again."), [setDone]);
	const answerGap = useCallback(
		async (spaceId: string, key: string): Promise<WriteResult> => {
			const { error: failed } = await send(`/api/deadlines/${encodeURIComponent(spaceId)}/nothing-new`, jsonInit("POST", { key }));
			if (!failed) await load();
			return failed;
		},
		[load],
	);
	return { deadlines: fetched?.open ?? null, doneToday: fetched?.doneToday ?? NONE, overdueAsked: fetched?.overdueAsked ?? NO_IDS, gaps: fetched?.gaps ?? NO_GAPS, error, markDone, undo, answerGap, reload: load };
}

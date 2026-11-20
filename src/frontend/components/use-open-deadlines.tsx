/**
 * The deadlines of every space not closed (GET /api/deadlines): the open
 * ones, for Home and the welcome screen, and the ones
 * ticked done today, which Home keeps with Undo. One shared read in
 * OpenDeadlinesProvider: it re-reads when spaces change (every deadline
 * edit announces spaces-changed) and after the events channel reconnects.
 * `markDone` ticks one done and `undo` unticks it (PUT done); a save that
 * fails says so in a notice.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { DoneNotice } from "@/frontend/components/done-notice";
import { useServerResource } from "@/frontend/components/use-server-resource";
import { jsonInit, send } from "@/frontend/lib/api";

interface Fetched {
	open: OpenDeadline[];
	doneToday: OpenDeadline[];
	/** The overdue ones the learner already answered Not yet to. */
	overdueAsked: string[];
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
	const { value: read, error, reload: load } = useServerResource<{ deadlines?: OpenDeadline[]; doneToday?: OpenDeadline[]; overdueAsked?: string[] }>("/api/deadlines", {
		on: { "spaces-changed": true },
	});
	const fetched = useMemo<Fetched | null>(
		() =>
			read && {
				open: Array.isArray(read.deadlines) ? read.deadlines : [],
				doneToday: Array.isArray(read.doneToday) ? read.doneToday : [],
				overdueAsked: Array.isArray(read.overdueAsked) ? read.overdueAsked : [],
			},
		[read],
	);

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
	/** Why the last read failed; null once one succeeds. */
	error: string | null;
	markDone: (d: OpenDeadline) => void;
	undo: (d: OpenDeadline) => void;
	/** Read the lists again now (Try again). */
	reload: () => Promise<void>;
}

const NONE: OpenDeadline[] = [];
const NO_IDS: string[] = [];

export function useOpenDeadlines(): OpenDeadlinesState {
	const { fetched, error, load, setDone } = useContext(OpenDeadlinesContext);
	const markDone = useCallback((d: OpenDeadline) => setDone(d, true, "Couldn't mark it done. Try again."), [setDone]);
	const undo = useCallback((d: OpenDeadline) => setDone(d, false, "Couldn't undo that. Try again."), [setDone]);
	return { deadlines: fetched?.open ?? null, doneToday: fetched?.doneToday ?? NONE, overdueAsked: fetched?.overdueAsked ?? NO_IDS, error, markDone, undo, reload: load };
}

/**
 * The deadlines of every space not closed (GET /api/deadlines): the open
 * ones, for Today and the welcome screen, and the ones
 * ticked done today, which Today keeps with Undo. One shared read in
 * OpenDeadlinesProvider: it re-reads when spaces change (every deadline
 * edit announces spaces-changed) and after the events channel reconnects.
 * `markDone` ticks one done and `undo` unticks it (PUT done); a save that
 * fails says so in a notice. `onCard` is the deadline Today's card shows
 * while Today is open, so the overdue ask in the top bar never asks twice.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { DoneNotice } from "@/frontend/components/done-notice";
import { useServerResource } from "@/frontend/components/use-server-resource";
import { jsonInit } from "@/frontend/lib/api";

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
	onCard: string | null;
	setOnCard: (id: string | null) => void;
}

const OpenDeadlinesContext = createContext<SharedDeadlines>({ fetched: null, error: null, load: async () => {}, setDone: () => {}, onCard: null, setOnCard: () => {} });

export function OpenDeadlinesProvider({ children }: { children: React.ReactNode }) {
	const [onCard, setOnCard] = useState<string | null>(null);
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
				try {
					const res = await fetch(`/api/spaces/${encodeURIComponent(d.spaceId)}/deadlines/${encodeURIComponent(d.id)}`, jsonInit("PUT", { done }));
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					await load();
				} catch {
					setNotice(failed);
				}
			})();
		},
		[load],
	);

	const value = useMemo(() => ({ fetched, error, load, setDone, onCard, setOnCard }), [fetched, error, load, setDone, onCard]);
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
	/** The deadline Today's card shows; null away from Today. */
	onCard: string | null;
	setOnCard: (id: string | null) => void;
}

const NONE: OpenDeadline[] = [];
const NO_IDS: string[] = [];

export function useOpenDeadlines(): OpenDeadlinesState {
	const { fetched, error, load, setDone, onCard, setOnCard } = useContext(OpenDeadlinesContext);
	const markDone = useCallback((d: OpenDeadline) => setDone(d, true, "Couldn't mark it done. Try again."), [setDone]);
	const undo = useCallback((d: OpenDeadline) => setDone(d, false, "Couldn't undo that. Try again."), [setDone]);
	return { deadlines: fetched?.open ?? null, doneToday: fetched?.doneToday ?? NONE, overdueAsked: fetched?.overdueAsked ?? NO_IDS, error, markDone, undo, reload: load, onCard, setOnCard };
}

"use client";

/**
 * The deadlines of every non-archived space (GET /api/deadlines): the open
 * ones, for Today and the welcome screen, and the ones
 * ticked done today, which Today keeps with Undo. One shared read in
 * OpenDeadlinesProvider: it re-reads when spaces change (every deadline
 * edit announces spaces-changed) and after the events channel reconnects.
 * `markDone` ticks one done and `undo` unticks it (PUT done); a save that
 * fails says so in a notice.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { DoneNotice } from "@/frontend/components/done-notice";

interface Fetched {
	open: OpenDeadline[];
	doneToday: OpenDeadline[];
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
	const [fetched, setFetched] = useState<Fetched | null>(null);
	const [error, setError] = useState<string | null>(null);
	const request = useRef(0);

	const load = useCallback(async () => {
		const id = ++request.current;
		try {
			const res = await fetch("/api/deadlines", { cache: "no-store" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = (await res.json()) as { deadlines?: OpenDeadline[]; doneToday?: OpenDeadline[] };
			if (id !== request.current) return;
			setFetched({ open: Array.isArray(body.deadlines) ? body.deadlines : [], doneToday: Array.isArray(body.doneToday) ? body.doneToday : [] });
			setError(null);
		} catch (err) {
			// Keep what we have; the error only matters before a first list.
			if (id === request.current) setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);
	useServerEvent("spaces-changed", () => void load());
	useServerResync(() => void load());

	const [notice, setNotice] = useState<string | null>(null);
	const clearNotice = useCallback(() => setNotice(null), []);
	const setDone = useCallback(
		(d: OpenDeadline, done: boolean, failed: string) => {
			setNotice(null);
			void (async () => {
				try {
					const res = await fetch(`/api/spaces/${encodeURIComponent(d.spaceId)}/deadlines/${encodeURIComponent(d.id)}`, {
						method: "PUT",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ done }),
					});
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					await load();
				} catch {
					setNotice(failed);
				}
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
	/** Why the last read failed; null once one succeeds. */
	error: string | null;
	markDone: (d: OpenDeadline) => void;
	undo: (d: OpenDeadline) => void;
	/** Read the lists again now (Try again). */
	reload: () => Promise<void>;
}

const NONE: OpenDeadline[] = [];

export function useOpenDeadlines(): OpenDeadlinesState {
	const { fetched, error, load, setDone } = useContext(OpenDeadlinesContext);
	const markDone = useCallback((d: OpenDeadline) => setDone(d, true, "Couldn't mark it done. Try again."), [setDone]);
	const undo = useCallback((d: OpenDeadline) => setDone(d, false, "Couldn't undo that. Try again."), [setDone]);
	return { deadlines: fetched?.open ?? null, doneToday: fetched?.doneToday ?? NONE, error, markDone, undo, reload: load };
}

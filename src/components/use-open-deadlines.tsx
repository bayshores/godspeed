"use client";

/**
 * The open deadlines of every non-archived class (GET /api/deadlines), for
 * the sidebar's Due soon, Home, Halley and the welcome screen. One shared
 * read in OpenDeadlinesProvider: it re-reads when classes change (every
 * deadline edit announces classes-changed) and after the events channel
 * reconnects. `markDone` ticks one done (PUT done: true); the row fades
 * out while the list re-reads. The fade is per caller; the notice after it
 * ("Marked done · Undo", or why it failed) is shared.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { byDue, type OpenDeadline } from "@/components/deadlines-model";
import { DoneNotice, type DoneNoticeState } from "@/components/done-notice";

/** How long a ticked row fades before it leaves (just over --lh-dur). */
const LEAVE_MS = 200;
/** How long the notice after a tick stays. */
const NOTICE_MS = 6000;

/** Save a deadline's done; throws when the save fails. */
async function saveDone(d: { classId: string; id: string }, done: boolean): Promise<void> {
	const res = await fetch(`/api/classes/${encodeURIComponent(d.classId)}/deadlines/${encodeURIComponent(d.id)}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ done }),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

interface SharedDeadlines {
	/** null until the first response. */
	fetched: OpenDeadline[] | null;
	/** Why the last read failed; null once one succeeds. */
	error: string | null;
	load: () => Promise<void>;
	/** Show the notice after a tick (null hides it). */
	notify: (notice: DoneNoticeState | null) => void;
}

const OpenDeadlinesContext = createContext<SharedDeadlines>({ fetched: null, error: null, load: async () => {}, notify: () => {} });

export function OpenDeadlinesProvider({ children }: { children: React.ReactNode }) {
	const [fetched, setFetched] = useState<OpenDeadline[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const request = useRef(0);

	const load = useCallback(async () => {
		const id = ++request.current;
		try {
			const res = await fetch("/api/deadlines", { cache: "no-store" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const body = (await res.json()) as { deadlines?: OpenDeadline[] };
			if (id !== request.current) return;
			setFetched(Array.isArray(body.deadlines) ? body.deadlines : []);
			setError(null);
		} catch (err) {
			// Keep what we have; the error only matters before a first list.
			if (id === request.current) setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);
	useServerEvent("classes-changed", () => void load());
	useServerResync(() => void load());

	const [notice, setNotice] = useState<DoneNoticeState | null>(null);
	useEffect(() => {
		if (!notice) return;
		const timer = setTimeout(() => setNotice(null), NOTICE_MS);
		return () => clearTimeout(timer);
	}, [notice]);
	const undo = useCallback(
		async (d: { classId: string; id: string }) => {
			setNotice(null);
			try {
				await saveDone(d, false);
				await load();
			} catch {
				setNotice({ text: "Couldn't undo that. Untick it in Edit class." });
			}
		},
		[load],
	);

	const value = useMemo(() => ({ fetched, error, load, notify: setNotice }), [fetched, error, load]);
	return (
		<OpenDeadlinesContext.Provider value={value}>
			{children}
			{notice && <DoneNotice notice={notice} onUndo={() => notice.undo && void undo(notice.undo)} />}
		</OpenDeadlinesContext.Provider>
	);
}

interface OpenDeadlinesState {
	/** null until the first response. Rows fading out stay in it. */
	deadlines: OpenDeadline[] | null;
	/** Why the last read failed; null once one succeeds. */
	error: string | null;
	/** Ids fading out after a done tick. */
	leaving: ReadonlySet<string>;
	markDone: (d: OpenDeadline) => void;
	/** Read the list again now (Try again). */
	reload: () => Promise<void>;
}

export function useOpenDeadlines(): OpenDeadlinesState {
	const { fetched, error, load, notify } = useContext(OpenDeadlinesContext);
	// A ticked row stays (fading) until its fade ends, even once the
	// re-read list no longer has it.
	const [leavingRows, setLeavingRows] = useState<ReadonlyMap<string, OpenDeadline>>(new Map());

	const markDone = useCallback(
		(d: OpenDeadline) => {
			setLeavingRows((m) => new Map(m).set(d.id, d));
			const drop = () =>
				setLeavingRows((m) => {
					const next = new Map(m);
					next.delete(d.id);
					return next;
				});
			const faded = new Promise((resolve) => setTimeout(resolve, LEAVE_MS));
			void (async () => {
				try {
					await saveDone(d, true);
					await Promise.all([faded, load()]);
					notify({ text: "Marked done", undo: { classId: d.classId, id: d.id } });
				} catch {
					// Not saved: the row comes back.
					notify({ text: "Couldn't mark it done. Try again." });
				}
				drop();
			})();
		},
		[load, notify],
	);

	const deadlines = useMemo(() => {
		if (!fetched) return null;
		const ghosts = [...leavingRows.values()].filter((g) => !fetched.some((d) => d.id === g.id));
		return ghosts.length === 0 ? fetched : byDue([...fetched, ...ghosts]);
	}, [fetched, leavingRows]);
	const leaving = useMemo(() => new Set(leavingRows.keys()), [leavingRows]);

	return { deadlines, error, leaving, markDone, reload: load };
}

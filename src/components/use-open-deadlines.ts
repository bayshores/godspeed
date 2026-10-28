"use client";

/**
 * The open deadlines of every non-archived class (GET /api/deadlines), for
 * the sidebar's Due soon and Home. Re-reads when classes change (every
 * deadline edit announces classes-changed) and after the events channel
 * reconnects. `markDone` ticks one done (PUT done: true); the row fades
 * out while the list re-reads.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { byDue, type OpenDeadline } from "@/components/deadlines-model";

/** How long a ticked row fades before it leaves (just over --lh-dur). */
export const LEAVE_MS = 200;

export interface OpenDeadlinesState {
	/** null until the first response. Rows fading out stay in it. */
	deadlines: OpenDeadline[] | null;
	/** Ids fading out after a done tick. */
	leaving: ReadonlySet<string>;
	markDone: (d: OpenDeadline) => void;
}

export function useOpenDeadlines(): OpenDeadlinesState {
	const [fetched, setFetched] = useState<OpenDeadline[] | null>(null);
	// A ticked row stays (fading) until its fade ends, even once the
	// re-read list no longer has it.
	const [leavingRows, setLeavingRows] = useState<ReadonlyMap<string, OpenDeadline>>(new Map());
	const request = useRef(0);

	const load = useCallback(async () => {
		const id = ++request.current;
		try {
			const res = await fetch("/api/deadlines", { cache: "no-store" });
			if (!res.ok) return;
			const body = (await res.json()) as { deadlines?: OpenDeadline[] };
			if (id === request.current) setFetched(Array.isArray(body.deadlines) ? body.deadlines : []);
		} catch {
			/* offline: keep what we have */
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);
	useServerEvent("classes-changed", () => void load());
	useServerResync(() => void load());

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
					const res = await fetch(`/api/classes/${encodeURIComponent(d.classId)}/deadlines/${encodeURIComponent(d.id)}`, {
						method: "PUT",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ done: true }),
					});
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					await Promise.all([faded, load()]);
				} catch {
					/* not saved: the row comes back */
				}
				drop();
			})();
		},
		[load],
	);

	const deadlines = useMemo(() => {
		if (!fetched) return null;
		const ghosts = [...leavingRows.values()].filter((g) => !fetched.some((d) => d.id === g.id));
		return ghosts.length === 0 ? fetched : byDue([...fetched, ...ghosts]);
	}, [fetched, leavingRows]);
	const leaving = useMemo(() => new Set(leavingRows.keys()), [leavingRows]);

	return { deadlines, leaving, markDone };
}

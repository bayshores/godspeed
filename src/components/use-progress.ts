/**
 * useProgress (redesign plan, owner-approved 2026-10-27): the active
 * class's ProgressPayload from GET /api/progress — shared by the class
 * Overview and the topic Graph page.
 *
 * Re-reads when the class changes, when a turn settles (new answers), when
 * background activity changes (a graph build or the topic grouper
 * finished; debounced so a burst of updates causes one fetch), when classes
 * change (deadlines edited) and after the events channel reconnects.
 * A stale response for a previous class is dropped.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProgressPayload } from "@/core";
import { classQuery, useClasses } from "@/components/class-context";
import { useServerEvent, useServerResync } from "@/components/server-events";

/** The browser's calendar day as YYYY-MM-DD (sets the deadlines' days left). */
export function localDay(now: Date = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

const REFRESH_DEBOUNCE_MS = 400;

export interface ProgressState {
	/** null until the first response (or after an error with no data yet). */
	data: ProgressPayload | null;
	error: string | null;
	loading: boolean;
	refresh: () => void;
}

export function useProgress(): ProgressState {
	const { active } = useClasses();
	const [data, setData] = useState<ProgressPayload | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const request = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const load = useCallback(() => {
		const id = ++request.current;
		setLoading(true);
		fetch(`/api/progress${classQuery(active)}&today=${localDay()}`)
			.then(async (res) => {
				const body = await res.json();
				if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
				return body as ProgressPayload;
			})
			.then((payload) => {
				if (id !== request.current) return;
				setData(payload);
				setError(null);
			})
			.catch((err: unknown) => {
				if (id !== request.current) return;
				setError(err instanceof Error ? err.message : String(err));
			})
			.finally(() => {
				if (id === request.current) setLoading(false);
			});
	}, [active]);

	const refresh = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(load, REFRESH_DEBOUNCE_MS);
	}, [load]);

	// A class switch shows nothing stale: clear, then load at once.
	useEffect(() => {
		setData(null);
		load();
		return () => {
			if (timer.current) clearTimeout(timer.current);
		};
	}, [load]);

	useServerEvent("turn-settled", refresh);
	useServerEvent("activity-changed", refresh);
	useServerEvent("classes-changed", refresh);
	useServerResync(refresh);

	return { data, error, loading, refresh };
}

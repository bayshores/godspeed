/**
 * useProgress: the active
 * space's ProgressPayload from GET /api/progress — shared by the space
 * Overview and the topic Graph page.
 *
 * Re-reads when the space changes, when a turn settles (new answers), when
 * background activity changes (a graph build or the topic grouper
 * finished; debounced so a burst of updates causes one fetch), when spaces
 * change (deadlines edited) and after the events channel reconnects.
 * A stale response for a previous space is dropped.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { localDay, type ProgressPayload } from "@/shared/core";
import { spaceQuery, useSpaces } from "@/frontend/components/space-context";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";


const REFRESH_DEBOUNCE_MS = 400;

interface ProgressState {
	/** null until the first response (or after an error with no data yet). */
	data: ProgressPayload | null;
	error: string | null;
	loading: boolean;
	refresh: () => void;
}

export function useProgress(): ProgressState {
	const { active } = useSpaces();
	const [data, setData] = useState<ProgressPayload | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const request = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const load = useCallback(() => {
		const id = ++request.current;
		setLoading(true);
		fetch(`/api/progress${spaceQuery(active)}&today=${localDay()}`)
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

	// A space switch shows nothing stale: clear, then load at once.
	useEffect(() => {
		setData(null);
		load();
		return () => {
			if (timer.current) clearTimeout(timer.current);
		};
	}, [load]);

	useServerEvent("turn-settled", refresh);
	useServerEvent("activity-changed", refresh);
	useServerEvent("spaces-changed", refresh);
	useServerResync(refresh);

	return { data, error, loading, refresh };
}

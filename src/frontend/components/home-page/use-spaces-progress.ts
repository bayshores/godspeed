"use client";

/**
 * Home's progress for every space it shows (GET /api/progress per space):
 * the facts studied, the latest lesson and each deadline's covers and
 * ready %. Re-reads like useProgress does: when a turn settles, background
 * activity changes, spaces change, and after the events channel
 * reconnects (debounced, so a burst causes one round). A space whose read
 * fails gets an error instead, so it never holds up the others.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localDay, type ProgressPayload } from "@/shared/core";
import { spaceQuery } from "@/frontend/components/space-context";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import { foldSpacesProgress, type SpacesProgress, type ProgressRead } from "./home-page-model";

const REFRESH_DEBOUNCE_MS = 400;

/** `reload`: read every space again now (Try again). */
export function useSpacesProgress(spaceIds: readonly string[]): SpacesProgress & { reload: () => void } {
	const [state, setState] = useState<SpacesProgress>({ progress: new Map(), errors: new Map() });
	const key = spaceIds.join(",");
	const request = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const load = useCallback(() => {
		const id = ++request.current;
		const ids = key ? key.split(",") : [];
		void Promise.all(
			ids.map(async (spaceId): Promise<ProgressRead> => {
				try {
					const res = await fetch(`/api/progress${spaceQuery(spaceId)}&today=${localDay()}`);
					const body = await res.json();
					if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
					return { spaceId, payload: body as ProgressPayload };
				} catch (err) {
					return { spaceId, error: err instanceof Error ? err.message : String(err) };
				}
			}),
		).then((reads) => {
			if (id !== request.current) return;
			setState((prev) => foldSpacesProgress(prev, ids, reads));
		});
	}, [key]);

	const refresh = useCallback(() => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(load, REFRESH_DEBOUNCE_MS);
	}, [load]);

	useEffect(() => {
		load();
		return () => {
			if (timer.current) clearTimeout(timer.current);
		};
	}, [load]);

	useServerEvent("turn-settled", refresh);
	useServerEvent("activity-changed", refresh);
	useServerEvent("spaces-changed", refresh);
	useServerResync(refresh);

	return useMemo(() => ({ ...state, reload: load }), [state, load]);
}

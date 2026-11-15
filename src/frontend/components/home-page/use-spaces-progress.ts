/**
 * Home's progress for every space it shows (GET /api/progress per space):
 * the facts studied, the latest lesson and each deadline's covers and
 * ready %. The lessons with no space are read in the same round, for the
 * week line. Re-reads like useProgress does: when a turn settles, background
 * activity changes, spaces change, and after the events channel
 * reconnects (debounced, so a burst causes one round). A space whose read
 * fails gets an error instead, so it never holds up the others.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchProgress, useProgressRefresh } from "@/frontend/components/use-progress";
import { foldSpacesProgress, type SpacesProgress, type ProgressRead } from "./home-page-model";

/** `reload`: read every space again now (Try again). */
export function useSpacesProgress(spaceIds: readonly string[]): SpacesProgress & { reload: () => void } {
	const [state, setState] = useState<SpacesProgress>({ progress: new Map(), errors: new Map(), noSpace: null });
	const key = spaceIds.join(",");
	const request = useRef(0);

	const load = useCallback(() => {
		const id = ++request.current;
		const ids = key ? key.split(",") : [];
		void Promise.all(
			[...ids, null].map(async (spaceId): Promise<ProgressRead> => {
				try {
					return { spaceId, payload: await fetchProgress(spaceId) };
				} catch (err) {
					return { spaceId, error: err instanceof Error ? err.message : String(err) };
				}
			}),
		).then((reads) => {
			if (id !== request.current) return;
			setState((prev) => foldSpacesProgress(prev, ids, reads));
		});
	}, [key]);

	useProgressRefresh(load);
	useEffect(() => {
		load();
	}, [load]);

	return useMemo(() => ({ ...state, reload: load }), [state, load]);
}

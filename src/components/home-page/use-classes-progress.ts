"use client";

/**
 * Home's progress for every class it shows (GET /api/progress per class):
 * the facts studied, the latest lesson and each deadline's covers and
 * ready %. Re-reads like useProgress does: when a turn settles, background
 * activity changes, classes change, and after the events channel
 * reconnects (debounced, so a burst causes one round). A class whose read
 * fails gets an error instead, so it never holds up the others.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localDay, type ProgressPayload } from "@/core";
import { classQuery } from "@/components/class-context";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { foldClassesProgress, type ClassesProgress, type ProgressRead } from "./home-page-model";

const REFRESH_DEBOUNCE_MS = 400;

/** `reload`: read every class again now (Try again). */
export function useClassesProgress(classIds: readonly string[]): ClassesProgress & { reload: () => void } {
	const [state, setState] = useState<ClassesProgress>({ progress: new Map(), errors: new Map() });
	const key = classIds.join(",");
	const request = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const load = useCallback(() => {
		const id = ++request.current;
		const ids = key ? key.split(",") : [];
		void Promise.all(
			ids.map(async (classId): Promise<ProgressRead> => {
				try {
					const res = await fetch(`/api/progress${classQuery(classId)}&today=${localDay()}`);
					const body = await res.json();
					if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : `HTTP ${res.status}`);
					return { classId, payload: body as ProgressPayload };
				} catch (err) {
					return { classId, error: err instanceof Error ? err.message : String(err) };
				}
			}),
		).then((reads) => {
			if (id !== request.current) return;
			setState((prev) => foldClassesProgress(prev, ids, reads));
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
	useServerEvent("classes-changed", refresh);
	useServerResync(refresh);

	return useMemo(() => ({ ...state, reload: load }), [state, load]);
}

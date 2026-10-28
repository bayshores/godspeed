"use client";

/**
 * Home's progress for every class it shows (GET /api/progress per class):
 * the facts studied, the latest lesson and each deadline's covers and
 * ready %. Re-reads like useProgress does: when a turn settles, background
 * activity changes, classes change, and after the events channel
 * reconnects (debounced, so a burst causes one round).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProgressPayload } from "@/core";
import { classQuery } from "@/components/class-context";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { localDay } from "@/components/use-progress";

const REFRESH_DEBOUNCE_MS = 400;

export function useClassesProgress(classIds: readonly string[]): ReadonlyMap<string, ProgressPayload> {
	const [byClass, setByClass] = useState<ReadonlyMap<string, ProgressPayload>>(new Map());
	const key = classIds.join(",");
	const request = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const load = useCallback(() => {
		const id = ++request.current;
		const ids = key ? key.split(",") : [];
		void Promise.all(
			ids.map(async (classId) => {
				try {
					const res = await fetch(`/api/progress${classQuery(classId)}&today=${localDay()}`);
					if (!res.ok) return null;
					return [classId, (await res.json()) as ProgressPayload] as const;
				} catch {
					return null;
				}
			}),
		).then((entries) => {
			if (id !== request.current) return;
			setByClass((prev) => {
				const next = new Map<string, ProgressPayload>();
				for (const classId of ids) {
					const hit = entries.find((e) => e?.[0] === classId);
					const payload = hit?.[1] ?? prev.get(classId);
					if (payload) next.set(classId, payload);
				}
				return next;
			});
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

	return byClass;
}

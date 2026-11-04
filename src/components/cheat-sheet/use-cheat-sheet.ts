import { useCallback, useEffect, useRef, useState } from "react";
import type { CheatSheetView } from "@/core";
import { jsonInit, send } from "@/components/files/class-files-api";
import { useServerEvent, useServerResync } from "@/components/server-events";

/** A deadline's cheat sheet (GET …/cheat-sheet), read again whenever the
 *  server says it changed; `act` posts one action and returns the error
 *  line, or null. */
export function useCheatSheet(classId: string, deadlineId: string) {
	const url = `/api/classes/${encodeURIComponent(classId)}/deadlines/${encodeURIComponent(deadlineId)}/cheat-sheet`;
	const [view, setView] = useState<CheatSheetView | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const request = useRef(0);

	const reload = useCallback(async () => {
		const id = ++request.current;
		const { error, body } = await send(url, { method: "GET" });
		if (id !== request.current) return;
		if (error) setLoadError(error);
		else {
			setView(body as CheatSheetView);
			setLoadError(null);
		}
	}, [url]);

	useEffect(() => {
		void reload();
	}, [reload]);
	useServerEvent("cheat-sheet-changed", (e) => {
		if (e.deadlineId === deadlineId) void reload();
	});
	useServerEvent("classes-changed", () => void reload());
	useServerResync(() => void reload());

	const act = useCallback(async (body: Record<string, unknown>) => (await send(url, jsonInit("POST", body))).error, [url]);

	return { view, loadError, reload, act };
}

/** The studio's address for a deadline. */
export function studioPath(deadlineId: string): string {
	return `/class/deadline/${encodeURIComponent(deadlineId)}/cheat-sheet`;
}

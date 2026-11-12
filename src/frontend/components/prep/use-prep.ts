import { useCallback, useEffect, useRef, useState } from "react";
import type { PrepView } from "@/shared/core";
import { jsonInit, send } from "@/frontend/components/files/space-files-api";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";

/** A prep as its page shows it (GET …/prep), read again whenever the
 *  server says it changed or an answer may have moved a topic; `act` posts
 *  one action and returns the error line, or null. */
export function usePrep(spaceId: string) {
	const url = `/api/spaces/${encodeURIComponent(spaceId)}/prep`;
	const [view, setView] = useState<PrepView | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const request = useRef(0);

	const reload = useCallback(async () => {
		const id = ++request.current;
		const { error, body } = await send(url, { method: "GET" });
		if (id !== request.current) return;
		if (error) setLoadError(error);
		else {
			setView(body as PrepView);
			setLoadError(null);
		}
	}, [url]);

	useEffect(() => {
		setView(null);
		void reload();
	}, [reload]);
	useServerEvent("prep-changed", (e) => {
		if (e.spaceId === spaceId) void reload();
	});
	useServerEvent("spaces-changed", () => void reload());
	useServerResync(() => void reload());

	const act = useCallback(async (body: Record<string, unknown>) => (await send(url, jsonInit("POST", body))).error, [url]);

	return { view, loadError, reload, act };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { jsonInit, send } from "@/frontend/lib/api";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import type { AskError, RequestKind, RequestState } from "./request-model";

/**
 * The request on a deadline (GET /api/spaces/:id/deadlines/:did/request),
 * read again whenever it starts or ends, and on a space change while a
 * request that changed nothing shows (linking files by hand clears it);
 * null until read. `ask` starts one;
 * `askError` is the last start that failed.
 */
export function useDeadlineRequest(spaceId: string, deadlineId: string) {
	const [state, setState] = useState<RequestState | null>(null);
	const [askError, setAskError] = useState<AskError | null>(null);
	const request = useRef(0);
	const url = `/api/spaces/${encodeURIComponent(spaceId)}/deadlines/${encodeURIComponent(deadlineId)}/request`;

	const reload = useCallback(async () => {
		const id = ++request.current;
		const { error, body } = await send(url, { method: "GET" });
		if (id === request.current && !error) setState(body as RequestState);
	}, [url]);

	useEffect(() => {
		void reload();
	}, [reload]);
	useServerEvent("deadline-request-changed", (e) => {
		if (e.deadlineId === deadlineId) void reload();
	});
	useServerEvent("spaces-changed", () => {
		if (state?.failed) void reload();
	});
	useServerResync(() => void reload());

	const ask = useCallback(
		async (kind: RequestKind) => {
			setAskError(null);
			const { error } = await send(url, jsonInit("POST", { kind }));
			if (error) setAskError({ kind, error });
			await reload();
		},
		[url, reload],
	);

	return { state, askError, ask };
}

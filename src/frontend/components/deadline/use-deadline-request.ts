import { useCallback, useRef, useState } from "react";
import { jsonInit, send } from "@/frontend/lib/api";
import { useServerResource } from "@/frontend/components/use-server-resource";
import type { AskError, RequestKind, RequestState } from "./request-model";

/**
 * The request on a deadline (GET /api/spaces/:id/deadlines/:did/request),
 * read again whenever it starts or ends, and on a space change while a
 * request that changed nothing shows (linking files by hand clears it);
 * null until read. `ask` starts one;
 * `askError` is the last start that failed.
 */
export function useDeadlineRequest(spaceId: string, deadlineId: string) {
	const [askError, setAskError] = useState<AskError | null>(null);
	const url = `/api/spaces/${encodeURIComponent(spaceId)}/deadlines/${encodeURIComponent(deadlineId)}/request`;
	const failed = useRef(false);
	const { value: state, reload } = useServerResource<RequestState>(url, {
		on: { "deadline-request-changed": (e) => e.deadlineId === deadlineId, "spaces-changed": () => failed.current },
	});
	failed.current = !!state?.failed;

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

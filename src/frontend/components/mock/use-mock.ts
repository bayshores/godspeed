import { useCallback, useEffect, useRef, useState } from "react";
import type { MockView } from "@/shared/core";
import { jsonInit, send } from "@/frontend/components/files/space-files-api";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";

const mockUrl = (spaceId: string, mockId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/mocks/${encodeURIComponent(mockId)}`;

/** Post one action to a mock: the error line (or null) and the reply. */
export function postMock(spaceId: string, mockId: string, body: Record<string, unknown>) {
	return send(mockUrl(spaceId, mockId), jsonInit("POST", body));
}

export async function removeMock(spaceId: string, mockId: string): Promise<string | null> {
	return (await send(mockUrl(spaceId, mockId), { method: "DELETE" })).error;
}

/** A mock as its page shows it (GET …/mocks/<id>), read again whenever the
 *  server says the space's mocks changed. */
export function useMock(spaceId: string, mockId: string) {
	const [view, setView] = useState<MockView | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const request = useRef(0);

	const reload = useCallback(async () => {
		const id = ++request.current;
		const { error, body } = await send(mockUrl(spaceId, mockId), { method: "GET" });
		if (id !== request.current) return;
		if (error) setLoadError(error);
		else {
			setView(body as MockView);
			setLoadError(null);
		}
	}, [spaceId, mockId]);

	useEffect(() => {
		setView(null);
		void reload();
	}, [reload]);
	useServerEvent("mocks-changed", (e) => {
		if (e.spaceId === spaceId) void reload();
	});
	useServerResync(() => void reload());

	return { view, loadError, reload };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { MockView } from "@/shared/core";
import { jsonInit, send } from "@/frontend/components/files/space-files-api";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import { mockHref } from "./mock-model";

const mockUrl = (spaceId: string, mockId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/mocks/${encodeURIComponent(mockId)}`;

/** Post one action to a mock: the error line (or null) and the reply. */
export function postMock(spaceId: string, mockId: string, body: Record<string, unknown>) {
	return send(mockUrl(spaceId, mockId), jsonInit("POST", body));
}

export async function removeMock(spaceId: string, mockId: string): Promise<string | null> {
	return (await send(mockUrl(spaceId, mockId), { method: "DELETE" })).error;
}

/** A mock as its page shows it (GET …/mocks/<id>), read again whenever the
 *  server says its prep changed. */
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
	useServerEvent("prep-changed", (e) => {
		if (e.spaceId === spaceId) void reload();
	});
	useServerResync(() => void reload());

	return { view, loadError, reload };
}

/** "Take a mock": makes the prep's next mock and opens its page. */
export function useTakeMock(spaceId: string) {
	const navigate = useNavigate();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const take = useCallback(async () => {
		setBusy(true);
		setError(null);
		const { error: failed, body } = await send(`/api/spaces/${encodeURIComponent(spaceId)}/mocks`, { method: "POST" });
		if (failed) {
			setBusy(false);
			setError(failed);
		} else navigate(mockHref(spaceId, (body as { mockId: string }).mockId));
	}, [spaceId, navigate]);
	return { take, busy, error };
}

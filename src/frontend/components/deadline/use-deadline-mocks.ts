import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { MockSummary } from "@/shared/core";
import { jsonInit, send } from "@/frontend/components/files/space-files-api";
import { mockHref } from "@/frontend/components/mock/mock-model";
import { removeMock } from "@/frontend/components/mock/use-mock";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import { newMockBody } from "./mocks-model";

/**
 * A deadline's mocks, newest first (GET /api/spaces/:id/mocks?deadline=),
 * read again whenever the space's mocks change; null until read. `write`
 * makes the next one and opens its page; `remove` removes one. Both give
 * back the error line, or null. `deadlineId` null reads nothing.
 */
export function useDeadlineMocks(spaceId: string, deadlineId: string | null) {
	const navigate = useNavigate();
	const [mocks, setMocks] = useState<MockSummary[] | null>(null);
	const [failed, setFailed] = useState(false);
	const request = useRef(0);
	const base = `/api/spaces/${encodeURIComponent(spaceId)}/mocks`;

	const reload = useCallback(async () => {
		const id = ++request.current;
		if (!deadlineId) return;
		const { error, body } = await send(`${base}?deadline=${encodeURIComponent(deadlineId)}`, { method: "GET" });
		if (id !== request.current) return;
		setFailed(error !== null);
		if (!error) setMocks(body as MockSummary[]);
	}, [base, deadlineId]);

	useEffect(() => {
		setMocks(null);
		void reload();
	}, [reload]);
	useServerEvent("mocks-changed", (e) => {
		if (e.spaceId === spaceId) void reload();
	});
	useServerResync(() => void reload());

	const write = useCallback(
		async (questions: number, minutes: number | null): Promise<string | null> => {
			if (!deadlineId) return null;
			const { error, body } = await send(base, jsonInit("POST", newMockBody(deadlineId, questions, minutes)));
			if (!error) navigate(mockHref(spaceId, (body as { mockId: string }).mockId));
			return error;
		},
		[base, deadlineId, spaceId, navigate],
	);

	const remove = useCallback(
		async (mockId: string): Promise<string | null> => {
			const error = await removeMock(spaceId, mockId);
			if (!error) await reload();
			return error;
		},
		[spaceId, reload],
	);

	return { mocks, failed, reload, write, remove };
}

/** How many mocks a deadline has, read once while `deadlineId` is given
 *  (the remove question names them); 0 until read. */
export function useMockCount(spaceId: string, deadlineId: string | null): number {
	const [count, setCount] = useState(0);
	useEffect(() => {
		if (!deadlineId) return;
		let live = true;
		void send(`/api/spaces/${encodeURIComponent(spaceId)}/mocks?deadline=${encodeURIComponent(deadlineId)}`, { method: "GET" }).then(({ error, body }) => {
			if (live && !error && Array.isArray(body)) setCount(body.length);
		});
		return () => {
			live = false;
		};
	}, [spaceId, deadlineId]);
	return count;
}

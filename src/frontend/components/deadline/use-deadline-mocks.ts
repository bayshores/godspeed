import { useCallback } from "react";
import { useNavigate } from "react-router";
import type { MockSummary } from "@/shared/core";
import { jsonInit, send } from "@/frontend/lib/api";
import { mockHref } from "@/frontend/components/mock/mock-model";
import { removeMock } from "@/frontend/components/mock/use-mock";
import { useServerResource } from "@/frontend/components/use-server-resource";
import { newMockBody } from "./mocks-model";

const mocksUrl = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/mocks`;

/** GET a deadline's mocks, newest first. */
export const deadlineMocksUrl = (spaceId: string, deadlineId: string) => `${mocksUrl(spaceId)}?deadline=${encodeURIComponent(deadlineId)}`;

/** A deadline's mocks as GET deadlineMocksUrl answers. */
export interface DeadlineMocksRead {
	mocks: MockSummary[];
}

/** The read both hooks below share: a deadline's mocks, newest first,
 *  read again whenever the space's mocks change; null until read. */
function useMocksRead(spaceId: string, deadlineId: string | null, initial?: DeadlineMocksRead) {
	const { value, error, reload } = useServerResource<DeadlineMocksRead>(deadlineId ? deadlineMocksUrl(spaceId, deadlineId) : null, {
		on: { "mocks-changed": (e) => e.spaceId === spaceId },
		initial,
	});
	return { mocks: value?.mocks ?? null, failed: error !== null, reload };
}

/**
 * A deadline's mocks (GET /api/spaces/:id/mocks?deadline=). `write`
 * makes the next one and opens its page; `remove` removes one. Both give
 * back the error line, or null. `deadlineId` null reads nothing;
 * `initial` is what the page's loader read.
 */
export function useDeadlineMocks(spaceId: string, deadlineId: string | null, initial?: DeadlineMocksRead) {
	const navigate = useNavigate();
	const base = mocksUrl(spaceId);
	const { mocks, failed, reload } = useMocksRead(spaceId, deadlineId, initial);

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

/** How many mocks a deadline has, read while `deadlineId` is given (the
 *  remove question names them); 0 until read. */
export function useMockCount(spaceId: string, deadlineId: string | null): number {
	return useMocksRead(spaceId, deadlineId).mocks?.length ?? 0;
}

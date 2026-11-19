import type { MockView } from "@/shared/core";
import { jsonInit, send } from "@/frontend/lib/api";
import { useServerResource } from "@/frontend/components/use-server-resource";

export const mockUrl = (spaceId: string, mockId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/mocks/${encodeURIComponent(mockId)}`;

/** Post one action to a mock: the error line (or null) and the reply. */
export function postMock(spaceId: string, mockId: string, body: Record<string, unknown>) {
	return send(mockUrl(spaceId, mockId), jsonInit("POST", body));
}

export async function removeMock(spaceId: string, mockId: string): Promise<string | null> {
	return (await send(mockUrl(spaceId, mockId), { method: "DELETE" })).error;
}

/** A mock as its page shows it (GET …/mocks/<id>), read again whenever the
 *  server says the space's mocks changed. `initial` is the route loader's read. */
export function useMock(spaceId: string, mockId: string, initial: MockView) {
	const { value, error, reload } = useServerResource<MockView>(mockUrl(spaceId, mockId), { on: { "mocks-changed": (e) => e.spaceId === spaceId }, initial });
	return { view: value, loadError: error, reload };
}

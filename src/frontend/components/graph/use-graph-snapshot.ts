import type { GraphSnapshot } from "@/shared/core";
import { spaceQuery } from "@/frontend/components/space-context";
import { useServerResource } from "@/frontend/components/use-server-resource";

/** A space's graph (GET /api/graph): its facts, chains and their sources. */
export function useGraphSnapshot(spaceId: string | null) {
	return useServerResource<GraphSnapshot>(`/api/graph${spaceQuery(spaceId)}`);
}

import { useEffect, useState } from "react";
import type { GraphCostSummary } from "@/shared/core";
import { spaceQuery } from "@/frontend/components/space-context";
import { getJson } from "@/frontend/lib/api";

/** The space's graph-pipeline spend (Graph costs in the teacher's Activity); null until it loads. */
export function useGraphCosts(spaceId: string | null): GraphCostSummary | null {
	const [state, setState] = useState<{ spaceId: string | null; costs: GraphCostSummary } | null>(null);
	useEffect(() => {
		let live = true;
		void getJson<GraphCostSummary>(`/api/graph/costs${spaceQuery(spaceId)}`).then(({ body }) => {
			if (live && body) setState({ spaceId, costs: body });
		});
		return () => {
			live = false;
		};
	}, [spaceId]);
	return state && state.spaceId === spaceId ? state.costs : null;
}

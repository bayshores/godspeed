import { useEffect, useState } from "react";
import type { GraphCostSummary } from "@/shared/core";
import { spaceQuery } from "@/frontend/components/space-context";

/** The space's graph-pipeline spend (the Graph costs popup); null until it loads. */
export function useGraphCosts(spaceId: string | null): GraphCostSummary | null {
	const [state, setState] = useState<{ spaceId: string | null; costs: GraphCostSummary } | null>(null);
	useEffect(() => {
		let live = true;
		fetch(`/api/graph/costs${spaceQuery(spaceId)}`)
			.then((res) => (res.ok ? (res.json() as Promise<GraphCostSummary>) : null))
			.then((costs) => {
				if (live && costs) setState({ spaceId, costs });
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [spaceId]);
	return state && state.spaceId === spaceId ? state.costs : null;
}

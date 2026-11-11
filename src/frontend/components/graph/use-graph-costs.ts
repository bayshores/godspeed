import { useEffect, useState } from "react";
import type { GraphCostSummary } from "@/shared/core";
import { classQuery } from "@/frontend/components/class-context";

/** The class's graph-pipeline spend (the Graph costs popup); null until it loads. */
export function useGraphCosts(classId: string | null): GraphCostSummary | null {
	const [state, setState] = useState<{ classId: string | null; costs: GraphCostSummary } | null>(null);
	useEffect(() => {
		let live = true;
		fetch(`/api/graph/costs${classQuery(classId)}`)
			.then((res) => (res.ok ? (res.json() as Promise<GraphCostSummary>) : null))
			.then((costs) => {
				if (live && costs) setState({ classId, costs });
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [classId]);
	return state && state.classId === classId ? state.costs : null;
}

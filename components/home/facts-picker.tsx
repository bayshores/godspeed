import { useEffect, useState } from "react";
import type { GraphContextPick, GraphSnapshot } from "@/src/core";
import { classQuery } from "@/components/class-context";
import { ChainTableOverlay } from "@/components/chain-table.tsx";

/** The class's graph, read once per class (the picker's rows). */
export function useGraphSnapshot(classId: string | null): GraphSnapshot | null {
	const [state, setState] = useState<{ classId: string | null; snapshot: GraphSnapshot } | null>(null);
	useEffect(() => {
		let live = true;
		fetch(`/api/graph${classQuery(classId)}`)
			.then((res) => res.json() as Promise<GraphSnapshot>)
			.then((snapshot) => {
				if (live) setState({ classId, snapshot });
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [classId]);
	return state && state.classId === classId ? state.snapshot : null;
}

/**
 * "Start from facts": the chain table in select mode. The picks ride the
 * new lesson's creation (its opening context); Home holds them, so they
 * survive a Teach/Practice switch.
 */
export function FactsPicker({
	open,
	snapshot,
	picked,
	onPicked,
	onClose,
}: {
	open: boolean;
	snapshot: GraphSnapshot | null;
	picked: ReadonlySet<string>;
	onPicked: (picks: GraphContextPick[]) => void;
	onClose: () => void;
}) {
	const nodes = snapshot?.propositions ?? [];
	return (
		<ChainTableOverlay
			open={open && nodes.length > 0}
			nodes={nodes}
			chains={snapshot?.chains ?? []}
			sessions={snapshot?.sessions ?? {}}
			fileSources={snapshot?.fileSources ?? {}}
			onClose={onClose}
			selectMode
			controlledSelection={picked}
			onSelectionChange={(ids) => {
				const byId = new Map(nodes.map((n) => [n.id, n]));
				const picks: GraphContextPick[] = [];
				for (const id of ids) {
					const n = byId.get(id);
					if (n) picks.push({ id: n.id, name: n.name, statement: n.statement });
				}
				onPicked(picks);
			}}
		/>
	);
}

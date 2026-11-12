import { useEffect, useState } from "react";
import type { GraphContextPick, GraphSnapshot } from "@/shared/core";
import { spaceQuery } from "@/frontend/components/space-context";
import { LazyChainTableOverlay as ChainTableOverlay } from "@/frontend/components/chain-table-lazy.tsx";

/** The space's graph, read once per space (the picker's rows). */
export function useGraphSnapshot(spaceId: string | null): GraphSnapshot | null {
	const [state, setState] = useState<{ spaceId: string | null; snapshot: GraphSnapshot } | null>(null);
	useEffect(() => {
		let live = true;
		fetch(`/api/graph${spaceQuery(spaceId)}`)
			.then((res) => (res.ok ? (res.json() as Promise<GraphSnapshot>) : null))
			.then((snapshot) => {
				if (live && snapshot) setState({ spaceId, snapshot });
			})
			.catch(() => {});
		return () => {
			live = false;
		};
	}, [spaceId]);
	return state && state.spaceId === spaceId ? state.snapshot : null;
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

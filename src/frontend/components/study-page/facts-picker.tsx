import type { GraphContextPick, GraphSnapshot } from "@/shared/core";
import { LazyChainTableOverlay as ChainTableOverlay } from "@/frontend/components/chain-table-lazy.tsx";

/**
 * "Start from facts": the chain table in select mode. The picks ride the
 * new lesson's creation (its opening context); the Study page holds them, so they
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

import { useEffect, useMemo, useState } from "react";
import type { GraphChain, GraphNode } from "@/shared/core";
import { useSpaces } from "@/frontend/components/space-context";
import { DeleteNodeDialog } from "@/frontend/components/delete-node-dialog";
import { ChainTableBody } from "./chain-table";
import { nextSort, toggled, withIds, type ChainSort } from "./chain-table-model";

/**
 * "All facts" over the page: it covers the space head too, but not the
 * app's top bar (48px) or the docked teacher panel. It owns the search,
 * sort, open rows and picked facts; Esc and "Close" leave.
 *
 * Passing `controlledSelection` + `onSelectionChange` lifts the picked
 * facts to the caller (the Study page's "start from facts"), and
 * `selectMode` swaps "Delete" for "Done", so picking never deletes.
 */
export function ChainTableOverlay({
	open,
	nodes,
	chains,
	sessions,
	fileSources,
	onClose,
	selectMode,
	controlledSelection,
	onSelectionChange,
}: {
	open: boolean;
	nodes: GraphNode[];
	chains: GraphChain[];
	sessions: Record<string, string>;
	fileSources: Record<string, string>;
	onClose: () => void;
	selectMode?: boolean;
	controlledSelection?: ReadonlySet<string>;
	onSelectionChange?: (next: ReadonlySet<string>) => void;
}) {
	const { activeSpace } = useSpaces();
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<ChainSort>({ col: "name", dir: 1 });
	const [internalSelection, setInternalSelection] = useState<ReadonlySet<string>>(() => new Set());
	const [expandedClusters, setExpandedClusters] = useState<ReadonlySet<string>>(() => new Set());
	const [expandedChains, setExpandedChains] = useState<ReadonlySet<string>>(() => new Set());
	const [deleteOpen, setDeleteOpen] = useState(false);

	const selection = controlledSelection ?? internalSelection;
	const applySelection = (next: ReadonlySet<string>) => {
		if (onSelectionChange) onSelectionChange(next);
		else setInternalSelection(next);
	};
	const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
	// A fact deleted elsewhere drops out of the count.
	const liveSelection = useMemo<ReadonlySet<string>>(() => new Set([...selection].filter((id) => byId.has(id))), [selection, byId]);

	// The delete dialog's own Esc wins while it is open.
	useEffect(() => {
		if (!open || deleteOpen) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			// Claimed, so Esc never also stops the teacher's reply.
			e.preventDefault();
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, deleteOpen, onClose]);

	if (!open) return null;
	const selectedNodes = [...liveSelection].flatMap((id) => {
		const n = byId.get(id);
		return n ? [{ id: n.id, name: n.name }] : [];
	});

	return (
		<>
			{/* Fixed under the top bar; the right edge follows the docked panel's push. */}
			<div data-testid="chain-table-overlay" className="lh-dots fixed top-12 right-(--lh-dock-push,0px) bottom-0 left-0 z-40 flex flex-col bg-background">
				<ChainTableBody
					nodes={nodes}
					chains={chains}
					sessions={sessions}
					fileSources={fileSources}
					spaceLabel={activeSpace?.name ?? null}
					query={query}
					onQuery={setQuery}
					sort={sort}
					onSort={(col) => setSort((prev) => nextSort(prev, col))}
					selection={liveSelection}
					expandedClusters={expandedClusters}
					expandedChains={expandedChains}
					onToggleCluster={(key) => setExpandedClusters((prev) => toggled(prev, key))}
					onToggleChain={(id) => setExpandedChains((prev) => toggled(prev, id))}
					onToggleNodes={(ids, next) => applySelection(withIds(liveSelection, ids, next))}
					onClear={() => applySelection(new Set())}
					onDelete={() => setDeleteOpen(true)}
					onClose={onClose}
					selectMode={selectMode}
					onSelect={onClose}
				/>
			</div>
			<DeleteNodeDialog
				nodes={deleteOpen ? selectedNodes : null}
				onClose={() => setDeleteOpen(false)}
				onDeleted={(deadIds, graphRevision) => {
					// Keep the rest of the picks, and tell the graph to reload.
					setDeleteOpen(false);
					const dead = new Set(deadIds);
					applySelection(new Set([...liveSelection].filter((id) => !dead.has(id))));
					window.dispatchEvent(new CustomEvent("lh:graph-revision", { detail: { graphRevision } }));
				}}
			/>
		</>
	);
}

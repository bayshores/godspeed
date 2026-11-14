import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { spaceQuery, useSpaces } from "@/frontend/components/space-context";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";

type Node = { id: string; name: string };

/**
 * "Delete fact?": deletes facts for good, with every link and event that
 * names them. One fact (a fact's right-click menu) or many (the picked
 * facts in All facts). A failure shows the server's line with "Try again".
 */
export function DeleteNodeDialog({
	nodes,
	onClose,
	onDeleted,
}: {
	/** The facts up for deletion, as the screen names them; null or empty = closed. */
	nodes: Node[] | null;
	onClose: () => void;
	/** Gets every id that was deleted, even when a later one failed. */
	onDeleted: (nodeIds: string[], graphRevision: number) => void;
}) {
	const { active: activeSpaceId } = useSpaces();
	const { mounted, state, shown } = useLastWhileClosing(nodes && nodes.length > 0 ? nodes : null);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	// Each open starts clean, once the exit has played.
	useEffect(() => {
		if (!mounted) {
			setBusy(false);
			setFailure(null);
		}
	}, [mounted]);

	// One at a time, in order: the graph's revision count must see them in
	// order. A failure stops the rest (a graph run may be in progress).
	const run = async () => {
		if (!nodes || nodes.length === 0 || busy) return;
		setBusy(true);
		setFailure(null);
		const dead: string[] = [];
		let revision = 0;
		try {
			for (const n of nodes) {
				const res = await fetch(`/api/graph/nodes/${encodeURIComponent(n.id)}${spaceQuery(activeSpaceId)}`, { method: "DELETE" });
				const body = (await res.json()) as { error?: string; graphRevision?: number };
				if (!res.ok) {
					setFailure(body.error ?? `Delete failed (${res.status})`);
					setBusy(false);
					if (dead.length > 0) onDeleted(dead, revision);
					return;
				}
				dead.push(n.id);
				revision = body.graphRevision ?? revision;
			}
			onDeleted(dead, revision);
		} catch {
			setFailure("Delete failed: network error. Try again.");
			setBusy(false);
			if (dead.length > 0) onDeleted(dead, revision);
		}
	};

	if (!mounted || !shown) return null;
	return createPortal(
		<DeleteNodeBody
			state={state}
			nodes={shown}
			busy={busy}
			failure={failure}
			onClose={() => {
				if (!busy) onClose();
			}}
			onRun={() => void run()}
		/>,
		document.body,
	);
}

/** The dialog itself, without its state (the render tests draw it). */
export function DeleteNodeBody({
	nodes,
	busy,
	failure,
	onClose,
	onRun,
	state = "open",
}: {
	nodes: Node[];
	busy: boolean;
	/** The server's line for a delete that didn't go through. */
	failure: string | null;
	onClose: () => void;
	onRun: () => void;
	/** "closed" while the exit plays. */
	state?: "open" | "closed";
}) {
	const one = nodes.length === 1;
	return (
		<DialogSheet
			title={one ? "Delete fact?" : `Delete ${nodes.length} facts?`}
			state={state}
			testid="delete-node-dialog"
			busy={busy}
			onClose={onClose}
			className="w-[540px]"
			foot={
				<>
					<span className="flex-1" />
					<button type="button" data-testid="node-delete-cancel" onClick={onClose} disabled={busy} className="lh-btn text-[15px]">
						Cancel
					</button>
					<button type="button" data-testid="node-delete-confirm" onClick={onRun} disabled={busy} className="lh-btn lh-btn-danger text-[15px]">
						{busy ? "Deleting…" : "Delete"}
					</button>
				</>
			}
		>
			{/* Many names stop at 8; the title has the full count. */}
			<p data-testid={one ? "node-name-code" : "node-names-code"} className="font-count text-lg break-words text-ink">
				{one ? nodes[0]?.name : nodes.slice(0, 8).map((n) => n.name).join(", ") + (nodes.length > 8 ? `, and ${nodes.length - 8} more` : "")}
			</p>
			<p data-testid="node-permanence-line" className="text-lg text-ink">
				{one ? "This permanently deletes the fact. This cannot be undone." : `This permanently deletes all ${nodes.length} facts. This cannot be undone.`}
			</p>
			{failure && (
				<div role="alert" data-testid="node-delete-failure" className="flex flex-wrap items-center gap-2.5">
					<span className="min-w-0 flex-1 basis-[200px] text-[15px] text-ans-wrong">{failure}</span>
					<button type="button" data-testid="node-delete-retry" onClick={onRun} disabled={busy} className="lh-btn text-[15px]">
						Try again
					</button>
				</div>
			)}
		</DialogSheet>
	);
}

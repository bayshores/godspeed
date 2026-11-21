import { useEffect } from "react";
import { createPortal } from "react-dom";
import { send, serverError } from "@/frontend/lib/api";
import { spaceQuery, useSpaces } from "@/frontend/components/space-context";
import { DeleteFoot, FailureRow } from "@/frontend/components/ui/delete-dialog-parts";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";

type Node = { id: string; name: string };

/**
 * "Delete fact?": deletes facts for good, with every link and event that
 * names them. One fact or many (the picked facts in All facts). A failure shows the server's line with "Try again".
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
	// It stays busy while it closes after the delete.
	const { busy, error: failure, run: guard, reset } = useGuardedAction({ stayBusy: true });

	// Each open starts clean, once the exit has played.
	useEffect(() => {
		if (!mounted) reset();
	}, [mounted, reset]);

	// One at a time, in order: the graph's revision count must see them in
	// order. A failure stops the rest (a graph run may be in progress).
	const run = async () => {
		if (!nodes || nodes.length === 0) return;
		await guard(async () => {
			const dead: string[] = [];
			let revision = 0;
			for (const n of nodes) {
				const { error, body, status } = await send(`/api/graph/nodes/${encodeURIComponent(n.id)}${spaceQuery(activeSpaceId)}`, { method: "DELETE" });
				if (error) {
					if (dead.length > 0) onDeleted(dead, revision);
					return status === 0 ? "Delete failed: network error. Try again." : (serverError(body) ?? `Delete failed (${status})`);
				}
				dead.push(n.id);
				revision = (body as { graphRevision?: number }).graphRevision ?? revision;
			}
			onDeleted(dead, revision);
			return null;
		});
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
			foot={<DeleteFoot cancelTestid="node-delete-cancel" confirmTestid="node-delete-confirm" busy={busy} onClose={onClose} onRun={onRun} />}
		>
			{/* Many names stop at 8; the title has the full count. */}
			<p data-testid={one ? "node-name-code" : "node-names-code"} className="font-count text-lg break-words text-ink">
				{one ? nodes[0]?.name : nodes.slice(0, 8).map((n) => n.name).join(", ") + (nodes.length > 8 ? `, and ${nodes.length - 8} more` : "")}
			</p>
			<p data-testid="node-permanence-line" className="text-lg text-ink">
				{one ? "This permanently deletes the fact. This cannot be undone." : `This permanently deletes all ${nodes.length} facts. This cannot be undone.`}
			</p>
			{failure && <FailureRow testid="node-delete-failure" retryTestid="node-delete-retry" failure={failure} busy={busy} onRun={onRun} />}
		</DialogSheet>
	);
}

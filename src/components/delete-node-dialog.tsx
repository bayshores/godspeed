import { classQuery, useClasses } from "@/components/class-context";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { usePresence } from "@/components/presence";

/**
 * Node deletion: the confirm surface, portaled z-50 like the
 * session-delete dialog. FULL DEATH: the node, every edge touching it,
 * every event naming it.
 *
 * Minimal on purpose: no pre-flight impact read (a fetch would flicker
 * the dialog open-closed). The screen is: title, names, one permanence
 * line, Cancel / Delete. A failure shows the server's own sentence with a
 * Try-again (a graph run in progress clears on its own).
 */
/** The dialog's pure body — exported for SSR pins (the settings-dialog
 *  body pattern). The wrapper owns state + effects + the portal. */
export function DeleteNodeBody({
	nodes,
	busy,
	failure,
	onClose,
	onRun,
	state = "open",
}: {
	/** One node (the canvas context menu) or many (the chain table's
	 *  selection). One names it alone; many pluralize the title and
	 *  list the names. */
	nodes: { id: string; name: string }[];
	busy: boolean;
	/** The server's sentence (or a network line) when a delete failed. */
	failure: string | null;
	onClose: () => void;
	onRun: () => void;
	/** "closed" while the exit plays. */
	state?: "open" | "closed";
}) {
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Delete node"
			data-testid="delete-node-dialog"
			data-state={state}
			onClick={(e) => e.stopPropagation()}
			className="lh-dialog w-[32rem] max-w-[calc(100vw-2rem)] border bg-card p-5 shadow-xl"
		>
			<h2 className="text-sm font-semibold text-destructive">
				{nodes.length === 1 ? "Delete node?" : `Delete ${nodes.length} nodes?`}
			</h2>
			{/* The node name(s) below the title in mono, no code-block
			    chrome. Same shape as the session dialog. A multi-selection
			    lists its names (capped at 8 + "and K more"; the count in the
			    title carries the full number). */}
			<div className="mt-1.5">
				{nodes.length === 1 ? (
					<code data-testid="node-name-code" className="font-mono text-sm text-foreground">
						{nodes[0]?.name}
					</code>
				) : (
					<code data-testid="node-names-code" className="font-mono text-sm text-foreground">
						{nodes.slice(0, 8).map((n) => n.name).join(", ")}
						{nodes.length > 8 ? `, and ${nodes.length - 8} more` : ""}
					</code>
				)}
			</div>
			<p className="mt-2 text-sm text-muted-foreground" data-testid="node-permanence-line">
				{nodes.length === 1
					? "This permanently deletes the node. This cannot be undone."
					: `This permanently deletes all ${nodes.length} nodes. This cannot be undone.`}
			</p>
			{failure && (
				<div
					role="alert"
					data-testid="node-delete-failure"
					className="mt-3 border border-border/60 px-3 py-2 text-xs"
				>
					<span className="text-foreground">
						{failure}
					</span>
					<button
						type="button"
						data-testid="node-delete-retry"
						onClick={onRun}
						disabled={busy}
						className="lh-press ml-3 text-xs text-foreground underline-offset-2 hover:underline disabled:opacity-40"
					>
						Try again
					</button>
				</div>
			)}
			<div className="mt-4 flex justify-end gap-2">
				<button
					type="button"
					data-testid="node-delete-cancel"
					onClick={onClose}
					disabled={busy}
					className="lh-press px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
				>
					Cancel
				</button>
				<button
					type="button"
					data-testid="node-delete-confirm"
					onClick={onRun}
					disabled={busy}
					// The app's destructive red pair: border + text,
					// fill on hover.
					className="lh-press border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-40"
				>
					{busy ? "Deleting…" : "Delete"}
				</button>
			</div>
		</div>
	);
}

export function DeleteNodeDialog({
	nodes,
	onClose,
	onDeleted,
}: {
	/** The nodes up for deletion; null/empty = closed. One (the canvas
	 *  context menu) or many (the chain table's selection). Names from
	 *  the client's snapshot — what the user sees is what the dialog
	 *  names. */
	nodes: { id: string; name: string }[] | null;
	onClose: () => void;
	/** Success path — the callers announce lh:graph-revision so the
	 *  snapshot refetches. The deleted ids ride along so
	 *  selection-side callers can prune. */
	onDeleted: (nodeIds: string[], graphRevision: number) => void;
}) {
	const { active: activeClassId } = useClasses();
	// Exit motion: the last names stay on
	// screen while the dialog fades out.
	const isOpen = !!nodes && nodes.length > 0;
	const presence = usePresence(isOpen);
	const [lastNodes, setLastNodes] = useState(nodes);
	if (isOpen && nodes !== lastNodes) setLastNodes(nodes);
	const shown = isOpen ? nodes : lastNodes;
	const [busy, setBusy] = useState(false);
	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onClose();
	});
	const [failure, setFailure] = useState<string | null>(null);

	// Fresh state per dialog: closing resets (once the exit has played).
	useEffect(() => {
		if (!presence.mounted) {
			setBusy(false);
			setFailure(null);
		}
	}, [presence.mounted]);

	// Esc closes (claimed — a dialog Esc must not also abort a turn).
	useEffect(() => {
		if (!nodes || nodes.length === 0) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Claim Esc at the document level: a window-level stopPropagation cannot stop
				// the earlier-registered global window listener.
				e.preventDefault();
				e.stopPropagation();
				onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [nodes, onClose]);

	// Sequential full deaths — never parallel (the store's revision
	// counter and the sweep must observe them in order). A failure STOPS
	// the run: what died, died; the failure line names why the rest
	// still stands (extraction_running especially must not be plowed
	// through). onDeleted fires with everything that actually died.
	const run = async () => {
		if (!nodes || nodes.length === 0 || busy) return;
		setBusy(true);
		setFailure(null);
		const dead: string[] = [];
		let revision = 0;
		try {
			for (const n of nodes) {
				const res = await fetch(`/api/graph/nodes/${encodeURIComponent(n.id)}${classQuery(activeClassId)}`, { method: "DELETE" });
				const body = (await res.json()) as {
					error?: string;
					graphRevision?: number;
				};
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

	if (!presence.mounted || !shown || shown.length === 0) return null;

	return createPortal(
		<div
			data-state={presence.state}
			inert={!isOpen}
			className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-background/80"
			{...backdropDismiss}
		>
			<DeleteNodeBody
				state={presence.state}
				nodes={shown}
				busy={busy}
				failure={failure}
				onClose={onClose}
				onRun={() => void run()}
			/>
		</div>,
		document.body,
	);
}

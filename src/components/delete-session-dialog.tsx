import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";
import { usePresence } from "@/components/presence";
import type { ChatDeleteMode, ChatListItem } from "@/core";

/** The graph-traces checkbox copy: the graph-touching consequence says
 *  so, shared-topic survival included. Exported pure for render pins: the
 *  copy is design, not implementation. */
export const TRACES_COPY = {
	testid: "delete-traces",
	checkbox: "delete-traces-checkbox",
	title: "Also remove its graph traces",
	body: "This lesson’s topics, links, and events leave the graph too. Topics other lessons or imported notes also cover survive; topics only this lesson created are removed entirely.",
};

/**
 * Lesson deletion: the destructive-confirmation surface, portaled z-50
 * like the setup dialog, in the node dialog's shape (the two must read as
 * one design):
 *
 *   - red title "Delete lesson?" in the abort-turn look (text-sm
 *     font-semibold JetBrains Mono via the UI default), the lesson name
 *     below it in JetBrains Mono at text-sm, no code-block chrome;
 *   - ONE unchecked-by-default checkbox "Also remove its graph traces"
 *     (unchecked = preserve-graph: the session record, its jobs, and its
 *     extraction bookkeeping die; the graph keeps every contribution.
 *     checked = delete-nodes: the session's ledger traces go too);
 *   - a bottom row Cancel + destructive-red Delete, exactly the node
 *     dialog's pair.
 *
 * Retryable failures render honestly with a Try-again: 409 turn_in_flight /
 * jobs_running ("wait for running work") and 503 extraction_winding_down
 * ("in a moment") both clear on their own — the server's error line is
 * already written for the user; we show it verbatim. Try-again is just
 * Delete pressed again — the mode re-derives from the checkbox.
 */
export function DeleteSessionDialog({
	chat,
	onClose,
	onDeleted,
}: {
	/** The session up for deletion; null = closed. */
	chat: Pick<ChatListItem, "id" | "title"> | null;
	onClose: () => void;
	/** Success path — the sidebar owns navigation + list patching. */
	onDeleted: (id: string, mode: ChatDeleteMode, graphRevision: number) => void;
}) {
	// Exit motion: the last session stays on
	// screen while the dialog fades out.
	const presence = usePresence(chat !== null);
	const [lastChat, setLastChat] = useState(chat);
	if (chat !== null && chat !== lastChat) setLastChat(chat);
	const shown = chat ?? lastChat;
	const [traces, setTraces] = useState(false);
	const [busy, setBusy] = useState(false);
	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onClose();
	});
	// Retry IS pressing Delete again: the mode always derives from the
	// checkbox's current state (a toggle between failure and retry is a
	// change of intent, honored as such — the checkbox is disabled while
	// busy, so no mid-flight switches).
	const [failure, setFailure] = useState<{ code: string; error: string } | null>(null);

	// Fresh state per session: closing resets (once the exit has played, so
	// the fading dialog keeps its look), opening a new chat starts clean.
	useEffect(() => {
		if (!presence.mounted) {
			setTraces(false);
			setBusy(false);
			setFailure(null);
		}
	}, [presence.mounted]);

	// Esc closes (claimed — a menu/dialog Esc must not also abort a turn).
	useEffect(() => {
		if (!chat) return;
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
	}, [chat, onClose]);

	const run = async () => {
		if (!chat || busy) return;
		const mode: ChatDeleteMode = traces ? "delete-nodes" : "preserve-graph";
		setBusy(true);
		setFailure(null);
		try {
			const res = await fetch(`/api/chats/${chat.id}?mode=${mode}`, { method: "DELETE" });
			const body = (await res.json()) as {
				ok?: boolean;
				error?: string;
				code?: string;
				graphRevision?: number;
			};
			if (!res.ok) {
				// 409 (turn/jobs running) and 503 (extraction winding down) are
				// both retryable — keep the dialog open, show the server's line.
				setFailure({ code: body.code ?? "error", error: body.error ?? `Delete failed (${res.status})` });
				setBusy(false);
				return;
			}
			onDeleted(chat.id, mode, body.graphRevision ?? 0);
		} catch {
			setFailure({ code: "network", error: "Delete failed: network error. Try again." });
			setBusy(false);
		}
	};

	if (!presence.mounted || !shown) return null;

	return createPortal(
		<div
			data-state={presence.state}
			inert={chat === null}
			className="lh-fade fixed inset-0 z-50 flex items-center justify-center bg-background/80"
			{...backdropDismiss}
		>
			<DeleteSessionBody
				state={presence.state}
				chat={shown}
				traces={traces}
				busy={busy}
				failure={failure}
				onTraces={(next) => setTraces(next)}
				onClose={onClose}
				onRun={() => void run()}
			/>
		</div>,
		document.body,
	);
}

/** The dialog's pure body — exported for SSR pins (the settings-dialog /
 *  node-dialog body pattern). The wrapper owns state + effects + portal. */
export function DeleteSessionBody({
	chat,
	traces,
	busy,
	failure,
	onTraces,
	onClose,
	onRun,
	state = "open",
}: {
	chat: Pick<ChatListItem, "id" | "title">;
	/** The graph-traces checkbox — unchecked by default (preserve-graph). */
	traces: boolean;
	busy: boolean;
	failure: { code: string; error: string } | null;
	onTraces: (next: boolean) => void;
	onClose: () => void;
	onRun: () => void;
	/** "closed" while the exit plays. */
	state?: "open" | "closed";
}) {
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Delete lesson"
			data-testid="delete-session-dialog"
			data-state={state}
			onClick={(e) => e.stopPropagation()}
			className="lh-dialog w-[32rem] max-w-[calc(100vw-2rem)] border bg-card p-5 shadow-xl"
		>
			<h2 className="text-sm font-semibold text-destructive">Delete lesson?</h2>
			{/* The lesson name in JetBrains Mono with no code-block chrome:
			    the font already says code. Same shape as the node dialog. */}
			<div className="mt-1.5">
				<code data-testid="session-name-code" className="font-mono text-sm text-foreground">
					{chat.title}
				</code>
			</div>
			<p className="mt-2 text-sm text-muted-foreground">
				This permanently removes the lesson: its messages, background jobs and graph-building history. Everything
				it added to the graph stays unless you check below. This cannot be undone.
			</p>
			<label
				data-testid={TRACES_COPY.testid}
				className="mt-4 flex cursor-pointer items-start gap-2.5 border border-border/60 px-4 py-3"
			>
				<input
					type="checkbox"
					data-testid={TRACES_COPY.checkbox}
					checked={traces}
					onChange={(e) => onTraces(e.target.checked)}
					disabled={busy}
					className="mt-0.5 size-4 shrink-0 accent-primary"
				/>
				<span className="min-w-0">
					<span className="block text-sm text-foreground">{TRACES_COPY.title}</span>
					<span className="mt-1 block text-xs text-muted-foreground">{TRACES_COPY.body}</span>
				</span>
			</label>
			{failure && (
				<div
					role="alert"
					data-testid="delete-failure"
					className="mt-3 border border-border/60 px-3 py-2 text-xs"
				>
					<span className="text-foreground">{failure.error}</span>
					<button
						type="button"
						data-testid="delete-retry"
						onClick={onRun}
						disabled={busy}
						className="lh-press ml-3 text-xs text-foreground underline-offset-2 hover:underline disabled:opacity-40"
					>
						Try again
					</button>
				</div>
			)}
			{/* The node dialog's exact bottom row: quiet Cancel, destructive
			    red Delete (border + text, fill on hover — the app's
			    established destructive pair). */}
			<div className="mt-4 flex justify-end gap-2">
				<button
					type="button"
					data-testid="delete-cancel"
					onClick={onClose}
					disabled={busy}
					className="lh-press px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
				>
					Cancel
				</button>
				<button
					type="button"
					data-testid="delete-confirm"
					onClick={onRun}
					disabled={busy}
					className="lh-press border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/20 disabled:opacity-40"
				>
					{busy ? "Deleting…" : "Delete"}
				</button>
			</div>
		</div>
	);
}
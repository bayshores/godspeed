import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { forgetLessonDraft } from "@/frontend/components/lesson/use-lesson-drafts";
import { CheckRow } from "@/frontend/components/ui/check-row";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import type { ChatDeleteMode, ChatListItem } from "@/shared/core";

/** What "Also remove its graph traces" does, in the learner's words. */
export const TRACES_COPY = {
	checkbox: "delete-traces-checkbox",
	title: "Also remove its graph traces",
	body: "This lesson’s topics, links, and events leave the graph too. Topics other lessons or imported notes also cover survive; topics only this lesson created are removed entirely.",
};

type Lesson = Pick<ChatListItem, "id" | "title">;

/**
 * "Delete lesson?": the lesson's name, what goes, and one unticked box,
 * "Also remove its graph traces" (unticked keeps everything the lesson
 * added to the graph).
 *
 * A delete the server refuses for now (a reply or a job is still running)
 * shows the server's line with "Try again", which is Delete pressed again.
 */
export function DeleteLessonDialog({
	chat,
	onClose,
	onDeleted,
}: {
	/** The lesson up for deletion; null = closed. */
	chat: Lesson | null;
	onClose: () => void;
	onDeleted: (id: string, mode: ChatDeleteMode, graphRevision: number) => void;
}) {
	const { mounted, state, shown } = useLastWhileClosing(chat);
	const [traces, setTraces] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);

	// Each open starts clean, once the exit has played.
	useEffect(() => {
		if (!mounted) {
			setTraces(false);
			setBusy(false);
			setFailure(null);
		}
	}, [mounted]);

	const run = async () => {
		if (!chat || busy) return;
		const mode: ChatDeleteMode = traces ? "delete-nodes" : "preserve-graph";
		setBusy(true);
		setFailure(null);
		try {
			const res = await fetch(`/api/chats/${chat.id}?mode=${mode}`, { method: "DELETE" });
			const body = (await res.json()) as { error?: string; graphRevision?: number };
			if (!res.ok) {
				setFailure(body.error ?? `Delete failed (${res.status})`);
				setBusy(false);
				return;
			}
			forgetLessonDraft(chat.id);
			onDeleted(chat.id, mode, body.graphRevision ?? 0);
		} catch {
			setFailure("Delete failed: network error. Try again.");
			setBusy(false);
		}
	};

	if (!mounted || !shown) return null;
	return createPortal(
		<DeleteLessonBody
			state={state}
			chat={shown}
			traces={traces}
			busy={busy}
			failure={failure}
			onTraces={setTraces}
			onClose={() => {
				if (!busy) onClose();
			}}
			onRun={() => void run()}
		/>,
		document.body,
	);
}

/** The dialog itself, without its state (the render tests draw it). */
export function DeleteLessonBody({
	chat,
	traces,
	busy,
	failure,
	onTraces,
	onClose,
	onRun,
	state = "open",
}: {
	chat: Lesson;
	traces: boolean;
	busy: boolean;
	/** The server's line for a delete that didn't go through. */
	failure: string | null;
	onTraces: (next: boolean) => void;
	onClose: () => void;
	onRun: () => void;
	/** "closed" while the exit plays. */
	state?: "open" | "closed";
}) {
	return (
		<DialogSheet
			title="Delete lesson?"
			state={state}
			testid="delete-lesson-dialog"
			busy={busy}
			onClose={onClose}
			foot={
				<>
					<span className="flex-1" />
					<button type="button" data-testid="delete-cancel" onClick={onClose} disabled={busy} className="lh-btn text-[15px]">
						Cancel
					</button>
					<button type="button" data-testid="delete-confirm" onClick={onRun} disabled={busy} className="lh-btn lh-btn-danger text-[15px]">
						{busy ? "Deleting…" : "Delete"}
					</button>
				</>
			}
		>
			<p data-testid="delete-lesson-name" title={chat.title} className="truncate text-lg text-ink">
				{chat.title}
			</p>
			<p className="text-lg text-ink">
				This permanently removes the lesson: its messages, background jobs and graph-building history. Everything it added to the graph stays unless you check below. This cannot be undone.
			</p>
			<CheckRow testid={TRACES_COPY.checkbox} label={TRACES_COPY.title} checked={traces} disabled={busy} onToggle={() => onTraces(!traces)} />
			<p className="text-[15px] text-ink-2">{TRACES_COPY.body}</p>
			{failure && (
				<div role="alert" data-testid="delete-failure" className="flex flex-wrap items-center gap-2.5">
					<span className="min-w-0 flex-1 basis-[200px] text-[15px] text-ans-wrong">{failure}</span>
					<button type="button" data-testid="delete-retry" onClick={onRun} disabled={busy} className="lh-btn text-[15px]">
						Try again
					</button>
				</div>
			)}
		</DialogSheet>
	);
}

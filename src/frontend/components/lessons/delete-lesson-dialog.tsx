import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { forgetLessonDraft } from "@/frontend/components/lesson/use-lesson-drafts";
import { CheckRow } from "@/frontend/components/ui/check-row";
import { DeleteFoot, FailureRow } from "@/frontend/components/ui/delete-dialog-parts";
import { DialogSheet, useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import type { ChatDeleteMode, ChatListItem } from "@/shared/core";
import { send, serverError } from "@/frontend/lib/api";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";

type Lesson = Pick<ChatListItem, "id" | "title">;

/**
 * "Delete lesson?": the lesson's name, one unticked box, "Also remove what it
 * added to the graph" (unticked keeps everything the lesson added), and
 * the line that a delete cannot be undone.
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
	onDeleted: (id: string) => void;
}) {
	const { mounted, state, shown } = useLastWhileClosing(chat);
	const [traces, setTraces] = useState(false);
	// It stays busy while it closes after the delete.
	const { busy, error: failure, run: guard, reset } = useGuardedAction({ stayBusy: true });

	// Each open starts clean, once the exit has played.
	useEffect(() => {
		if (!mounted) {
			setTraces(false);
			reset();
		}
	}, [mounted, reset]);

	const run = async () => {
		if (!chat) return;
		const mode: ChatDeleteMode = traces ? "delete-nodes" : "preserve-graph";
		await guard(async () => {
			const { error, body, status } = await send(`/api/chats/${chat.id}?mode=${mode}`, { method: "DELETE" });
			if (error) return status === 0 ? "Delete failed: network error. Try again." : (serverError(body) ?? `Delete failed (${status})`);
			forgetLessonDraft(chat.id);
			onDeleted(chat.id);
			return null;
		});
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
			foot={<DeleteFoot cancelTestid="delete-cancel" confirmTestid="delete-confirm" busy={busy} onClose={onClose} onRun={onRun} />}
		>
			<p data-testid="delete-lesson-name" title={chat.title} className="truncate text-lg text-ink">
				{chat.title}
			</p>
			<CheckRow testid="delete-traces-checkbox" label="Also remove what it added to the graph" checked={traces} disabled={busy} onToggle={() => onTraces(!traces)} />
			<p className="text-lg text-ink">This cannot be undone.</p>
			{failure && <FailureRow testid="delete-failure" retryTestid="delete-retry" failure={failure} busy={busy} onRun={onRun} />}
		</DialogSheet>
	);
}

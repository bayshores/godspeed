import { useMemo, useRef } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import type { LessonWork, LhViewMessage } from "@/shared/core";
import { deskCalls, deskHead, deskMark, wroteSince } from "./wait-model";

/** The desk while it is up: its sentence, the work it shows, the calls its steps stand for, and
 *  whether the teacher's words have come (its sentence then folds away, also while it fades out). */
interface OpenDesk {
	head: string | null;
	work: LessonWork;
	calls: ReadonlySet<string>;
	writing: boolean;
}

/**
 * The desk of a chat's running turn, for the lesson text and the teacher panel's chat alike. It is
 * up for the whole turn: its sentence and steps stay while the teacher's words come, a step after
 * the words adds its row, and once the reply is finished the desk fades out (Activity keeps the
 * steps).
 */
export function useDesk(messages: readonly LhViewMessage[], busy: boolean, work: LessonWork, name: string) {
	// The lesson as it stood when the turn began; opened while a turn runs, as it stood at the learner's last line.
	const start = useRef<ReturnType<typeof deskMark> | null>(null);
	if (!busy) start.current = deskMark(messages);
	else start.current ??= deskMark(messages.slice(0, messages.findLastIndex((m) => m.role === "user") + 1));
	const head = deskHead(name, work);
	const wrote = busy && wroteSince(messages, start.current);
	const open = useMemo((): OpenDesk | null => (busy ? { head, work, calls: deskCalls(work), writing: wrote } : null), [busy, head, work, wrote]);
	const desk = useLastWhileClosing(open);
	const closing = desk.mounted && desk.state === "closed" && !prefersReducedMotion();
	return {
		/** The teacher has written words in this turn. */
		wrote,
		/** The desk to draw, also while it fades out; null while none is up. */
		desk: open ?? (closing ? desk.shown : null),
		closing,
	};
}

import { useMemo } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { useLastWhileClosing } from "@/frontend/components/ui/dialog-sheet";
import type { LessonWork, LhViewMessage } from "@/shared/core";
import { useReplyHold } from "./use-reply-hold";
import { useTeacherWriting } from "./use-teacher-writing";
import { deskCalls, deskHead, deskMark, heldBack, type DeskMark } from "./wait-model";

/** The desk while it is up: its sentence, the work it shows, the calls its steps stand for and
 *  where the chat stood when it opened. */
interface OpenDesk {
	head: string | null;
	work: LessonWork;
	calls: ReadonlySet<string>;
	mark: DeskMark;
}

/**
 * The desk of a chat's running turn, for the lesson text and the teacher panel's chat alike. While
 * the teacher works the desk is up. When it writes (useTeacherWriting), its words wait under the
 * desk a moment for a turn that ends at once (useReplyHold), then the desk fades out and the words
 * are held back until it has gone (`shown`), so the two never stack and the words take the desk's
 * place in one step. A step after the words brings the desk back under them.
 */
export function useDesk(messages: readonly LhViewMessage[], busy: boolean, work: LessonWork, name: string) {
	const { wrote, writing } = useTeacherWriting(messages, busy, work);
	// Its words wait a moment under the desk for a turn that ends at once.
	const held = useReplyHold(busy && writing, deskMark(messages));
	const head = deskHead(name, work);
	const open = useMemo((): OpenDesk | null => (busy && (!writing || held) ? { head, work, calls: deskCalls(work), mark: held ?? deskMark(messages) } : null), [busy, writing, held, head, work, messages]);
	const desk = useLastWhileClosing(open);
	const closing = desk.mounted && desk.state === "closed" && !prefersReducedMotion();
	const mark = held ?? (closing && desk.shown ? desk.shown.mark : null);
	return {
		/** The teacher has written words in this turn. */
		wrote,
		/** The desk to draw, also while it fades out; null while none is up. */
		desk: open ?? (closing ? desk.shown : null),
		closing,
		/** The messages to draw: as they stood when the desk opened while its words wait. */
		shown: mark ? heldBack(messages, mark) : messages,
	};
}

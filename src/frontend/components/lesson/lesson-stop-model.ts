/**
 * A lesson's stop: what Keep going leads to when no opener is stored, whether
 * the turn running at it can be stopped, and the card that lights when he
 * comes back to it. Pure.
 */
import { isQuestionTool, lessonStop, PRACTICE_CONCLUDE_TOOL, shownOpeners, type LhMessage } from "@/shared/core";
import { answerAnchorSelector, toolCardSelector } from "./card-anchors";

/** Keep going was pressed and the turn ended with no opener for its stop,
 *  and he has not sent anything since: the window owes the go-ahead. */
export function keepGoingOwesNext(messages: readonly LhMessage[]): boolean {
	const stop = lessonStop(messages, null);
	if (!stop?.keptGoing) return false;
	const resultAt = (callId: string) => messages.findIndex((m) => m.role === "toolResult" && m.toolCallId === callId);
	const stopAt = resultAt(stop.stopOf);
	if ([...shownOpeners(messages).keys()].some((id) => resultAt(id) >= stopAt)) return false;
	// A Keep going written mid-turn sits before that turn's messages, so
	// "since" is read from the clock, not the position. With no marker the
	// teacher went on past the stop and nothing is owed.
	const keptTimes = messages.flatMap((m) => (m.role === "custom" && m.customType === "keep-going" && (m.details as { stopOf?: unknown } | null | undefined)?.stopOf === stop.stopOf ? [m.timestamp] : []));
	if (keptTimes.length === 0) return false;
	const keptAt = Math.min(...keptTimes);
	return !messages.some((m) => m.timestamp >= keptAt && (m.role === "user" || (m.role === "custom" && m.customType === "practice-next")));
}

/** Whether a turn running at a stop is the teacher reading ahead from it, which is not stopped:
 *  he has sent nothing since the stop. A question he asks after it runs a turn he can stop. */
export function readsAhead(messages: readonly LhMessage[], stopOf: string): boolean {
	const at = messages.findIndex((m) => m.role === "toolResult" && m.toolCallId === stopOf);
	return !messages.slice(at + 1).some((m) => m.role === "user");
}

/** The card that lights when he comes back to a stop: the Concluded card
 *  of a conclude stop, else the answered question right before the
 *  topic_done that carries it (a right quiz ended that topic). */
export function stopLightSelector(messages: readonly LhMessage[], stopOf: string): string | null {
	const at = messages.findIndex((m) => m.role === "toolResult" && m.toolCallId === stopOf);
	if (at < 0) return null;
	const stopResult = messages[at]!;
	if (stopResult.role === "toolResult" && stopResult.toolName === PRACTICE_CONCLUDE_TOOL) return toolCardSelector(stopOf);
	const answered = messages.slice(0, at).findLast((m) => m.role === "toolResult" && isQuestionTool(m.toolName));
	return answered?.role === "toolResult" ? answerAnchorSelector(answered.toolCallId) : null;
}

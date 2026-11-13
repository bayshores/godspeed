/**
 * The stop card in Your turn: its words and buttons for the lesson's stop,
 * and what Keep going leads to when no opener is stored. Pure.
 */
import { isQuestionTool, lessonStop, PRACTICE_CONCLUDE_TOOL, shownOpeners, type LessonStop, type LhMessage } from "@/shared/core";
import { answerAnchorSelector, toolCardSelector } from "./step-context";

/** From this many active minutes on, Stop here is the dark button. */
const STOP_HERE_MINUTES = 25;

export type StopAction = "keep-going" | "stop-here" | "done-for-today";

export interface StopCardView {
	/** Line 1. */
	lead: string;
	/** Line 2; null leaves it out. */
	next: string | null;
	buttons: Array<{ action: StopAction; label: string; dark: boolean }>;
}

/** The card for a stop he has not kept going from. */
export function stopCard(stop: LessonStop): StopCardView {
	if (stop.kind === "end") {
		return { lead: "That finishes this topic.", next: "Nothing more is planned today.", buttons: [{ action: "done-for-today", label: "Done for today", dark: true }] };
	}
	const long = stop.activeMinutes >= STOP_HERE_MINUTES;
	return {
		lead: stop.kind === "topic" ? "That finishes this topic." : "That finishes this problem.",
		next: stop.next === null ? null : stop.kind === "topic" ? `${stop.next} is next.` : `Next is ${stop.next}.`,
		buttons: [
			{ action: "keep-going", label: "Keep going", dark: !long },
			{ action: "stop-here", label: "Stop here", dark: long },
		],
	};
}

/** Keep going was pressed and the turn ended with no opener for its stop,
 *  and he has not sent anything since: the window owes the go-ahead. */
export function keepGoingOwesNext(messages: readonly LhMessage[]): boolean {
	const stop = lessonStop(messages, null);
	if (!stop?.keptGoing) return false;
	const resultAt = (callId: string) => messages.findIndex((m) => m.role === "toolResult" && m.toolCallId === callId);
	const stopAt = resultAt(stop.stopOf);
	if ([...shownOpeners(messages).keys()].some((id) => resultAt(id) >= stopAt)) return false;
	// A Keep going written mid-turn sits before that turn's messages, so
	// "since" is read from the clock, not the position.
	const keptAt = Math.min(...messages.flatMap((m) => (m.role === "custom" && m.customType === "keep-going" && (m.details as { stopOf?: unknown }).stopOf === stop.stopOf ? [m.timestamp] : [])));
	return !messages.some((m) => m.timestamp >= keptAt && (m.role === "user" || (m.role === "custom" && m.customType === "practice-next")));
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

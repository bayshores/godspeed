import { useRef } from "react";
import type { LessonWork, LhViewMessage } from "@/shared/core";
import { deskMark, wordsSince } from "./wait-model";

/**
 * While a turn runs: whether the teacher has written words in it (`wrote`), and whether it is
 * writing now (`writing`), so its words take the desk's place as they come. It writes until it
 * does something else: a step after its words (one of godspeed's tools, or one of its own) or a
 * question for the learner to allow brings the desk back, and new words send it away again.
 */
export function useTeacherWriting(messages: readonly LhViewMessage[], busy: boolean, work: LessonWork): { wrote: boolean; writing: boolean } {
	// The lesson as it stood when the turn began.
	const start = useRef(deskMark(messages));
	if (!busy) start.current = deskMark(messages);
	const words = busy ? wordsSince(messages, start.current) : 0;
	// The turn's newest question to allow stays its last deed once answered.
	const asked = useRef<string | null>(null);
	if (!busy) asked.current = null;
	asked.current = work.approvals.at(-1)?.id ?? asked.current;
	const did = `${work.steps.at(-1)?.id ?? ""} ${asked.current ?? ""}`;
	// What the teacher had last done when its words last grew.
	const atWords = useRef({ words, did });
	if (words !== atWords.current.words) atWords.current = { words, did };
	return { wrote: words > 0, writing: words > 0 && atWords.current.did === did && work.approvals.length === 0 };
}

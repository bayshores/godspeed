import { useRef, type Ref } from "react";
import { paleSpaceColor } from "@/frontend/components/space-color";
import { useSpaceColor } from "@/frontend/components/space-context";
import { turnShown, type TurnNext } from "./turn-next-model";
import { YourTurn, type YourTurnProps } from "./your-turn";

/**
 * The learner's turn as the lesson gives it: what the task shows with
 * nothing to answer (the next state, or its last line while the teacher
 * writes), when the task's contents swap (`swapKey`; a problem that closes
 * and is kept keeps its place, with no swap), and the space's pale color.
 */
export function TurnSheet({
	spaceId,
	next,
	sheetRef,
	...turn
}: Omit<YourTurnProps, "shown" | "swapKey" | "sheetRef" | "pale"> & {
	spaceId: string | undefined;
	/** The lesson page's glide (useSheetGlide). */
	sheetRef?: Ref<HTMLElement>;
	/** The next state; null while the teacher writes with no stop to go on from. */
	next: TurnNext | null;
}) {
	const { pending, problem, kept } = turn;
	const color = useSpaceColor(spaceId);

	// The last next state's line, for the wait after anything but an answer; after a question or a problem, none.
	const lastLineRef = useRef<string | null>(null);
	if (pending || problem) lastLineRef.current = null;
	else if (next) lastLineRef.current = next.line;
	const shown = turnShown({ next, lastLine: lastLineRef.current });
	const swapKey = pending
		? `ask:${pending.toolCallId}`
		: problem
			? `problem:${problem.toolCallId}`
			: kept
				? `${kept.kind === "problem" ? "problem" : "kept"}:${kept.toolCallId}`
				: `next:${shown.next.notes?.ask?.topicId ?? ""}:${shown.next.line ?? ""}:${shown.next.line && shown.dim ? "dim" : ""}:${shown.next.key?.label ?? ""}`;

	return <YourTurn {...turn} sheetRef={sheetRef} pale={color ? paleSpaceColor(color) : "var(--color-tone)"} shown={shown} swapKey={swapKey} />;
}

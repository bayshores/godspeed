import { useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion, usePresence } from "@/frontend/components/presence";
import { paleSpaceColor } from "@/frontend/components/space-color";
import { useSpaceColor } from "@/frontend/components/space-context";
import { Pane } from "@/frontend/components/ui/pane";
import { cn } from "@/frontend/lib/utils";
import { turnShown, type AnsweredQuestion, type TurnNext } from "./turn-next-model";
import { YourTurn, type YourTurnProps } from "./your-turn";

/**
 * THE TURN SHEET, beside the lesson text's sheet or under it: "Your turn",
 * there for the whole lesson once it has started. Only its contents change,
 * inside the sheet that stays still. The teacher's status, terminal,
 * Activity and Follow live in the teacher's panel, as on every page.
 */
export function TurnSheet({
	spaceId,
	next,
	answered,
	...turn
}: Omit<YourTurnProps, "shown"> & {
	spaceId: string | undefined;
	/** The next state; null while the teacher writes with no stop to go on from. */
	next: TurnNext | null;
	/** The question answered or skipped last, when that is the last thing the learner did. */
	answered: AnsweredQuestion | null;
}) {
	const { pending, problem } = turn;
	const color = useSpaceColor(spaceId);

	// The last next state's line, for the wait after anything but an answer; after a question or a problem, none.
	const lastLineRef = useRef<string | null>(null);
	if (pending || problem) lastLineRef.current = null;
	else if (next) lastLineRef.current = next.line;
	const shown = turnShown({ next, answered, lastLine: lastLineRef.current });
	const swapKey = pending
		? `ask:${pending.toolCallId}`
		: problem
			? `problem:${problem.toolCallId}`
			: shown.kind === "answered"
				? `answered:${shown.answered.toolCallId}`
				: `next:${shown.next.line ?? ""}:${shown.next.line && shown.dim ? "dim" : ""}:${shown.next.key?.label ?? ""}`;

	return (
		<aside
			data-testid="turn-sheet"
			aria-label="Your turn"
			className="flex min-h-0 min-w-0 flex-1 flex-col"
			style={{ "--lh-pale": color ? paleSpaceColor(color) : "var(--color-tone)" } as React.CSSProperties}
		>
			<Pane className="flex min-h-0 flex-1 flex-col">
				<TurnSwap swapKey={swapKey}>
					<YourTurn {...turn} shown={shown} />
				</TurnSwap>
			</Pane>
		</aside>
	);
}

/**
 * "Your turn"'s contents, swapped when `swapKey` changes: the old contents
 * fade out (--lh-dur-fast, held as they were by presence) and the new rise
 * in. The contents the sheet opened with are just there. With reduced motion
 * they swap at once.
 */
function TurnSwap({ swapKey, children }: { swapKey: string; children: ReactNode }) {
	const [settled, setSettled] = useState(swapKey);
	const [swapped, setSwapped] = useState(false);
	const same = swapKey === settled;
	const presence = usePresence(same);
	const heldRef = useRef(children);
	if (same) heldRef.current = children;
	const leaving = !same && presence.mounted && !prefersReducedMotion();
	if (!same && !leaving) {
		setSettled(swapKey);
		setSwapped(true);
	}
	return (
		<div
			key={leaving ? settled : swapKey}
			data-testid="turn-swap"
			data-state={leaving ? "closed" : "open"}
			inert={leaving}
			className={cn("flex min-h-0 flex-1 flex-col", leaving ? "lh-fade" : swapped && "lh-rise")}
		>
			{leaving ? heldRef.current : children}
		</div>
	);
}

import { useRef, type Ref } from "react";
import { paleSpaceColor } from "@/frontend/components/space-color";
import { useSpaceColor } from "@/frontend/components/space-context";
import { Pane } from "@/frontend/components/ui/pane";
import { turnShown, type TurnNext } from "./turn-next-model";
import { YourTurn, type YourTurnProps } from "./your-turn";

/**
 * THE TURN SHEET, beside the lesson text's sheet or under it: "Your turn",
 * there for the whole lesson once it has started. Only what waits in it
 * changes (`swapKey`), inside the sheet that stays still. A problem that
 * closes and is kept (`kept`) keeps its place, with no swap. The teacher's
 * status, terminal, Activity and Follow live in the teacher's panel, as on
 * every page.
 */
export function TurnSheet({
	spaceId,
	next,
	sheetRef,
	...turn
}: Omit<YourTurnProps, "shown" | "swapKey"> & {
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
				: `next:${shown.next.line ?? ""}:${shown.next.line && shown.dim ? "dim" : ""}:${shown.next.key?.label ?? ""}`;

	return (
		<aside
			data-testid="turn-sheet"
			aria-label="Your turn"
			className="flex min-h-0 min-w-0 flex-1 flex-col"
			style={{ "--lh-pale": color ? paleSpaceColor(color) : "var(--color-tone)" } as React.CSSProperties}
		>
			{/* Its size starts from what it holds (flex-auto), so the sheet can glide to a new height. */}
			<Pane ref={sheetRef} className="flex min-h-0 flex-auto flex-col">
				<YourTurn {...turn} shown={shown} swapKey={swapKey} />
			</Pane>
		</aside>
	);
}

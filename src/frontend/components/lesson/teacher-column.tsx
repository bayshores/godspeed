import { useRef, useState } from "react";
import { paleSpaceColor } from "@/frontend/components/space-color";
import { useSpaceColor } from "@/frontend/components/space-context";
import { Pane } from "@/frontend/components/ui/pane";
import { ResizeHandle } from "@/frontend/components/ui/resize-handle";
import { YourTurn, type YourTurnProps } from "./your-turn";

/** The column's width beside the reading sheet (drag its border line). */
export const COLUMN_WIDTH = { initial: 480, min: 340, max: 720 };

/** Whether "Your turn" shows: only while something waits for the learner. */
export function yourTurnShown(s: { pending: boolean; problem: boolean; stop: boolean; stuck: boolean; error: boolean; reviewRefused: boolean }): boolean {
	return Object.values(s).some(Boolean);
}

/**
 * THE TEACHER COLUMN, the lesson's right side (below the text in a narrow
 * window): "Your turn", while something waits for the learner. The
 * teacher's status, terminal, Activity and Follow live in the top bar's
 * pill, as on every page.
 */
export function TeacherColumn({
	spaceId,
	width,
	onWidth,
	requiresReveal,
	onReveal,
	...turn
}: YourTurnProps & {
	spaceId: string | undefined;
	/** The saved width; the lesson's layout sizes the column from it. */
	width: number;
	onWidth: (width: number) => void;
	/** A teach-phase check: it waits behind "Check your understanding". */
	requiresReveal: boolean;
	/** The learner opens the check. */
	onReveal: () => void;
}) {
	const { pending } = turn;
	const color = useSpaceColor(spaceId);

	// The reveal: false until the learner opens the check. Reset during
	// render when a new question lands, and open at once only when it
	// follows another of the teacher's questions (the reading already
	// happened; a question from earlier fills the wait before it).
	const pendingId = pending?.toolCallId ?? null;
	const [revealed, setRevealed] = useState(false);
	const prevPendingIdRef = useRef(pendingId);
	const prevFromEarlierRef = useRef(false);
	if (pendingId !== prevPendingIdRef.current) {
		const wasQuestion = prevPendingIdRef.current !== null && !prevFromEarlierRef.current;
		prevPendingIdRef.current = pendingId;
		if (pendingId && requiresReveal) setRevealed(wasQuestion);
	}
	prevFromEarlierRef.current = pending?.appPosed?.kind === "review";

	return (
		<aside
			data-testid="teacher-column"
			aria-label="Your turn"
			className="lh-rise relative flex min-h-0 min-w-0 flex-col [grid-area:teacher]"
			style={{ "--lh-pale": color ? paleSpaceColor(color) : "var(--color-tone)" } as React.CSSProperties}
		>
			{/* Side by side only: stacked, the column is full width. */}
			<div className="lh-teacher-resize">
				<ResizeHandle paneKey="your-turn" width={width} bounds={COLUMN_WIDTH} onWidth={onWidth} label="Resize the teacher column" />
			</div>
			<Pane className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<YourTurn
					{...turn}
					revealPending={pending !== null && requiresReveal && !revealed}
					onReveal={() => {
						onReveal();
						setRevealed(true);
					}}
				/>
			</Pane>
		</aside>
	);
}

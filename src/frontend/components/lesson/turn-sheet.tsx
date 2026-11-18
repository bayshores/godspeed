import { useRef, useState } from "react";
import { paleSpaceColor } from "@/frontend/components/space-color";
import { useSpaceColor } from "@/frontend/components/space-context";
import { Pane } from "@/frontend/components/ui/pane";
import { YourTurn, type YourTurnProps } from "./your-turn";

/** Whether "Your turn" shows: only while something waits for the learner. */
export function yourTurnShown(s: { pending: boolean; problem: boolean; stop: boolean; stuck: boolean; error: boolean; reviewRefused: boolean }): boolean {
	return Object.values(s).some(Boolean);
}

/**
 * THE TURN SHEET, beside the lesson text's sheet or under it: "Your turn", while
 * something waits for the learner, as tall as what it holds. The teacher's
 * status, terminal, Activity and Follow live in the top bar's pill, as on
 * every page.
 */
export function TurnSheet({
	spaceId,
	requiresReveal,
	onReveal,
	...turn
}: YourTurnProps & {
	spaceId: string | undefined;
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
			data-testid="turn-sheet"
			aria-label="Your turn"
			className="min-w-0"
			style={{ "--lh-pale": color ? paleSpaceColor(color) : "var(--color-tone)" } as React.CSSProperties}
		>
			<Pane>
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

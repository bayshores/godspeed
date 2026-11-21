import { useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion, usePresence } from "@/frontend/components/presence";
import { cn } from "@/frontend/lib/utils";

/**
 * The part of "Your turn" that changes with what waits, swapped when
 * `swapKey` changes: the old contents fade out (--lh-dur-fast, held as they
 * were by presence) and the new rise in. The contents the sheet opened with
 * are just there. With reduced motion they swap at once. The box under it
 * stays still, so a line being typed keeps the keyboard. With nothing
 * to hold (the pinned "Your turn" while the teacher works) it takes no room,
 * and what comes next waits for no fade.
 */
export function TurnSwap({ swapKey, children }: { swapKey: string; children: ReactNode }) {
	const [settled, setSettled] = useState(swapKey);
	const [swapped, setSwapped] = useState(false);
	const same = swapKey === settled;
	const presence = usePresence(same);
	const heldRef = useRef(children);
	if (same) heldRef.current = children;
	const leaving = !same && presence.mounted && heldRef.current !== null && !prefersReducedMotion();
	if (!same && !leaving) {
		setSettled(swapKey);
		setSwapped(true);
	}
	const held = leaving ? heldRef.current : children;
	return (
		<div
			key={leaving ? settled : swapKey}
			data-testid="turn-swap"
			data-state={leaving ? "closed" : "open"}
			inert={leaving}
			className={cn("min-h-0 flex-1 flex-col gap-7", held === null ? "hidden" : "flex", leaving ? "lh-fade" : swapped && "lh-rise")}
		>
			{held}
		</div>
	);
}

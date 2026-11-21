import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/frontend/components/presence";
import type { DeskMark } from "./wait-model";

/** The longest a reply's words wait for their turn to end. */
const HOLD_MS = 400;

/**
 * A reply's words often arrive a moment before its turn ends, after a first part that leaves
 * again, and Stop would stand under them for that moment and then leave, moving the sheet three
 * times. While the reply is `early` (here, with the turn still running and the pencil up), this
 * gives the lesson's mark from before it, so the page shows the lesson as it stood (heldBack) and
 * the words arrive with the end of the turn, as one step. A turn that goes on shows them after
 * HOLD_MS. `mark` is the lesson's mark now.
 */
export function useReplyHold(early: boolean, mark: DeskMark): DeskMark | null {
	const before = useRef<DeskMark | null>(null);
	if (!early) before.current = mark;
	const [waited, setWaited] = useState(false);
	if (!early && waited) setWaited(false);
	useEffect(() => {
		if (!early) return;
		const timer = setTimeout(() => setWaited(true), HOLD_MS);
		return () => clearTimeout(timer);
	}, [early]);
	return early && !waited && !prefersReducedMotion() ? before.current : null;
}

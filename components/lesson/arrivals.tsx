import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/* ARRIVAL MOTION (motion wave, owner 2026-10-26): a message or card that
 * appears DURING the live session rises in once (.lh-rise). Whatever the
 * first render shows — a reopened lesson — never animates. Slots are keyed
 * by POSITION (message index, part index), not id: an optimistic message
 * that later swaps its local id for the server's keeps its slot, so the
 * remount never replays. Agent text and reasoning are left alone —
 * streaming is their motion. */
const ARRIVAL_WINDOW_MS = 400;

export type Arrive = (slot: string) => string | undefined;

export function useArrivals(): Arrive {
	const firstSeen = useRef(new Map<string, number | null>());
	const live = useRef(false);
	useEffect(() => {
		live.current = true;
	}, []);
	return useCallback((slot: string) => {
		const now = performance.now();
		let at = firstSeen.current.get(slot);
		if (at === undefined) {
			at = live.current ? now : null; // null: there at first render
			firstSeen.current.set(slot, at);
		}
		return at !== null && now - at < ARRIVAL_WINDOW_MS ? "lh-rise" : undefined;
	}, []);
}

/** A one-off row (the Thinking…/Compacting placeholders) that rises in
 *  when it mounts mid-session — decided once, at mount. */
export function ArrivalRow({
	live,
	as: Tag = "span",
	className,
	children,
}: {
	live: boolean;
	as?: "span" | "div";
	className?: string;
	children: React.ReactNode;
}) {
	const [rise] = useState(live);
	return <Tag className={cn(rise && "lh-rise", className)}>{children}</Tag>;
}

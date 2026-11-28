import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/frontend/lib/utils";

/* ARRIVAL MOTION: a message or card that
 * appears DURING the live session rises in once (.lh-rise). Whatever the
 * first render shows — a reopened lesson — never animates. Slots are keyed
 * by POSITION (message index, part index), not id: an optimistic message
 * that later swaps its local id for the server's keeps its slot, so the
 * remount never replays. The teacher's words are drawn as they are
 * written, so they need no arrival; reasoning is left alone. */
const ARRIVAL_WINDOW_MS = 400;

export type Arrive = (slot: string) => string | undefined;

/** `drawn`: false while what the slots belong to waits for its data, so what its first drawing
 *  holds stays at rest; a list of deadlines steps in a row that joins it later. */
export function useArrivals(drawn = true): Arrive {
	const firstSeen = useRef(new Map<string, number | null>());
	const live = useRef(false);
	useEffect(() => {
		if (drawn) live.current = true;
	}, [drawn]);
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

/**
 * True for a moment after `on` turned true while this was in sight: a moment (a verdict, a Done
 * stamp) plays for what just happened, and what was already so at the first drawing stays at rest.
 * `of` names what it is about, so another one shown in its place is at rest too.
 */
export function useTurnedOn(on: boolean, of = ""): boolean {
	const was = useRef<{ of: string; on: boolean; at: number | null } | null>(null);
	const read = useCallback((on: boolean, of: string) => {
		const now = performance.now();
		const before = was.current;
		const at = on && before?.of === of ? (before.on ? before.at : now) : null;
		was.current = { of, on, at };
		return at !== null && now - at < ARRIVAL_WINDOW_MS;
	}, []);
	return read(on, of);
}

/** A one-off row (the desk) that rises in when it mounts mid-session —
 *  decided once, at mount. */
export function ArrivalRow({ live, className, children }: { live: boolean; className?: string; children: React.ReactNode }) {
	const [rise] = useState(live);
	return <div className={cn(className, rise && "lh-rise")}>{children}</div>;
}

/**
 * The notices on screen, shared by the cards (notice-card.tsx), the strip
 * and its peek: each card adds itself and waits folded in the strip until
 * its count is asked for; an error first shows by itself for a while. The
 * time stands still while the pointer or keyboard focus is on the peek.
 */

import { useEffect, useId, useSyncExternalStore } from "react";
import { PRESENT_MS, noticeView, type Alone, type Notice, type NoticeKind } from "./notice-stack-model";

/** After the pointer leaves, a notice stays at least this long. */
const AFTER_HOLD_MS = 3_000;

interface NoticeState {
	/** The ids on screen, in the stack's order. */
	shown: string[];
	/** The ids of every notice mounted. */
	known: string[];
	/** How many wait folded on the strip, for its count. */
	waiting: number;
	/** The folded notices were asked for. */
	open: boolean;
	/** A notice shows. */
	up: boolean;
}

const EMPTY: NoticeState = {
	shown: [],
	known: [],
	waiting: 0,
	open: false,
	up: false,
};

let notices: Notice[] = [];
let open = false;
/** Which notices show by themselves; all, until a strip says otherwise. */
let alone: Alone = "all";
/** Since when the peek is held; null while it is not. */
let heldSince: number | null = null;
let state = EMPTY;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function update() {
	const now = heldSince ?? Date.now();
	const view = noticeView(notices, now, open, alone);
	const up = view.shown.length > 0;
	// A peek that closed under the pointer never says the pointer left.
	if (!up) heldSince = null;
	state = {
		shown: view.shown,
		known: notices.map((n) => n.id),
		waiting: view.waiting,
		open,
		up,
	};
	if (timer !== null) clearTimeout(timer);
	timer = null;
	const next = heldSince === null ? Math.min(...notices.filter((n) => n.foldAt > now).map((n) => n.foldAt)) : Infinity;
	if (Number.isFinite(next)) timer = setTimeout(update, next - now + 1);
	for (const notify of listeners) notify();
}

/** The folded notices show, or fold again. Folding folds every notice, one still showing by itself too. */
export function setNoticesOpen(next: boolean) {
	if (open === next && (next || !state.up)) return;
	open = next;
	if (!next) notices = notices.map((n) => (Number.isFinite(n.foldAt) ? { ...n, foldAt: 0 } : n));
	update();
}

/** The strip says which notices show by themselves where it stands. */
export function noticesAlone(next: Alone) {
	if (alone === next) return;
	alone = next;
	update();
}

/** The pointer or focus is on the peek (or left it). */
export function holdNotices(held: boolean) {
	if (held === (heldSince !== null)) return;
	if (held) {
		heldSince = Date.now();
	} else {
		const since = heldSince!;
		const now = Date.now();
		// The time stood still while held: what was left carries on, at most a full time and at least a few seconds. A timed notice has no fold.
		notices = notices.map((n) => (n.foldAt > since && Number.isFinite(n.foldAt) ? { ...n, foldAt: Math.max(Math.min(n.foldAt + (now - since), now + PRESENT_MS), now + AFTER_HOLD_MS) } : n));
		heldSince = null;
	}
	update();
}

function subscribe(notify: () => void) {
	listeners.add(notify);
	return () => {
		listeners.delete(notify);
	};
}

/** What shows and how many wait. */
export function useNotices(): NoticeState {
	return useSyncExternalStore(
		subscribe,
		() => state,
		() => EMPTY,
	);
}

/**
 * A notice card adds itself while mounted, and shows unless it waits
 * folded or behind others. A new title starts its time again.
 */
export function useNotice(title: string, kind: NoticeKind | null, timed: boolean): boolean {
	const id = useId();
	useEffect(() => {
		notices = [...notices.filter((n) => n.id !== id), { id, kind, foldAt: timed ? Infinity : Date.now() + PRESENT_MS }];
		update();
		return () => {
			notices = notices.filter((n) => n.id !== id);
			update();
		};
	}, [id, title, kind, timed]);
	const { known, shown } = useNotices();
	return !known.includes(id) || shown.includes(id);
}

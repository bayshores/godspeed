/**
 * The notices on screen, shared by the cards (notice-card.tsx), the pill
 * and its panel: each card adds itself, shows by itself for a while, then
 * folds into the pill until the pill's card is opened. The time stands
 * still while the pointer or focus is on the panel.
 */

import { useEffect, useId, useSyncExternalStore } from "react";
import { PRESENT_MS, noticeView, type Notice, type NoticeKind } from "./notice-stack-model";

/** After the pointer leaves, a notice stays at least this long. */
const AFTER_HOLD_MS = 3_000;

interface NoticeState {
	/** The ids on screen, in the stack's order. */
	shown: string[];
	/** The ids of every notice mounted. */
	known: string[];
	/** How many wait folded in the pill, for its count. */
	waiting: number;
	/** The pill's card is open. */
	open: boolean;
	/** The pill says this notice's title in its place: its id and the title. */
	said: { id: string; title: string } | null;
	/** The panel has something to show. */
	up: boolean;
}

const EMPTY: NoticeState = {
	shown: [],
	known: [],
	waiting: 0,
	open: false,
	said: null,
	up: false,
};

let notices: Notice[] = [];
let open = false;
/** How many pills are mounted; with none (the first steps) a notice keeps its title. */
let pills = 0;
/** Since when the panel is held; null while it is not. */
let heldSince: number | null = null;
let state = EMPTY;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function update() {
	const now = heldSince ?? Date.now();
	const view = noticeView(notices, now, open);
	const said = pills > 0 && !open && view.presenting ? { id: view.presenting.id, title: view.presenting.title } : null;
	const up = open || view.shown.some((id) => id !== said?.id || !notices.find((n) => n.id === id)?.bare);
	// A panel that closed under the pointer never says the pointer left.
	if (!up) heldSince = null;
	state = {
		shown: view.shown,
		known: notices.map((n) => n.id),
		waiting: view.waiting,
		open,
		said,
		up,
	};
	if (timer !== null) clearTimeout(timer);
	timer = null;
	const next = heldSince === null ? Math.min(...notices.filter((n) => n.foldAt > now).map((n) => n.foldAt)) : Infinity;
	if (Number.isFinite(next)) timer = setTimeout(update, next - now + 1);
	for (const notify of listeners) notify();
}

/** The pill's card opens or closes. Closing it folds every notice. */
export function setNoticesOpen(next: boolean) {
	if (open === next) return;
	open = next;
	if (!next) notices = notices.map((n) => (Number.isFinite(n.foldAt) ? { ...n, foldAt: 0 } : n));
	update();
}

/** The pointer or focus is on the panel (or left it). */
export function holdNotices(held: boolean) {
	if (held === (heldSince !== null)) return;
	if (held) {
		heldSince = Date.now();
	} else {
		const since = heldSince!;
		const until = Date.now() + AFTER_HOLD_MS;
		notices = notices.map((n) => (n.foldAt > since ? { ...n, foldAt: Math.max(n.foldAt, until) } : n));
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

/** What shows and what the pill says of it. */
export function useNotices(): NoticeState {
	return useSyncExternalStore(
		subscribe,
		() => state,
		() => EMPTY,
	);
}

/** A pill is on screen while its bar is mounted. */
export function usePillMounted() {
	useEffect(() => {
		pills += 1;
		update();
		return () => {
			pills -= 1;
			update();
		};
	}, []);
}

/**
 * A notice card adds itself while mounted. `shown`: false while it waits
 * folded or behind others. `said`: the pill says its title, so the card
 * leaves it out. A new title shows by itself again.
 */
export function useNotice(title: string, kind: NoticeKind | null, bare: boolean, timed: boolean): { shown: boolean; said: boolean } {
	const id = useId();
	useEffect(() => {
		notices = [...notices.filter((n) => n.id !== id), { id, title, kind, bare, foldAt: timed ? Infinity : Date.now() + PRESENT_MS }];
		update();
		return () => {
			notices = notices.filter((n) => n.id !== id);
			update();
		};
	}, [id, title, kind, bare, timed]);
	const { known, shown, said } = useNotices();
	return {
		shown: !known.includes(id) || shown.includes(id),
		said: said?.id === id,
	};
}

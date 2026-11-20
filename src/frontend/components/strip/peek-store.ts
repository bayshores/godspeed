/**
 * Whether the strip's peek is out because the learner asked for it: the
 * pointer rested on the strip, or the keyboard is on it. It stays out while
 * the pointer or the keyboard is on the strip or the peek, and a press on
 * the strip calls it off until the pointer has left the strip.
 */
import { useSyncExternalStore } from "react";

/** The pointer rests this long on the strip before the peek slides out, so a crossing shows none. */
export const REST_MS = 300;
/** The peek stays this long after the pointer left, the time to cross from the strip to a row. */
export const TUCK_MS = 250;

let out = false;
let onStrip = false;
let onPeek = false;
let keyboard = false;
/** The strip was pressed: no peek until the pointer has left it. */
let pressed = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function set(next: boolean) {
	if (timer !== null) clearTimeout(timer);
	timer = null;
	if (out === next) return;
	out = next;
	for (const notify of listeners) notify();
}

function later(next: boolean, ms: number) {
	if (timer !== null) clearTimeout(timer);
	timer = setTimeout(() => set(next), ms);
}

function settle() {
	if (keyboard) set(true);
	else if (onStrip && !pressed) {
		if (!out) later(true, REST_MS);
		else set(true);
	} else if (onPeek) set(out);
	else if (out) later(false, TUCK_MS);
	else set(false);
}

/** The pointer came onto the strip, or left it. */
export function stripPointer(on: boolean) {
	onStrip = on;
	if (!on) pressed = false;
	settle();
}

/** The pointer came onto the peek, or left it. */
export function peekPointer(on: boolean) {
	onPeek = on;
	settle();
}

/** The keyboard came onto the strip or the peek, or left both. */
export function peekKeyboard(on: boolean) {
	keyboard = on;
	settle();
}

/** The strip was pressed: the peek goes at once. */
export function stripPressed() {
	pressed = true;
	keyboard = false;
	set(false);
}

/** The peek goes at once: Esc, a click on the page, nothing left to list. */
export function tuckPeek() {
	keyboard = false;
	set(false);
}

function subscribe(notify: () => void) {
	listeners.add(notify);
	return () => {
		listeners.delete(notify);
	};
}

/** The peek is out because the learner asked for it. */
export function usePeekOut(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => out,
		() => false,
	);
}

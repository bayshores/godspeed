import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { kbdEventForAction, stepSessionMatch } from "@/shared/core";
import {
	sameSessionRange, sessionFindRanges, sessionRangeIdentity, type SessionRangeIdentity,
} from "@/frontend/components/session-find-dom";
import { scrollSessionTarget, type SessionScrollContext } from "@/frontend/components/session-navigation";

const SESSION_FIND_HIGHLIGHT = "lh-session-find";
const SESSION_FIND_ACTIVE_HIGHLIGHT = "lh-session-find-active";

/** ::highlight() rules live OUTSIDE globals.css on purpose: the PostCSS/
 *  Tailwind v4 pipeline rejects the Custom Highlight pseudo-element as a
 *  parse error, which downed the whole stylesheet. A tiny <style> element,
 *  injected once on first client mount, ships them verbatim. */
const FIND_STYLE_ID = "lh-session-find-style";
export function injectFindStyles(): void {
	if (document.getElementById(FIND_STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = FIND_STYLE_ID;
	style.textContent = `
::highlight(${SESSION_FIND_HIGHLIGHT}) { background-color: color-mix(in oklab, var(--primary) 25%, transparent); }
::highlight(${SESSION_FIND_ACTIVE_HIGHLIGHT}) { background-color: var(--primary); color: var(--primary-foreground); }`;
	document.head.appendChild(style);
}

export function clearSessionFindHighlights(): void {
	if (typeof CSS === "undefined") return;
	CSS.highlights?.delete(SESSION_FIND_HIGHLIGHT);
	CSS.highlights?.delete(SESSION_FIND_ACTIVE_HIGHLIGHT);
}

function publishHighlights(ranges: readonly Range[], index: number): void {
	if (typeof CSS === "undefined" || !CSS.highlights || typeof Highlight === "undefined") return;
	// Avoid a huge argument spread when a short query matches many times.
	const all = new Highlight();
	for (const range of ranges) all.add(range);
	CSS.highlights.set(SESSION_FIND_HIGHLIGHT, all);
	const active = new Highlight();
	active.priority = 1;
	if (ranges[index]) active.add(ranges[index]!);
	CSS.highlights.set(SESSION_FIND_ACTIVE_HIGHLIGHT, active);
}

/** One-Esc law: a surfaced menu/dialog/cheat sheet outranks this non-modal
 * bar, regardless of where focus happened to be left. Closed Radix exits
 * must not block Find once they have stopped being a surfaced layer, and
 * neither does a notice that came by itself (`data-lh-menu="quiet"`). */
export function sessionFindHasForegroundLayer(doc: Document): boolean {
	return Array.from(doc.querySelectorAll(
		'[data-lh-menu], [data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [data-testid="cheat-sheet"]',
	)).some((element) => {
		if (element.getAttribute("data-state") === "closed" || element.hasAttribute("hidden") || element.getAttribute("data-lh-menu") === "quiet") return false;
		const view = doc.defaultView;
		if (typeof view?.getComputedStyle !== "function") return true;
		const style = view.getComputedStyle(element);
		return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
	});
}

/** What every Find in the top bar (bar-find.tsx) shares: the find key or the
 * magnifying glass opens it (not while a menu or dialog is up), a second find
 * key selects the field again, and closing gives focus back. Focus goes back
 * to where it was, or to the glass when that was the glass itself, which the
 * open field replaced. `onClose` must keep its identity. */
export function useBarFindOpen(enabled: boolean, onClose: () => void) {
	const [open, setOpen] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const keyRef = useRef<HTMLButtonElement | null>(null);
	const previousFocus = useRef<HTMLElement | null>(null);
	const giveBack = useRef(false);

	const close = useCallback(() => {
		onClose();
		giveBack.current = true;
		setOpen(false);
	}, [onClose]);

	const start = useCallback(() => {
		if (!enabled || sessionFindHasForegroundLayer(document)) return;
		if (open) {
			inputRef.current?.focus({ preventScroll: true });
			inputRef.current?.select();
			return;
		}
		previousFocus.current = document.activeElement as HTMLElement | null;
		setOpen(true);
	}, [enabled, open]);

	useEffect(() => {
		window.addEventListener(kbdEventForAction("find"), start);
		return () => window.removeEventListener(kbdEventForAction("find"), start);
	}, [start]);

	// After the render that opened or closed it, so the field, or the glass, is there to focus.
	useEffect(() => {
		if (open) {
			inputRef.current?.focus({ preventScroll: true });
			inputRef.current?.select();
		} else if (giveBack.current) {
			giveBack.current = false;
			const back = previousFocus.current?.isConnected ? previousFocus.current : keyRef.current;
			back?.focus({ preventScroll: true });
		}
	}, [open]);

	return { open, start, close, inputRef, keyRef };
}

/** Find in an open lesson, for the top bar's Find: Enter and Shift+Enter
 * walk the matches, Esc or Close closes it. Lives for ONE Chat (keyed by
 * chatId): closing keeps the query and the reading position; another lesson
 * starts fresh. The bar is outside scopeRef, so it never finds its own query or count. */
export function useSessionFind(scopeRef: RefObject<HTMLDivElement | null>, scrollContextRef: RefObject<SessionScrollContext | null>) {
	const { open, start, close, inputRef, keyRef } = useBarFindOpen(true, clearSessionFindHighlights);
	const [query, setQuery] = useState("");
	const [result, setResult] = useState({ index: -1, count: 0 });
	useEffect(injectFindStyles, []);
	const rangesRef = useRef<Range[]>([]);
	const indexRef = useRef(-1);
	const identityRef = useRef<SessionRangeIdentity | null>(null);
	const lastQueryRef = useRef<string | null>(null);

	useEffect(() => {
		if (!open) return;
		const onEscape = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || sessionFindHasForegroundLayer(document)) return;
			event.preventDefault();
			event.stopPropagation();
			close();
		};
		document.addEventListener("keydown", onEscape);
		return () => document.removeEventListener("keydown", onEscape);
	}, [open, close]);

	useEffect(() => {
		if (!open || !scopeRef.current) return;
		const scope = scopeRef.current;
		let frame: number | null = null;
		const refresh = (selectFirst: boolean) => {
			const ranges = sessionFindRanges(scope, query);
			let index = selectFirst ? 0 : ranges.findIndex((range) => sameSessionRange(range, identityRef.current));
			if (index < 0) index = Math.max(0, Math.min(indexRef.current, ranges.length - 1));
			if (!ranges.length) index = -1;
			rangesRef.current = ranges;
			indexRef.current = index;
			identityRef.current = ranges[index] ? sessionRangeIdentity(ranges[index]!) : null;
			setResult((old) => old.index === index && old.count === ranges.length ? old : { index, count: ranges.length });
			publishHighlights(ranges, index);
			if (selectFirst && ranges[index]) scrollSessionTarget(ranges[index]!, scope, scrollContextRef.current);
		};
		// New queries start at the session's first match. Reopening the retained
		// query or receiving streamed content only refreshes; neither yanks scroll.
		refresh(lastQueryRef.current !== query);
		lastQueryRef.current = query;
		const schedule = () => {
			if (frame !== null) return;
			frame = window.requestAnimationFrame(() => { frame = null; refresh(false); });
		};
		const observer = new MutationObserver(schedule);
		observer.observe(scope, { subtree: true, childList: true, characterData: true, attributes: true,
			attributeFilter: ["hidden", "style", "class", "data-state", "aria-expanded"] });
		window.addEventListener("resize", schedule);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", schedule);
			if (frame !== null) window.cancelAnimationFrame(frame);
			clearSessionFindHighlights();
		};
	}, [open, query, scopeRef, scrollContextRef]);

	// Also clear on a session switch when Find was already closed.
	useEffect(() => clearSessionFindHighlights, []);

	const step = (direction: 1 | -1) => {
		const ranges = rangesRef.current;
		const index = stepSessionMatch(indexRef.current, ranges.length, direction);
		indexRef.current = index;
		identityRef.current = ranges[index] ? sessionRangeIdentity(ranges[index]!) : null;
		setResult({ index, count: ranges.length });
		publishHighlights(ranges, index);
		if (ranges[index] && scopeRef.current) scrollSessionTarget(ranges[index]!, scopeRef.current, scrollContextRef.current);
	};

	const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
		if (event.key === "Enter") {
			event.stopPropagation(); // NEVER reach question/global Enter submits.
			if ((event.target as HTMLElement).tagName !== "INPUT" || event.nativeEvent.isComposing) return;
			event.preventDefault();
			step(event.shiftKey ? -1 : 1);
		} else if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
		}
	};

	return { open, start, close, query, setQuery, inputRef, keyRef, onKeyDown, step, count: query ? `${result.index + 1} of ${result.count}` : "", canStep: result.count > 0 };
}

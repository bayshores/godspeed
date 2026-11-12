import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { kbdEventForAction, stepSessionMatch } from "@/shared/core";
import {
	sameSessionRange, sessionFindRanges, sessionRangeIdentity, type SessionRangeIdentity,
} from "@/frontend/components/session-find-dom";
import { scrollSessionTarget, type SessionScrollContext } from "@/frontend/components/session-navigation";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";

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
 * must not block Find once they have stopped being a surfaced layer. */
export function sessionFindHasForegroundLayer(doc: Document): boolean {
	return Array.from(doc.querySelectorAll(
		'[data-lh-menu], [data-radix-popper-content-wrapper], [role="menu"], [role="dialog"], [data-testid="cheat-sheet"]',
	)).some((element) => {
		if (element.getAttribute("data-state") === "closed" || element.hasAttribute("hidden")) return false;
		const view = doc.defaultView;
		if (typeof view?.getComputedStyle !== "function") return true;
		const style = view.getComputedStyle(element);
		return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
	});
}

/** A button on the dark lesson bar, outlined in the bar's own ink. */
const FIND_BUTTON = "lh-btn lh-no-drag shrink-0 border-bar-ink text-[15px] text-bar-ink hover:bg-bar-ink/15 disabled:opacity-40";

/** Lives in the lesson's bar: shows its children (the bar's own buttons)
 * until Find opens, then takes their place. Mounted for the lifetime of ONE
 * Chat (which is keyed by chatId). Closing keeps the query/reading position;
 * changing sessions resets all local state. The bar lives outside scopeRef,
 * so it never finds its own query or count. */
export function SessionFind({ scopeRef, scrollContextRef, children }: {
	scopeRef: RefObject<HTMLDivElement | null>;
	scrollContextRef: RefObject<SessionScrollContext | null>;
	children?: ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [result, setResult] = useState({ index: -1, count: 0 });
	useEffect(injectFindStyles, []);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const previousFocus = useRef<HTMLElement | null>(null);
	const rangesRef = useRef<Range[]>([]);
	const indexRef = useRef(-1);
	const identityRef = useRef<SessionRangeIdentity | null>(null);
	const lastQueryRef = useRef<string | null>(null);

	const close = useCallback(() => {
		clearSessionFindHighlights();
		setOpen(false);
		if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
	}, []);

	useEffect(() => {
		const onFind = () => {
			if (sessionFindHasForegroundLayer(document)) return;
			if (!open) previousFocus.current = document.activeElement as HTMLElement | null;
			setOpen(true);
			// A second Mod+F focuses/selects the retained query, not a second bar.
			if (open) { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.select(); }
		};
		window.addEventListener(kbdEventForAction("find"), onFind);
		return () => window.removeEventListener(kbdEventForAction("find"), onFind);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		inputRef.current?.focus({ preventScroll: true });
		inputRef.current?.select();
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

	if (!open) return <>{children}</>;
	return (
		<div
			role="search"
			aria-label="Find in lesson"
			data-testid="session-find"
			className="lh-no-drag flex items-center gap-4"
			onKeyDown={(event) => {
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
			}}
		>
			<input
				ref={inputRef}
				aria-label="Find in lesson"
				placeholder="Find in lesson"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				spellCheck={false}
				className="h-[34px] w-[200px] rounded-[3px] border-[1.5px] border-bar bg-bar-ink px-3 text-[15px] text-bar outline-none placeholder:text-bar/60"
			/>
			<output aria-live="polite" data-testid="session-find-count" className="font-count min-w-[6ch] shrink-0 text-[15px]">
				{query ? `${result.index + 1} of ${result.count}` : ""}
			</output>
			<button type="button" className={FIND_BUTTON} disabled={!result.count} onMouseDown={(event) => event.preventDefault()} onClick={() => step(-1)}>
				Previous match
			</button>
			<button type="button" className={FIND_BUTTON} disabled={!result.count} onMouseDown={(event) => event.preventDefault()} onClick={() => step(1)}>
				Next match
			</button>
			<button type="button" className={FIND_BUTTON} onClick={close}>
				<PixelIcon name="close" />
				Close Find
			</button>
		</div>
	);
}

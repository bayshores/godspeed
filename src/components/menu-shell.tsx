import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { usePresence } from "@/components/presence";

/**
 * THE shared menu shell: one placement body for the app's dropdown menus,
 * portaled to document.body (never clipped by an ancestor's overflow),
 * fixed-anchored to the trigger's rect, viewport-capped. PLACEMENT-ONLY
 * by design: every site keeps its own open/close/Esc contract, since
 * layered dismissal differs by surface.
 *
 *  - Side: each site declares its preferred side — the composer opens UP
 *    (its control sits at screen bottom), the settings rows open DOWN;
 *    the shell flips when the preferred side cannot show the menu's
 *    content and the other side is roomier (the graph popovers'
 *    honest-fitting behavior, generalized).
 *  - Cap: max-height = min(60vh, the chosen side's available room); the
 *    menu scrolls internally instead of stretching the page or escaping
 *    the viewport (graph-view's max-h-[60vh] pattern).
 *  - Re-placement: capture-phase scroll + window resize — the settings
 *    menus' discipline (the settings dialog's inner content scroll
 *    included).
 *
 * Sites: the class switcher, file rows, the files page, graph fact lists
 * and the settings font menu (the graph popovers and the stats-bar summary
 * popover stay bespoke). Menus portal out of any overflow-hidden frame so
 * they can extend beyond a dialog.
 *
 * SSR: menus only mount client-side while open; the hidden measuring pass
 * below is the only pre-placement render, so a server render never emits
 * a positioned menu.
 *
 * Motion: the placed body carries .lh-pop
 * (data-side from the placement, data-state from presence). Sites pass
 * `open` and render the shell unconditionally, so it stays mounted ~110ms
 * through its exit; while closing it is inert — no focus, no keys, no
 * clicks. Without `open` the shell is open while mounted (enter only).
 */

const GAP = 4; // anchor edge → menu (the bespoke shells' settled 4px)
const EDGE = 8; // viewport floor the menu never enters
const CAP_VH = 0.6; // 60vh — the graph pattern's cap
const MIN_USABLE = 96; // floor: a shorter cap is an unusable sliver; the
// cap then overflows the edge instead of crushing the menu

/** A MenuShell mounted = a dropdown open (the settings dialog's content
 *  column locks while any menu is down). The shell stays placement-only: it
 *  just ANNOUNCES, surfaces decide what to do with the fact (the
 *  settings dialog locks; anything un-lockable keeps the re-place-on-
 *  scroll fallback below). Count-based: overlapping menus open/close in
 *  any order and the accounting stays balanced. */
export const MENU_OPEN_EVENT = "lh:menu-open";
export const MENU_CLOSE_EVENT = "lh:menu-close";

export type MenuSide = "up" | "down";
type MenuAlign = "left" | "right";

/** One placement decision. `style` is the fixed-position payload; the side
 *  rides back for the flip assertion in tests. */
interface MenuPlacement {
	side: MenuSide;
	style: Record<string, string | number>;
	maxHeight: number;
}

/** Pure: the placement decision — anchored rect + viewport + the menu's
 *  UNCAPPED content height (scrollHeight, so re-placements after a search
 *  filter re-measure honestly) → side, fixed style, cap. Flip rule: stay
 *  on the preferred side unless it cannot show the full content AND the
 *  other side is roomier. The cap always keeps the menu inside its side's
 *  room when there is room; the floor keeps it usable when there isn't. */
export function computeMenuPlacement(
	rect: { top: number; bottom: number; left: number; right: number },
	viewport: { width: number; height: number },
	contentHeight: number,
	preferredSide: MenuSide,
	align: MenuAlign,
): MenuPlacement {
	const availDown = viewport.height - EDGE - (rect.bottom + GAP);
	const availUp = rect.top - GAP - EDGE;
	// contentHeight ≤ 0 (nothing measured yet) keeps the preferred side —
	// the hidden first pass re-measures and decides with real numbers.
	let side = preferredSide;
	if (contentHeight > 0) {
		const preferredAvail = preferredSide === "down" ? availDown : availUp;
		const otherAvail = preferredSide === "down" ? availUp : availDown;
		if (contentHeight > preferredAvail && otherAvail > preferredAvail) {
			side = preferredSide === "down" ? "up" : "down";
		}
	}
	const avail = side === "down" ? availDown : availUp;
	const maxHeight = Math.max(MIN_USABLE, Math.min(CAP_VH * viewport.height, avail));
	const horizontal: Record<string, number> =
		align === "right" ? { right: viewport.width - rect.right } : { left: rect.left };
	const vertical: Record<string, number> =
		side === "down" ? { top: rect.bottom + GAP } : { bottom: viewport.height - rect.top + GAP };
	return { side, style: { ...horizontal, ...vertical }, maxHeight };
}

/** The shared shell. Exactly one anchor seam: pass `anchorRef` (a live
 *  element ref) or `anchorTestid` (the settings section's pattern — the
 *  trigger is queried by testid at place time). */
export function MenuShell({ open, ...body }: MenuShellProps) {
	const presence = usePresence(open ?? true);
	if (!presence.mounted) return null;
	return <MenuShellBody {...body} closing={presence.state === "closed"} />;
}

interface MenuShellProps extends MenuBodyProps {
	/** Open flag: given, the site renders the shell always and
	 *  the shell plays its exit before unmounting. Omitted: mounted = open. */
	open?: boolean;
}

interface MenuBodyProps {
	anchorRef?: RefObject<HTMLElement | null>;
	anchorTestid?: string;
	/** The menu body's own testid (sites assert it). */
	testid: string;
	/** Which way the menu opens from the anchor when both sides fit. */
	preferredSide: MenuSide;
	/** Which anchor edge the menu's horizontal position keys off. */
	align?: MenuAlign;
	/** The menu body classes: width, border, bg, padding, text — the
	 *  shell adds position, z-index, the height cap, and scrolling. */
	menuClass: string;
	children: ReactNode;
}

function MenuShellBody({
	anchorRef,
	anchorTestid,
	testid,
	preferredSide,
	align = "right",
	menuClass,
	children,
	closing,
}: MenuBodyProps & { closing: boolean }) {
	const menuRef = useRef<HTMLDivElement>(null);
	const [placed, setPlaced] = useState<MenuPlacement | null>(null);
	const focusedOnceRef = useRef(false);

	// Announce open↔close for lockable surfaces (see MENU_OPEN_EVENT). The
	// close fires when the exit STARTS, not at unmount — the lock lifts with
	// the click that closed the menu. One open per close, always.
	useEffect(() => {
		if (closing) return;
		window.dispatchEvent(new CustomEvent(MENU_OPEN_EVENT));
		return () => {
			window.dispatchEvent(new CustomEvent(MENU_CLOSE_EVENT));
		};
	}, [closing]);

	// Closing: drop focus that was still inside (the shell stays mounted),
	// and re-arm the focus-on-open below in case the menu re-opens mid-exit.
	useEffect(() => {
		if (!closing) return;
		focusedOnceRef.current = false;
		const el = menuRef.current;
		if (el && document.activeElement instanceof HTMLElement && el.contains(document.activeElement)) {
			document.activeElement.blur();
		}
	}, [closing]);

	// Focus on open: the search menus land focus IN the
	// search; menus without one land it on the body (tabIndex -1 below) so
	// the arrow machine has a home. Once only — re-placements (scroll/
	// resize) must never steal focus back mid-walk. The lists' own mount
	// focus runs during the hidden measuring pass, where focus() silently
	// fails (visibility: hidden subtrees are not focusable) — this seam is
	// the one that actually lands.
	useEffect(() => {
		if (placed === null || closing || focusedOnceRef.current) return;
		focusedOnceRef.current = true;
		const el = menuRef.current;
		if (!el) return;
		const input = el.querySelector<HTMLElement>("input");
		(input ?? el).focus();
	}, [placed, closing]);

	// The arrow machine for menus WITHOUT a search, so the arrow keys cycle
	// the options and never scroll the screen: ArrowDown/Up move DOM focus
	// among the option buttons with WRAP, Home/End hit the ends; Enter
	// activates the focused button natively. Search menus own their arrows
	// inside the input; those events never bubble here, and the
	// input/textarea guard is belt-and-braces.
	const onBodyKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (closing) return;
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		const { key } = e;
		if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return;
		// Folded sections stay mounted but inert; skip them.
		const buttons = Array.from(
			menuRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [],
		).filter((b) => !b.closest("[inert]"));
		if (buttons.length === 0) return;
		e.preventDefault();
		if (key === "Home") {
			buttons[0]?.focus();
			return;
		}
		if (key === "End") {
			buttons[buttons.length - 1]?.focus();
			return;
		}
		const delta = key === "ArrowDown" ? 1 : -1;
		const idx = buttons.findIndex((b) => b === document.activeElement);
		// From the body (nothing focused yet): ArrowDown enters at the FIRST
		// option, ArrowUp at the last — the native-select convention.
		const base = idx === -1 ? (delta > 0 ? -1 : 0) : idx;
		const next = (base + delta + buttons.length) % buttons.length;
		buttons[next]?.focus();
	};

	const anchor = () => {
		if (anchorRef) return anchorRef.current;
		if (anchorTestid !== undefined) return document.querySelector(`[data-testid="${anchorTestid}"]`);
		return null;
	};

	// Measure + (re)place: on mount, then on every capture-phase scroll and
	// resize (rAF-throttled). scrollHeight keeps the flip decision honest
	// after the content changes shape (a search filtering the list).
	useLayoutEffect(() => {
		let raf = 0;
		const place = () => {
			const el = anchor();
			if (!el || !menuRef.current) return;
			const p = computeMenuPlacement(
				el.getBoundingClientRect(),
				{ width: window.innerWidth, height: window.innerHeight },
				menuRef.current.scrollHeight,
				preferredSide,
				align,
			);
			setPlaced(p);
		};
		place();
		const rePlace = () => {
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(place);
		};
		window.addEventListener("scroll", rePlace, true);
		window.addEventListener("resize", rePlace);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("scroll", rePlace, true);
			window.removeEventListener("resize", rePlace);
		};
	}, [anchorRef, anchorTestid, preferredSide, align]);

	// First pass: mounted hidden at the viewport's top-left so the layout
	// effect can measure the real content height before anything is seen.
	// The menu is positioned ONCE and then only re-anchored — no flash.
	if (placed === null) {
		return createPortal(
			<div
				ref={menuRef}
				data-testid={testid}
				data-lh-menu=""
				style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
				className={menuClass}
			>
				{children}
			</div>,
			document.body,
		);
	}
	return createPortal(
		<div
			ref={menuRef}
			data-testid={testid}
			data-lh-menu=""
			tabIndex={-1}
			onKeyDown={onBodyKeyDown}
			data-side={placed.side}
			data-state={closing ? "closed" : "open"}
			inert={closing}
			style={{ position: "fixed", zIndex: 60, ...placed.style, maxHeight: placed.maxHeight, overflowY: "auto" }}
			// The body is the arrow machine's focus home (input-less menus
			// land focus here on open) — the focus STAYS, but the browser's
			// default blue ring around it must not draw. Arrow cycling moves
			// DOM focus to the buttons, which
			// carry their own hover/highlight; the ring is pure noise.
			// .lh-pop lands on the PLACED body only: the animation starts on
			// the first visible frame, already at its anchor.
			className={`${menuClass} lh-pop outline-none`}
		>
			{children}
		</div>,
		document.body,
	);
}
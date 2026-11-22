/**
 * The Graph picture and its open panel in the page's room. The panel is a
 * slip under the picture: its links fold to fit SLIP_SHARE of the room, its
 * name and words may grow it further while the picture keeps its least
 * height, and the picture takes the room above it. In a room too small for
 * both, or when the panel is taller than that even with its links folded,
 * the panel takes the picture's place. The panel travels in from past the
 * room's foot and leaves the same way; one that replaces another stays, and
 * its sheet glides to the new height. The picture fades in once as it
 * re-fits around a panel that opens or has left, and once the slip's height
 * is known the picked topic is fitted into the room again.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Bleed } from "./constellation-camera.ts";
import { prefersReducedMotion, usePresence } from "@/frontend/components/presence";
import { LONGEST_MS } from "@/frontend/components/sheet-glide-model";
import { useSheetGlide } from "@/frontend/components/use-sheet-glide";
import { panelAlone, panelStacked, pictureHeight, slipCap, slipMost, TAB_H } from "./graph-layout-model.ts";
import { travelMs, type PanelMotion } from "./slip-motion-model.ts";
import type { PanelRoom } from "./use-link-fit.ts";
import type { Room } from "./use-room.ts";

/** The room a zoomed-in picture keeps clear under the tab row's rule. */
const UNDER_TABS = 4;
/** How far past its foot a zoomed-in picture is drawn: to the foot line with no panel, barely with the slip under it. */
const PAST_FOOT = 16;
const PAST_FOOT_OVER_SLIP = 4;
/** A slip whose height moves less than this keeps the camera where it is. */
const REFIT = 24;
/** The sheet's lip under what it holds (.lh-sheet's bottom border). */
const LIP = 4;
/** --lh-ease-out and --lh-ease-in, for the panel's travel. */
const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";
/** A closing panel is held this long, the longest it takes to leave. */
const LEAVE_MS = travelMs(Number.POSITIVE_INFINITY, "out");

export function GraphLayout({
	room,
	panelKey,
	panel,
	picture,
	onRefit,
	onGone,
}: {
	room: Room;
	/** Names the open panel (its fact or topic), so one too tall for the slip shows alone until another opens or the room changes. */
	panelKey: string | null;
	/** The open panel, laid out for the room it fits; null with nothing picked. */
	panel: ((room: PanelRoom) => ReactNode) | null;
	picture: (box: { width: number; height: number; bleed: Bleed }) => ReactNode;
	/** The slip's height changed: fit the picked topic into the picture's new room. */
	onRefit: () => void;
	/** A closed panel has left, and the picture is back if it was hidden. */
	onGone: () => void;
}) {
	// A closing panel stays on screen while it leaves, only where it can move (never with reduced motion).
	const presence = usePresence(!!panel, typeof document !== "undefined" && typeof document.documentElement.animate === "function" ? LEAVE_MS : 0);
	const last = useRef(panel);
	if (panel) last.current = panel;
	const shown = panel ?? (presence.mounted ? last.current : null);
	const leaving = !panel && !!shown;
	const arrival = useArrival(panelKey, presence.mounted);

	const [tooTall, setTooTall] = useState<string | null>(null);
	const tallKey = `${arrival.key} ${room.width} ${room.height}`;
	const alone = !!shown && (panelAlone(room) || tooTall === tallKey);
	const slip = useSlipHeight(!!shown && !alone);
	const cap = slipCap(room.height);
	const most = slipMost(room.height);
	const height = pictureHeight(room.height, shown && !alone ? Math.min(most, slip.height || cap) : 0);
	const glide = useSheetGlide();
	// A panel that replaced another holds still at the slip's foot while the edge uncovers it, for as long as a glide can take;
	// one that grows in place ("N more") rides the edge up with what it already shows, and its new rows come up from the foot.
	const [settled, setSettled] = useState(arrival.n);
	const atFoot = arrival.motion === "swap" && settled !== arrival.n;
	useEffect(() => {
		if (!atFoot) return;
		const timer = setTimeout(() => setSettled(arrival.n), LONGEST_MS);
		return () => clearTimeout(timer);
	}, [atFoot, arrival.n]);
	const travel = useTravel(arrival.motion, leaving, (el) => (alone ? { by: `${room.height}px`, points: room.height } : { by: `calc(100% + ${TAB_H}px)`, points: el.offsetHeight + TAB_H }));

	const fitted = useRef(0);
	const refit = useRef(onRefit);
	refit.current = onRefit;
	useEffect(() => {
		if (!slip.height) fitted.current = 0;
		else if (Math.abs(slip.height - fitted.current) >= REFIT) {
			fitted.current = slip.height;
			refit.current();
		}
	}, [slip.height]);

	const gone = useRef(onGone);
	gone.current = onGone;
	const held = useRef(presence.mounted);
	useLayoutEffect(() => {
		if (held.current && !presence.mounted) gone.current();
		held.current = presence.mounted;
	}, [presence.mounted]);

	// The picture re-fits around a panel that opens, or has left, with one short fade, kept in place so focus stays on its topic.
	const pictureRef = useRef<HTMLDivElement>(null);
	const beside = !!shown && !alone;
	const wasBeside = useRef(beside);
	useLayoutEffect(() => {
		if (wasBeside.current === beside) return;
		wasBeside.current = beside;
		if (!prefersReducedMotion()) pictureRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: EASE_OUT });
	}, [beside]);

	// The sheet glides to each new height; what it holds is laid out at its new size at once.
	const sheet = (inner: number, fits: Omit<PanelRoom, "motion">, measure?: (el: HTMLDivElement | null) => void) => (
		<div ref={glide} className={`lh-sheet flex flex-col ${atFoot ? "justify-end" : ""}`}>
			<div ref={measure} className="flex shrink-0 flex-col" style={{ maxHeight: inner }}>
				{shown?.({ ...fits, motion: arrival.motion })}
			</div>
		</div>
	);

	// Alone, the panel takes the picture's place and travels in and out past the room's foot, which cuts it there.
	if (shown && alone) {
		const inner = room.height - TAB_H - LIP;
		return (
			<div ref={room.ref} className="w-full overflow-y-clip" style={{ height: room.height, paddingTop: TAB_H }}>
				<aside ref={travel} data-testid="graph-panel" className={`relative ${leaving ? "pointer-events-none" : ""}`}>
					{sheet(inner, { stacked: panelStacked(room), width: room.width, height: inner, most: inner })}
				</aside>
			</div>
		);
	}

	// Zoomed in, the picture is drawn out to the window's sides and up to just under the tab row.
	// The slip travels inside a box that cuts it at the room's foot only, so the picture's bleed past its sides stays.
	const bleed: Bleed = { left: room.edges.left, right: room.edges.right, top: Math.max(0, room.edges.top - UNDER_TABS), bottom: shown ? PAST_FOOT_OVER_SLIP : PAST_FOOT };
	return (
		<div ref={room.ref} className="relative w-full" style={{ height: room.height }}>
			<div ref={pictureRef}>{picture({ width: room.width, height, bleed })}</div>
			{shown && (
				<div className="pointer-events-none absolute inset-0 z-30 overflow-y-clip">
					<aside ref={travel} data-testid="graph-panel" className={`absolute inset-x-0 bottom-0 ${leaving ? "" : "pointer-events-auto"}`}>
						{sheet(most - LIP, { stacked: false, width: room.width, height: cap - LIP, most: most - LIP, onTooTall: () => setTooTall(tallKey) }, slip.ref)}
					</aside>
				</div>
			)}
		</div>
	);
}

/**
 * How the open panel came, named by its key: with the page, into an empty slip, or replacing
 * another while the slip stayed. A closing panel keeps its key until it has left.
 */
function useArrival(panelKey: string | null, mounted: boolean) {
	// `n` counts the arrivals, so the same panel coming back is a new one.
	const [arrival, setArrival] = useState<{ key: string | null; motion: PanelMotion; n: number }>({ key: panelKey, motion: "still", n: 0 });
	if (panelKey !== null && panelKey !== arrival.key) setArrival({ key: panelKey, motion: arrival.key === null ? "open" : "swap", n: arrival.n + 1 });
	else if (!mounted && arrival.key !== null) setArrival({ key: null, motion: "still", n: arrival.n });
	return arrival;
}

/**
 * The panel arrives from past the room's foot by `away` (as a CSS length, and in points for its
 * time) each time it is drawn anew, and leaves the same way, kept there by presence until it is
 * gone. One that came with the page is simply there.
 */
function useTravel(motion: PanelMotion, leaving: boolean, away: (el: HTMLElement) => { by: string; points: number }) {
	const [el, setEl] = useState<HTMLElement | null>(null);
	const now = useRef({ motion, away });
	now.current = { motion, away };
	useLayoutEffect(() => {
		if (!el?.animate || now.current.motion === "still" || prefersReducedMotion()) return;
		const { by, points } = now.current.away(el);
		el.animate([{ transform: `translateY(${by})` }, { transform: "none" }], { duration: travelMs(points, "in"), easing: EASE_OUT });
	}, [el]);
	useLayoutEffect(() => {
		if (!leaving || !el?.animate || prefersReducedMotion()) return;
		const { by, points } = now.current.away(el);
		const out = el.animate([{ transform: "none" }, { transform: `translateY(${by})` }], { duration: travelMs(points, "out"), easing: EASE_IN, fill: "forwards" });
		// Opened again before it has left, it is back at once.
		return () => out.cancel();
	}, [leaving, el]);
	return setEl;
}

/**
 * The slip's height at rest while it shows (what it holds and its lip, never a height it glides
 * through); 0 before it is drawn and once it has left. Read as the browser reports it, before
 * paint and after the links have folded, so the picture re-fits once to the final height.
 */
function useSlipHeight(open: boolean) {
	const [el, setEl] = useState<HTMLDivElement | null>(null);
	const [height, setHeight] = useState(0);
	if (!open && height !== 0) setHeight(0);
	useLayoutEffect(() => {
		if (!open || !el) return;
		const ro = new ResizeObserver(() => flushSync(() => setHeight(el.offsetHeight + LIP)));
		ro.observe(el);
		return () => ro.disconnect();
	}, [open, el]);
	return { ref: setEl, height };
}

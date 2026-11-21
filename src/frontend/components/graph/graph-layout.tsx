/**
 * The Graph picture and its open panel in the page's room. The panel is a
 * slip under the picture, fitted at rest to SLIP_SHARE of the room, and the
 * picture takes the room above it; in a room too small for both, or when the
 * panel is too tall for the slip even with its links folded, the panel takes
 * the picture's place. The picture fades in once as it re-fits around a panel
 * that opens or closes, and once the slip's height is known the picked
 * topic is fitted into the room again.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Bleed } from "./constellation-camera.ts";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { panelAlone, panelStacked, pictureHeight, slipCap, TAB_H } from "./graph-layout-model.ts";
import type { PanelRoom } from "./use-link-fit.ts";
import type { Room } from "./use-room.ts";

/** The room a zoomed-in picture keeps clear under the tab row's rule. */
const UNDER_TABS = 4;
/** How far past its foot a zoomed-in picture is drawn: to the foot line with no panel, barely with the slip under it. */
const PAST_FOOT = 16;
const PAST_FOOT_OVER_SLIP = 4;
/** A slip whose height moves less than this keeps the camera where it is. */
const REFIT = 24;

export function GraphLayout({
	room,
	panelKey,
	panel,
	picture,
	onRefit,
}: {
	room: Room;
	/** Names the open panel (its fact or topic), so one too tall for the slip shows alone until another opens or the room changes. */
	panelKey: string | null;
	/** The open panel, laid out for the room it fits; null with nothing picked. */
	panel: ((room: PanelRoom) => ReactNode) | null;
	picture: (box: { width: number; height: number; bleed: Bleed }) => ReactNode;
	/** The slip's height changed: fit the picked topic into the picture's new room. */
	onRefit: () => void;
}) {
	const [tooTall, setTooTall] = useState<string | null>(null);
	const tallKey = `${panelKey} ${room.width} ${room.height}`;
	const alone = !!panel && (panelAlone(room) || tooTall === tallKey);
	const slip = useSlipHeight(!!panel && !alone);
	const cap = slipCap(room.height);
	const height = pictureHeight(room.height, panel && !alone ? Math.min(cap, slip.height || cap) : 0);

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

	// The picture re-fits around a panel that opens or closes with one short fade, kept in place so focus stays on its topic.
	const pictureRef = useRef<HTMLDivElement>(null);
	const beside = !!panel && !alone;
	const shown = useRef(beside);
	useLayoutEffect(() => {
		if (shown.current === beside) return;
		shown.current = beside;
		if (!prefersReducedMotion()) pictureRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" });
	}, [beside]);

	if (panel && alone)
		return (
			<div ref={room.ref} className="w-full">
				<aside data-testid="graph-panel" className="lh-fade flex w-full flex-col" style={{ maxHeight: room.height, paddingTop: TAB_H }}>
					{panel({ stacked: panelStacked(room), width: room.width, height: room.height - TAB_H })}
				</aside>
			</div>
		);

	// Zoomed in, the picture is drawn out to the window's sides and up to just under the tab row.
	const bleed: Bleed = { left: room.edges.left, right: room.edges.right, top: Math.max(0, room.edges.top - UNDER_TABS), bottom: panel ? PAST_FOOT_OVER_SLIP : PAST_FOOT };
	return (
		<div ref={room.ref} className="relative w-full" style={{ height: room.height }}>
			<div ref={pictureRef}>{picture({ width: room.width, height, bleed })}</div>
			{panel && (
				<aside ref={slip.ref} data-testid="graph-panel" className="lh-rise absolute inset-x-0 bottom-0 z-30 flex flex-col" style={{ maxHeight: cap }}>
					{panel({ stacked: false, width: room.width, height: cap, onTooTall: () => setTooTall(tallKey) })}
				</aside>
			)}
		</div>
	);
}

/** The slip's drawn height while it shows; 0 before it is drawn and once it closes. */
function useSlipHeight(open: boolean) {
	const ref = useRef<HTMLElement>(null);
	const [height, setHeight] = useState(0);
	if (!open && height !== 0) setHeight(0);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!open || !el) return;
		const measure = () => setHeight(el.offsetHeight);
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [open]);
	return { ref, height };
}

/**
 * The Graph picture and its open panel in the page's room. The panel is a
 * slip under the picture: its links fold to fit SLIP_SHARE of the room, its
 * name and words may grow it further while the picture keeps its least
 * height, and the picture takes the room above it. In a room too small for
 * both, or when the panel is taller than that even with its links folded,
 * the panel takes the picture's place. The panel travels in from past the
 * room's foot over the picture and leaves the same way; one that replaces
 * another stays, and its sheet glides to the new height, moving between the
 * slip and the picture's place when it changes between them. A panel in the
 * picture's place covers it, and the picture is set aside only once the
 * panel has arrived. The picture re-fits with one short fade as a panel
 * opens or starts to leave, and once the slip's height is known the picked
 * topic is fitted into the room again. Follow's slip lifting the page's foot
 * (`room.foot`) re-fits nothing: the room's foot and this slip ride up over
 * the picture, which keeps its size and camera and is cut at the new foot.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { Bleed } from "./constellation-camera.ts";
import { EASE_IN, EASE_OUT, prefersReducedMotion, usePresence } from "@/frontend/components/presence";
import { LONGEST_MS, travelGlideMs } from "@/frontend/components/sheet-glide-model";
import { travelMs } from "@/frontend/components/slip-travel-model";
import { useSheetGlide } from "@/frontend/components/use-sheet-glide";
import { useSlipTravel } from "@/frontend/components/use-slip-travel";
import { panelAlone, panelStacked, pictureHeight, slipCap, slipMost, TAB_H } from "./graph-layout-model.ts";
import type { PanelMotion } from "./slip-motion-model.ts";
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
const FADE_IN_MS = 160;
const FADE_OUT_MS = 110;
/** A closing panel is held this long, the longest it takes to leave. */
const LEAVE_MS = travelMs(Number.POSITIVE_INFINITY, "out");

const canMove = () => typeof document !== "undefined" && typeof document.documentElement.animate === "function";
const moving = (el: HTMLElement | null) => !!el?.getAnimations?.().some((a) => a.playState === "running");

export function GraphLayout({
	room,
	panelKey,
	panel,
	picture,
	onRefit,
	onCovering,
}: {
	room: Room;
	/** Names the open panel (its fact or topic), so one too tall for the slip shows alone until another opens or the room changes. */
	panelKey: string | null;
	/** The open panel, laid out for the room it fits; null with nothing picked. */
	panel: ((room: PanelRoom) => ReactNode) | null;
	picture: (box: { width: number; height: number; bleed: Bleed }) => ReactNode;
	/** The slip's height changed: fit the picked topic into the picture's new room. */
	onRefit: () => void;
	/** A panel is in the picture's place: true from the moment it opens there, false once it has gone or moved to the slip. */
	onCovering: (covering: boolean) => void;
}) {
	// A closing panel stays on screen while it leaves, only where it can move (never with reduced motion).
	const presence = usePresence(!!panel, canMove() ? LEAVE_MS : 0);
	const last = useRef(panel);
	if (panel) last.current = panel;
	const shown = panel ?? (presence.mounted ? last.current : null);
	const leaving = !panel && !!shown;
	const arrival = useArrival(panelKey, presence.mounted);

	const [tooTall, setTooTall] = useState<string | null>(null);
	const tallKey = `${arrival.key} ${room.width} ${room.height}`;
	const alone = !!shown && (panelAlone(room) || tooTall === tallKey);
	const sheetHeight = useSheetHeight(!!shown);
	const cap = slipCap(room.height);
	const most = slipMost(room.height);
	// The picture gives way to the slip while a panel is open there; from the moment it starts to leave it takes the whole room.
	const beside = !!panel && !alone;
	const slipHeight = beside ? sheetHeight.height : 0;

	// A panel in the picture's place covers it: the picture keeps its last look until the panel has arrived, then fades out and is set aside.
	const covering = alone && !leaving;
	const [covered, setCovered] = useState(covering);
	if (covered && !covering) setCovered(false);
	const coveringNow = useRef(onCovering);
	coveringNow.current = onCovering;
	const toldCovering = useRef(false);
	useLayoutEffect(() => {
		if (toldCovering.current === alone) return;
		toldCovering.current = alone;
		coveringNow.current(alone);
	}, [alone]);
	const live = {
		width: room.width,
		height: pictureHeight(room.height, beside ? Math.min(most, sheetHeight.height || cap) : 0),
		// Zoomed in, the picture is drawn out to the window's sides and up to just under the tab row.
		bleed: { left: room.edges.left, right: room.edges.right, top: Math.max(0, room.edges.top - UNDER_TABS), bottom: beside ? PAST_FOOT_OVER_SLIP : PAST_FOOT },
	};
	const held = useRef({ box: live, look: beside ? "beside" : "full" });
	if (!covering) held.current = { box: live, look: beside ? "beside" : "full" };
	const look = covered ? "none" : held.current.look;

	const glide = useSheetGlide(false, true);
	const travel = useSlipTravel(arrival.motion !== "still", leaving, (el) => (alone ? { by: `${room.height - room.foot}px`, points: room.height - room.foot } : { by: `calc(100% + ${TAB_H}px)`, points: el.offsetHeight + TAB_H }), () => cover.current());
	// A panel that replaced another holds still at the slip's foot while the edge uncovers it, for as long as a glide can take;
	// one that grows in place ("N more") rides the edge up with what it already shows, and its new rows come up from the foot.
	const [settled, setSettled] = useState(arrival.n);
	const atFoot = arrival.motion === "swap" && settled !== arrival.n;
	useEffect(() => {
		if (!atFoot) return;
		const timer = setTimeout(() => setSettled(arrival.n), LONGEST_MS);
		return () => clearTimeout(timer);
	}, [atFoot, arrival.n]);

	const fitted = useRef(0);
	const refit = useRef(onRefit);
	refit.current = onRefit;
	useEffect(() => {
		if (!slipHeight) fitted.current = 0;
		else if (Math.abs(slipHeight - fitted.current) >= REFIT) {
			fitted.current = slipHeight;
			refit.current();
		}
	}, [slipHeight]);

	// The picture re-fits around a panel that opens, starts to leave or uncovers it, with one short fade, kept in place so focus stays on its topic.
	const pictureRef = useRef<HTMLDivElement>(null);
	const wasLook = useRef(look);
	useLayoutEffect(() => {
		if (wasLook.current === look) return;
		wasLook.current = look;
		if (look !== "none" && !prefersReducedMotion()) pictureRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_IN_MS, easing: EASE_OUT });
	}, [look]);

	// Covered once the panel stands still in the picture's place.
	const fadingOut = useRef<Animation | null>(null);
	const cover = useRef(() => {});
	cover.current = () => {
		// The panel is drawn (its travel starts as it is) and stands still.
		if (!covering || covered || fadingOut.current || !travel.el || moving(travel.el)) return;
		const out = prefersReducedMotion() ? null : (pictureRef.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_OUT_MS, easing: EASE_IN, fill: "forwards" }) ?? null);
		if (!out) return setCovered(true);
		fadingOut.current = out;
		out.finished.then(
			() => {
				if (fadingOut.current !== out) return;
				fadingOut.current = null;
				setCovered(true);
			},
			// Cancelled: the panel left or moved back to the slip before the picture was set aside.
			() => {},
		);
	};
	useLayoutEffect(() => {
		if (covering || !fadingOut.current) return;
		fadingOut.current.cancel();
		fadingOut.current = null;
	}, [covering]);

	// Between the slip and the picture's place the sheet stays: it moves so its top edge travels from where it was, in time with its glide.
	const was = useRef({ alone, height: sheetHeight.height, room: `${room.width} ${room.height}` });
	useLayoutEffect(() => {
		const before = was.current;
		was.current = { alone, height: sheetHeight.height, room: `${room.width} ${room.height}` };
		const el = travel.el;
		if (!shown || leaving || before.alone === alone || before.room !== was.current.room || !before.height || !el?.animate || moving(el) || prefersReducedMotion()) return;
		// To the picture's place: from the slip's top edge down to the panel's place. Back: from the panel's foot to the room's.
		const from = alone ? room.height - before.height - TAB_H : TAB_H + before.height - room.height;
		if (Math.abs(from) < 1) return;
		const move = el.animate([{ transform: `translateY(${from}px)` }, { transform: "none" }], { duration: travelGlideMs(from), easing: EASE_OUT });
		move.finished.then(
			() => cover.current(),
			() => {},
		);
	});
	// After every move above has started.
	useLayoutEffect(() => cover.current());

	// The sheet glides to each new height; what it holds is laid out at its new size at once.
	const seen = room.height - room.foot;
	const inner = alone ? seen - TAB_H - LIP : most - LIP;
	const fits: Omit<PanelRoom, "motion"> = alone
		? { stacked: panelStacked(room), width: room.width, height: inner, most: inner }
		: { stacked: false, width: room.width, height: cap - LIP, most: inner, onTooTall: () => setTooTall(tallKey) };
	// The panel travels inside a box that cuts it at the room's foot only, so the picture's bleed past its sides stays.
	// Under a lifted foot the picture is cut where it would be drawn past the room, its sides and top left free.
	const cut = room.foot > 0 ? { clipPath: `inset(-100vh -100vw calc(100% - ${seen + held.current.box.bleed.bottom}px) -100vw)` } : undefined;
	return (
		<div ref={room.ref} className="relative w-full" style={{ height: seen }}>
			{!covered && (
				<div ref={pictureRef} inert={covering} style={cut}>
					{picture(held.current.box)}
				</div>
			)}
			{shown && (
				<div className="pointer-events-none absolute inset-0 z-30 overflow-y-clip">
					<aside ref={travel.ref} data-testid="graph-panel" className={`absolute inset-x-0 ${alone ? "" : "bottom-0"} ${leaving ? "" : "pointer-events-auto"}`} style={alone ? { top: TAB_H } : undefined}>
						<div ref={glide} className={`lh-sheet flex flex-col ${atFoot ? "justify-end" : ""}`}>
							<div ref={sheetHeight.ref} className="flex shrink-0 flex-col" style={{ maxHeight: inner }}>
								{shown({ ...fits, motion: arrival.motion })}
							</div>
						</div>
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
 * The sheet's height at rest while a panel shows (what it holds and its lip, never a height it
 * glides through); 0 once it has left. Read as soon as what it holds changes, before the frame is
 * drawn and after the links have folded, so the picture re-fits once to the final height.
 */
function useSheetHeight(open: boolean) {
	const [el, setEl] = useState<HTMLDivElement | null>(null);
	const [height, setHeight] = useState(0);
	if (!open && height !== 0) setHeight(0);
	useLayoutEffect(() => {
		if (!open || !el) return;
		setHeight(el.offsetHeight + LIP);
		const measure = () => flushSync(() => setHeight(el.offsetHeight + LIP));
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		const mo = new MutationObserver(measure);
		mo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
		return () => {
			ro.disconnect();
			mo.disconnect();
		};
	}, [open, el]);
	return { ref: setEl, height };
}

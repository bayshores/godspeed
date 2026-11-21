import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { cn } from "@/frontend/lib/utils";
import type { Camera } from "@/frontend/lib/camera";
import { wheelUnit } from "@/frontend/lib/own-wheel";
import { keepInRoom, panBy, pinchAt, PINCH, UNMAGNIFIED, type Pinch, type Room } from "./magnifier-model";
import { MiniMap } from "./mini-map";

interface Magnifier {
	cam: Camera;
	room: Room;
	/** The shown part moved to `to(cam)`, in a room of `room`. */
	move: (to: (cam: Camera) => Camera, room: Room) => void;
	end: () => void;
}

const MagnifierContext = createContext<Magnifier>({ cam: UNMAGNIFIED, room: { w: 0, h: 0 }, move: () => {}, end: () => {} });

/** The page's magnifier, for the magnified page and the top bar's size word. */
export function useMagnifier(): Magnifier {
	return useContext(MagnifierContext);
}

export function MagnifierProvider({ children }: { children: ReactNode }) {
	const [state, setState] = useState({ cam: UNMAGNIFIED, room: { w: 0, h: 0 } });
	const move = useCallback((to: (cam: Camera) => Camera, room: Room) => setState((s) => ({ cam: to(s.cam), room })), []);
	const end = useCallback(() => setState((s) => (s.cam === UNMAGNIFIED ? s : { ...s, cam: UNMAGNIFIED })), []);
	const magnifier = useMemo(() => ({ ...state, move, end }), [state, move, end]);
	return <MagnifierContext value={magnifier}>{children}</MagnifierContext>;
}

const roomOf = (el: HTMLElement): Room => ({ w: el.clientWidth, h: el.clientHeight });

/** Around the page: a pinch magnifies it at the pointer, while the top bar and the teacher's panel stay as they are. */
export function MagnifiedPage({ children }: { children: ReactNode }) {
	const { cam, room, move, end } = useMagnifier();
	const box = useRef<HTMLDivElement>(null);
	const camNow = useRef(cam);
	camNow.current = cam;
	const magnified = cam.zoom > 1;

	const { pathname } = useLocation();
	useEffect(end, [pathname, end]);

	useEffect(() => {
		const onPinch = (e: Event) => {
			const el = box.current;
			const { by, x, y } = (e as CustomEvent<Pinch>).detail;
			// Only the page under the pointer: not the bar, the teacher's panel or a screen over the page.
			if (!el?.contains(document.elementFromPoint(x, y))) return;
			const r = el.getBoundingClientRect();
			move((c) => pinchAt(c, by, { x: x - r.left, y: y - r.top }, roomOf(el)), roomOf(el));
		};
		window.addEventListener(PINCH, onPinch);
		return () => window.removeEventListener(PINCH, onPinch);
	}, [move]);

	useEffect(() => {
		const el = box.current;
		if (!el || !magnified) return;
		// Not passive, so a scroll the magnifier takes does not scroll the page too.
		const onWheel = (e: WheelEvent) => {
			if (e.defaultPrevented || e.ctrlKey || e.metaKey) return;
			const unit = wheelUnit(e.deltaMode);
			const next = panBy(camNow.current, e.deltaX * unit, e.deltaY * unit, roomOf(el));
			if (!next) return;
			e.preventDefault();
			move(() => next, roomOf(el));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		const resized = new ResizeObserver(() => move((c) => keepInRoom(c, roomOf(el)), roomOf(el)));
		resized.observe(el);
		return () => {
			el.removeEventListener("wheel", onWheel);
			resized.disconnect();
		};
	}, [magnified, move]);

	return (
		<div ref={box} data-testid="magnifier" className={cn("relative h-full", magnified && "overflow-clip")}>
			{/* No transform at 100%: it would hold what is fixed inside the page. */}
			<div className="h-full origin-top-left" style={magnified ? { transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})` } : undefined}>
				{children}
			</div>
			{magnified && <MiniMap cam={cam} room={room} move={move} />}
		</div>
	);
}

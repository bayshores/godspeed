import { useRef } from "react";
import type { Camera } from "@/frontend/lib/camera";
import { centerOn, shownPart, type Room } from "./magnifier-model";

/** The longer side of the map, in points. */
const SIDE = 128;

/** The page in small, with a box on the part the magnifier shows. A press or drag on it moves that part there. */
export function MiniMap({ cam, room, move }: { cam: Camera; room: Room; move: (to: (cam: Camera) => Camera, room: Room) => void }) {
	const map = useRef<HTMLDivElement>(null);
	if (!room.w || !room.h) return null;
	const wide = room.w >= room.h;
	const w = wide ? SIDE : (SIDE * room.w) / room.h;
	const h = wide ? (SIDE * room.h) / room.w : SIDE;
	const part = shownPart(cam, room);
	const goTo = (e: React.PointerEvent) => {
		const r = map.current?.getBoundingClientRect();
		if (!r) return;
		move((c) => centerOn(c, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, room), room);
	};
	return (
		<div data-testid="mini-map" className="lh-fade absolute bottom-4 left-4 z-20 rounded-sm bg-ink p-1.5">
			<div
				ref={map}
				role="presentation"
				className="relative cursor-grab touch-none bg-background/15 active:cursor-grabbing"
				style={{ width: w, height: h }}
				onPointerDown={(e) => {
					e.currentTarget.setPointerCapture(e.pointerId);
					goTo(e);
				}}
				onPointerMove={(e) => {
					if (e.currentTarget.hasPointerCapture(e.pointerId)) goTo(e);
				}}
			>
				<div className="absolute bg-background" style={{ left: `${part.x * 100}%`, top: `${part.y * 100}%`, width: `${part.w * 100}%`, height: `${part.h * 100}%` }} />
			</div>
		</div>
	);
}

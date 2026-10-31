import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { MaximizeIcon, MinusIcon, PlusIcon } from "lucide-react";
import { fitGraphView, fitZoomFor, zoomedGraphView, type Viewport } from "@/components/pan-zoom";
import { Hint } from "@/components/ui/hint";

/**
 * The pan/zoom viewport wiring shared by the plan popup and the diagram
 * focus: fully zoomed out IS the fit (the math is in pan-zoom.ts), panning
 * locks at the floor, wheel zooms to the cursor. `box` is the content's
 * natural size; the first fit waits for `ready` (content to measure).
 */
export function usePanZoomViewport(box: { w: number; h: number }, ready: boolean) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	useEffect(() => {
		const el = viewportRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	const fitZoom = useMemo(() => fitZoomFor(box, size), [box, size]);

	const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
	const userAdjustedRef = useRef(false);
	const atFloor = view.zoom <= fitZoom + 1e-9;
	// The transition stays off until the FIRST fit has been applied, so the
	// content paints at the fit instead of flying in from top-left zoom:1.
	const [settled, setSettled] = useState(false);

	useEffect(() => {
		if (atFloor) userAdjustedRef.current = false;
	}, [atFloor]);
	useEffect(() => {
		if (userAdjustedRef.current || !size.w || !size.h || !ready) return;
		setView(fitGraphView(box, size, fitZoom));
		// Enable the transition only AFTER the fit has painted: flipping
		// settled in the same commit animates from the initial state.
		const raf = requestAnimationFrame(() => setSettled(true));
		return () => cancelAnimationFrame(raf);
	}, [fitZoom, size, box, ready]);

	useEffect(() => {
		const el = viewportRef.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
			const factor = Math.exp(-dy * 0.0015);
			const rect = el.getBoundingClientRect();
			setView((v) =>
				zoomedGraphView(v, factor, fitZoom, { x: e.clientX - rect.left, y: e.clientY - rect.top }, box, size),
			);
			userAdjustedRef.current = true;
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [fitZoom, box, size]);

	// Panning is per-frame: the caller turns the transform transition off
	// while `panning`, or it rubber-bands.
	const [panning, setPanning] = useState(false);
	const dragRef = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);
	const startDrag = (e: PointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return;
		if ((e.target as HTMLElement).closest("button")) return;
		if (atFloor) return;
		dragRef.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y, moved: false };
		setPanning(true);
		e.currentTarget.classList.add("cursor-grabbing");
		e.currentTarget.setPointerCapture(e.pointerId);
	};
	const moveDrag = (e: PointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (!d) return;
		d.moved = true;
		setView((v) =>
			v.zoom <= fitZoom + 1e-9 ? v : { ...v, x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) },
		);
	};
	const endDrag = (e: PointerEvent<HTMLDivElement>) => {
		const d = dragRef.current;
		if (d) {
			dragRef.current = null;
			if (d.moved) userAdjustedRef.current = true;
		}
		setPanning(false);
		e.currentTarget.classList.remove("cursor-grabbing");
	};
	const stepZoom = (factor: number) => {
		userAdjustedRef.current = true;
		setView((v) => zoomedGraphView(v, factor, fitZoom, { x: size.w / 2, y: size.h / 2 }, box, size));
	};
	const fitView = () => {
		userAdjustedRef.current = false;
		if (!size.w || !size.h) return;
		setView(fitGraphView(box, size, fitZoom));
	};

	return { viewportRef, view, atFloor, settled, panning, startDrag, moveDrag, endDrag, stepZoom, fitView };
}

const ZOOM_BUTTON =
	"lh-press pointer-events-auto flex size-7 items-center justify-center border border-border/70 bg-card/80 text-muted-foreground backdrop-blur hover:bg-accent hover:text-foreground";

/** The viewport's bottom bar: the pan hint and zoom out / fit / zoom in. */
export function ZoomControls({
	fitLabel,
	fitTestId,
	onStep,
	onFit,
}: {
	fitLabel: string;
	fitTestId?: string;
	onStep: (factor: number) => void;
	onFit: () => void;
}) {
	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-2">
			<span className="text-xs text-muted-foreground/60">Drag to pan · scroll to zoom</span>
			<div className="flex gap-1">
				<Hint label="Zoom out" side="bottom">
					<button type="button" aria-label="Zoom out" onClick={() => onStep(1 / 1.25)} className={ZOOM_BUTTON}>
						<MinusIcon className="size-3.5" />
					</button>
				</Hint>
				<Hint label={fitLabel} side="bottom">
					<button type="button" aria-label={fitLabel} onClick={onFit} data-testid={fitTestId} className={ZOOM_BUTTON}>
						<MaximizeIcon className="size-3.5" />
					</button>
				</Hint>
				<Hint label="Zoom in" side="bottom">
					<button type="button" aria-label="Zoom in" onClick={() => onStep(1.25)} className={ZOOM_BUTTON}>
						<PlusIcon className="size-3.5" />
					</button>
				</Hint>
			</div>
		</div>
	);
}

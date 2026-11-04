"use client";

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import type { SheetVersion } from "@/core";
import { cn } from "@/lib/utils";
import { artboards, bounds, fitCamera, onScreen, wheelCamera, zoomAt, zoomLabel, zoomStep, type Camera, type Rect } from "./canvas-model";
import { usePdfs } from "./pdf";
import { PdfPage } from "./pdf-page";

/** How long the view must stay still before pages are drawn again sharp. */
const SETTLE_MS = 150;
/** Dot grid spacing at 100%, and the closest the dots get on screen. */
const DOT = 24;
const DOT_MIN = 12;

/**
 * THE CANVAS: every kept version of the sheet laid out as artboards on a
 * dark dotted plane, newest on the left, each labeled with what was asked
 * for it. Drag to pan, scroll or swipe to pan, pinch or Ctrl/⌘ + scroll to
 * zoom toward the pointer, and the toolbar's −, percent (back to 100%), +
 * and Zoom to fit. It starts on the newest version and moves to each new
 * one. `inset` is the room the floating panel takes on the right.
 */
export function SheetCanvas({
	versions,
	pdfUrl,
	labelFor,
	inset,
}: {
	/** Oldest first, as the record keeps them. */
	versions: readonly SheetVersion[];
	pdfUrl: (n: number) => string;
	/** The line above a version's pages. */
	labelFor: (v: SheetVersion, newest: boolean) => string;
	inset: number;
}) {
	const groups = useMemo(() => artboards(versions), [versions]);
	const urls = useMemo(() => groups.map((g) => pdfUrl(g.n)), [groups, pdfUrl]);
	const docs = usePdfs(urls);
	const box = useRef<HTMLDivElement>(null);
	const [view, setView] = useState({ w: 0, h: 0 });
	const [cam, setCam] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
	const [settled, setSettled] = useState(cam);

	useLayoutEffect(() => {
		const el = box.current;
		if (!el) return;
		const read = () => setView({ w: el.clientWidth, h: el.clientHeight });
		read();
		const observer = new ResizeObserver(read);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		const t = setTimeout(() => setSettled(cam), SETTLE_MS);
		return () => clearTimeout(t);
	}, [cam]);

	// The newest version, in view whenever it changes (and at the start).
	const newest = groups[0];
	const sized = view.w > 0;
	const free: Rect = useMemo(() => ({ x: 0, y: 0, w: Math.max(1, view.w - inset), h: view.h }), [view.w, view.h, inset]);
	const fitTo = useCallback((r: Rect | null) => r && setCam(fitCamera(r, free)), [free]);
	const focused = useRef<number | null>(null);
	useEffect(() => {
		if (!sized || !newest || focused.current === newest.n) return;
		focused.current = newest.n;
		fitTo(newest.box);
	}, [sized, newest, fitTo]);

	// Wheel: a native listener, since React's is passive and can't stop the page zooming.
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const r = el.getBoundingClientRect();
			setCam((c) => wheelCamera(c, e, { x: e.clientX - r.left, y: e.clientY - r.top }));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	const drag = useRef<{ id: number; x: number; y: number } | null>(null);
	const [dragging, setDragging] = useState(false);
	const center = { x: free.w / 2, y: free.h / 2 };
	const zoomTo = (zoom: number) => setCam((c) => zoomAt(c, zoom, center));

	let dot = DOT * cam.zoom;
	while (dot < DOT_MIN) dot *= 2;

	return (
		<div
			ref={box}
			data-testid="cheat-sheet-canvas"
			className={cn("relative min-h-0 flex-1 touch-none overflow-hidden bg-panel select-none", dragging ? "cursor-grabbing" : "cursor-grab")}
			style={{
				backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1.2px)",
				backgroundSize: `${dot}px ${dot}px`,
				backgroundPosition: `${cam.x}px ${cam.y}px`,
			}}
			onPointerDown={(e) => {
				if (e.button !== 0 && e.button !== 1) return;
				e.currentTarget.setPointerCapture(e.pointerId);
				drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
				setDragging(true);
			}}
			onPointerMove={(e) => {
				const d = drag.current;
				if (!d || d.id !== e.pointerId) return;
				const dx = e.clientX - d.x;
				const dy = e.clientY - d.y;
				drag.current = { ...d, x: e.clientX, y: e.clientY };
				setCam((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
			}}
			onPointerUp={() => {
				drag.current = null;
				setDragging(false);
			}}
			onPointerCancel={() => {
				drag.current = null;
				setDragging(false);
			}}
		>
			<div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})` }}>
				{groups.flatMap((g) => g.pages.map((board) => <PdfPage key={`${board.n}-${board.page}`} doc={docs.get(pdfUrl(board.n))} board={board} cam={settled} view={view} />))}
			</div>
			{groups.map((g, i) => {
				const at = onScreen(cam, g.box);
				const v = versions.find((x) => x.n === g.n)!;
				return (
					<Fragment key={g.n}>
						<p
							data-testid="cheat-sheet-version"
							className={cn("pointer-events-none absolute truncate text-[12.5px]", i === 0 ? "font-bold text-ink" : "text-ink-2")}
							style={{ left: at.x, top: at.y - 46, width: Math.max(at.w, 160) }}
						>
							{labelFor(v, i === 0)}
						</p>
						{g.pages.map((board) => {
							const p = onScreen(cam, board);
							return (
								<p key={board.page} className="pointer-events-none absolute truncate text-[11.5px] text-ink-3" style={{ left: p.x, top: p.y - 22, width: Math.max(p.w, 40) }}>
									{board.label}
								</p>
							);
						})}
					</Fragment>
				);
			})}
			<div
				data-testid="cheat-sheet-zoom"
				className="absolute bottom-4 left-4 flex items-stretch bg-panel text-sm text-ink outline outline-1 -outline-offset-1 outline-tone-2"
				onPointerDown={(e) => e.stopPropagation()}
			>
				<ToolButton label="Zoom out" onClick={() => zoomTo(zoomStep(cam.zoom, -1))}>
					<MinusIcon className="size-4" aria-hidden />
				</ToolButton>
				<ToolButton label="Zoom to 100%" onClick={() => zoomTo(1)} className="w-[60px] justify-center font-mono tabular-nums">
					{zoomLabel(cam.zoom)}
				</ToolButton>
				<ToolButton label="Zoom in" onClick={() => zoomTo(zoomStep(cam.zoom, 1))}>
					<PlusIcon className="size-4" aria-hidden />
				</ToolButton>
				<ToolButton label="Zoom to fit" onClick={() => fitTo(bounds(groups.map((g) => g.box)))} className="gap-2 border-l border-tone-2 px-3">
					<ScanIcon className="size-4" aria-hidden />
					Zoom to fit
				</ToolButton>
			</div>
		</div>
	);
}

function ToolButton({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: React.ReactNode }) {
	return (
		<button type="button" aria-label={label} title={label} onClick={onClick} className={cn("lh-press flex h-9 items-center px-2.5 hover:bg-tone", className)}>
			{children}
		</button>
	);
}

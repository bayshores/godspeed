import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CrosshairIcon, MinusIcon, PlusIcon, ScanIcon } from "lucide-react";
import { pageCaption, type SheetVersion } from "@/shared/core";
import { cn } from "@/frontend/lib/utils";
import {
	artboards,
	bounds,
	fitCamera,
	fitWidthCamera,
	onScreen,
	pageAt,
	pageRegion,
	regionScale,
	toWorld,
	wheelCamera,
	zoomAt,
	zoomLabel,
	zoomStep,
	type Artboard,
	type Pointed,
	type Camera,
	type Rect,
} from "./canvas-model";
import { drawPage, usePdfs } from "./pdf";
import { PdfPage } from "./pdf-page";

/** How long the view must stay still before pages are drawn again sharp. */
const SETTLE_MS = 150;
/** Dot grid spacing at 100%, and the closest the dots get on screen. */
const DOT = 24;
const DOT_MIN = 12;
/** Room above the first page in a narrow view. */
const NARROW_TOP = 16;

/**
 * THE CANVAS: every kept version of the sheet laid out as artboards on a
 * dark dotted plane, newest on the left, each labeled. Drag to pan, scroll
 * or swipe to pan, pinch or Ctrl/⌘ + scroll to zoom toward the pointer,
 * and the toolbar's −, percent (back to 100%), +, Zoom to fit and Point at
 * the sheet: drag a box on a page and that part, drawn as a picture, goes
 * with the next message. It starts on the newest version and moves to each
 * new one, and to a version the chat asks for. `inset` is the room the
 * floating panel takes on the right; `narrow` (the sheet beside a session)
 * puts pages one under another, fits their width, leaves out the labels
 * (it shows one version) and keeps the toolbar in a row under the pages.
 */
export function SheetCanvas({
	versions,
	pdfUrl,
	labelFor,
	inset = 0,
	narrow = false,
	focus,
	onPoint,
}: {
	/** Oldest first, as the record keeps them. */
	versions: readonly SheetVersion[];
	pdfUrl: (n: number) => string;
	/** The line above a version's pages. */
	labelFor: (v: SheetVersion, newest: boolean) => string;
	inset?: number;
	narrow?: boolean;
	/** A version to show; a new `seq` shows it again. */
	focus?: { n: number; seq: number } | null;
	onPoint?: (pointed: Pointed) => void;
}) {
	const groups = useMemo(() => artboards(versions, narrow), [versions, narrow]);
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

	const sized = view.w > 0;
	const free: Rect = useMemo(
		() => (narrow ? { x: 0, y: NARROW_TOP, w: Math.max(1, view.w), h: Math.max(1, view.h - NARROW_TOP) } : { x: 0, y: 0, w: Math.max(1, view.w - inset), h: view.h }),
		[view.w, view.h, inset, narrow],
	);
	const fitTo = useCallback((r: Rect | null) => r && setCam(narrow ? fitWidthCamera(r, free) : fitCamera(r, free)), [free, narrow]);

	// The newest version, in view whenever it changes (and at the start).
	const newest = groups[0];
	const focused = useRef<number | null>(null);
	useEffect(() => {
		if (!sized || !newest || focused.current === newest.n) return;
		focused.current = newest.n;
		fitTo(newest.box);
	}, [sized, newest, fitTo]);
	// A version the chat asks for: each ask once.
	const shown = useRef<number | null>(null);
	useEffect(() => {
		if (!sized || !focus || shown.current === focus.seq) return;
		shown.current = focus.seq;
		fitTo(groups.find((g) => g.n === focus.n)?.box ?? null);
	}, [sized, focus, groups, fitTo]);

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
	const [pointing, setPointing] = useState(false);
	const [drawn, setDrawn] = useState<{ board: Artboard; a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
	const [pointError, setPointError] = useState<string | null>(null);
	const center = { x: free.x + free.w / 2, y: free.y + free.h / 2 };
	const zoomTo = (zoom: number) => setCam((c) => zoomAt(c, zoom, center));
	const local = (e: React.PointerEvent) => {
		const r = e.currentTarget.getBoundingClientRect();
		return toWorld(cam, { x: e.clientX - r.left, y: e.clientY - r.top });
	};

	/** The pointed-at part, drawn sharp from the PDF and handed on. */
	const point = (board: Artboard, a: { x: number; y: number }, b: { x: number; y: number }) => {
		const part = pageRegion(a, b, board);
		const doc = docs.get(pdfUrl(board.n));
		if (!part || !doc || doc === "failed") return;
		const w = part.w * board.w;
		const h = part.h * board.h;
		const scale = regionScale(w, h);
		void doc
			.getPage(board.page + 1)
			.then((page) => drawPage(page, { scale, width: w * scale, height: h * scale, offset: { x: part.x * board.w * scale, y: part.y * board.h * scale } }).done)
			.then((canvas) => {
				if (!canvas) return;
				const data = canvas.toDataURL("image/png");
				const caption = pageCaption(board.page, versions.find((v) => v.n === board.n)?.pages.length ?? 1);
				onPoint?.({
					region: { n: board.n, page: board.page + 1, ...part },
					picture: { name: `Version ${board.n}, ${caption}.png`, mimeType: "image/png", data: data.slice(data.indexOf(",") + 1) },
				});
				setPointing(false);
			})
			.catch((err: unknown) => {
				console.error("[cheat-sheet] couldn't draw the part pointed at:", err);
				setPointError("Couldn't draw that part. Try again.");
			});
	};

	let dot = DOT * cam.zoom;
	while (dot < DOT_MIN) dot *= 2;
	const drawnBox = drawn && onScreen(cam, bounds([{ ...drawn.a, w: 0, h: 0 }, { ...drawn.b, w: 0, h: 0 }])!);

	const tools = (
		<>
			<div data-testid="cheat-sheet-zoom" className="flex items-stretch bg-panel text-sm text-ink outline outline-1 -outline-offset-1 outline-tone-2">
				<ToolButton label="Zoom out" onClick={() => zoomTo(zoomStep(cam.zoom, -1))}>
					<MinusIcon className="size-4" aria-hidden />
				</ToolButton>
				<ToolButton label="Zoom to 100%" onClick={() => zoomTo(1)} className="w-[60px] justify-center tabular-nums">
					{zoomLabel(cam.zoom)}
				</ToolButton>
				<ToolButton label="Zoom in" onClick={() => zoomTo(zoomStep(cam.zoom, 1))}>
					<PlusIcon className="size-4" aria-hidden />
				</ToolButton>
				<ToolButton label="Zoom to fit" onClick={() => fitTo(narrow ? (newest?.box ?? null) : bounds(groups.map((g) => g.box)))} className="gap-2 border-l border-tone-2 px-3">
					<ScanIcon className="size-4" aria-hidden />
					{!narrow && "Zoom to fit"}
				</ToolButton>
			</div>
			{onPoint && (
				<button
					type="button"
					data-testid="cheat-sheet-point"
					aria-pressed={pointing}
					onClick={() => {
						setPointError(null);
						setPointing((p) => !p);
					}}
					className={cn(
						"lh-press flex h-9 items-center gap-2 px-3 text-sm outline outline-1 -outline-offset-1",
						pointing ? "bg-ink text-background outline-ink" : "bg-panel text-ink outline-tone-2 hover:bg-tone",
					)}
				>
					<CrosshairIcon className="size-4" aria-hidden />
					Point at the sheet
				</button>
			)}
		</>
	);

	const canvas = (
		<div
			ref={box}
			data-testid="cheat-sheet-canvas"
			className={cn("relative min-h-0 flex-1 touch-none overflow-hidden bg-panel select-none", pointing ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-grab")}
			style={{
				backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1.2px)",
				backgroundSize: `${dot}px ${dot}px`,
				backgroundPosition: `${cam.x}px ${cam.y}px`,
			}}
			onPointerDown={(e) => {
				if (e.button !== 0 && e.button !== 1) return;
				e.currentTarget.setPointerCapture(e.pointerId);
				if (pointing && e.button === 0) {
					const at = local(e);
					const board = pageAt(groups.flatMap((g) => g.pages), at);
					setPointError(board ? null : "Start the box on a page.");
					if (board) setDrawn({ board, a: at, b: at });
					return;
				}
				drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
				setDragging(true);
			}}
			onPointerMove={(e) => {
				if (drawn) {
					const b = local(e);
					setDrawn((d) => d && { ...d, b });
					return;
				}
				const d = drag.current;
				if (!d || d.id !== e.pointerId) return;
				const dx = e.clientX - d.x;
				const dy = e.clientY - d.y;
				drag.current = { ...d, x: e.clientX, y: e.clientY };
				setCam((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
			}}
			onPointerUp={() => {
				if (drawn) {
					point(drawn.board, drawn.a, drawn.b);
					setDrawn(null);
				}
				drag.current = null;
				setDragging(false);
			}}
			onPointerCancel={() => {
				setDrawn(null);
				drag.current = null;
				setDragging(false);
			}}
		>
			<div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})` }}>
				{groups.flatMap((g) => g.pages.map((board) => <PdfPage key={`${board.n}-${board.page}`} doc={docs.get(pdfUrl(board.n))} board={board} cam={settled} view={view} />))}
			</div>
			{!narrow && groups.map((g, i) => {
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
			{drawnBox && <div data-testid="cheat-sheet-pointing-box" className="pointer-events-none absolute bg-ink/10 outline-2 outline-ink" style={{ left: drawnBox.x, top: drawnBox.y, width: drawnBox.w, height: drawnBox.h }} />}
			{pointing && (
				<div
					data-testid="cheat-sheet-pointing"
					className="absolute top-3 left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-3 bg-ink px-3.5 py-2 text-[13px] text-background"
					onPointerDown={(e) => e.stopPropagation()}
				>
					<span className="min-w-0 truncate">{pointError ?? "Drag a box around the part you mean"}</span>
					<button type="button" onClick={() => setPointing(false)} className="lh-press shrink-0 font-bold underline underline-offset-2">
						Cancel
					</button>
				</div>
			)}
			{!narrow && (
				<div className="absolute bottom-4 left-4 flex max-w-[calc(100%-32px)] flex-wrap items-end gap-2" onPointerDown={(e) => e.stopPropagation()}>
					{tools}
				</div>
			)}
		</div>
	);
	if (!narrow) return canvas;
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{canvas}
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-tone-2 px-3 py-2">{tools}</div>
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

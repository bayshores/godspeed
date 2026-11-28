import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { pageCaption, type SheetVersion } from "@/shared/core";
import { ownWheel } from "@/frontend/lib/own-wheel";
import { cn } from "@/frontend/lib/utils";
import { KEY_ON_INK } from "@/frontend/components/ui/card-parts";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import {
	artboards,
	bounds,
	fitCamera,
	fitWidthCamera,
	onScreen,
	pageAt,
	pageRegion,
	regionScale,
	stacksPages,
	toWorld,
	wheelCamera,
	zoomStep,
	type Artboard,
	type Pointed,
	type Rect,
} from "./canvas-model";
import { zoomAt, zoomLabel, type Camera } from "@/frontend/lib/camera";
import { drawPage, usePdfs } from "./pdf";
import { PdfPage } from "./pdf-page";

/** How long the view must stay still before pages are drawn again sharp. */
const SETTLE_MS = 150;
/** Dot grid spacing at 100% (the page's own), and the closest the dots get on screen. */
const DOT = 16;
const DOT_MIN = 12;
/** Room the toolbar takes at the foot of a wide canvas, kept clear when fitting. */
const TOOLS_ROOM = 58;
/** Room above the first page where pages stack: beside a session, and under a version's label. */
const NARROW_TOP = 16;
const LABELED_TOP = 24;

/**
 * THE CANVAS: every kept version of the sheet laid out as artboards on a
 * dotted plane, newest on the left, each labeled, its pages captioned. Drag to pan, scroll
 * or swipe to pan, pinch or Ctrl/⌘ + scroll to zoom toward the pointer,
 * and the toolbar's −, percent (back to 100%), +, Fit and Point at
 * the sheet: drag a box on a page and that part, drawn as a picture, goes
 * with the next message. It starts on the newest version and moves to each
 * new one, and to a version the chat asks for, and stays fitted to it
 * through a resize until the learner moves the view. A canvas with no room
 * for pages side by side puts them one under another, fits their width and
 * keeps the toolbar in a row under them; `narrow` (the sheet beside a
 * session) is always so, and leaves out the labels (it shows one version).
 */
export function SheetCanvas({
	versions,
	pdfUrl,
	labelFor,
	narrow = false,
	foot,
	paper,
	focus,
	onPoint,
}: {
	/** Oldest first, as the record keeps them. */
	versions: readonly SheetVersion[];
	pdfUrl: (n: number) => string;
	/** The line above a version's pages. */
	labelFor: (v: SheetVersion, newest: boolean) => string;
	narrow?: boolean;
	/** A row under the toolbar in the narrow foot. */
	foot?: ReactNode;
	/** The current sheet's paper, said after the keys: "Letter, front and back". */
	paper?: string;
	/** A version to show; a new `seq` shows it again. */
	focus?: { n: number; seq: number } | null;
	onPoint?: (pointed: Pointed) => void;
}) {
	const box = useRef<HTMLDivElement>(null);
	const [view, setView] = useState({ w: 0, h: 0 });
	const stacked = narrow || stacksPages(view.w);
	const groups = useMemo(() => artboards(versions, stacked), [versions, stacked]);
	const urls = useMemo(() => groups.map((g) => pdfUrl(g.n)), [groups, pdfUrl]);
	const docs = usePdfs(urls);
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
	const top = stacked ? (narrow ? NARROW_TOP : LABELED_TOP) : 0;
	const free: Rect = useMemo(
		() => ({ x: 0, y: top, w: Math.max(1, view.w), h: Math.max(1, view.h - top - (stacked ? 0 : TOOLS_ROOM)) }),
		[view.w, view.h, top, stacked],
	);
	// What the view is fitted to (a version, or all of them) until the learner moves it.
	const fitted = useRef<number | "all" | null>(null);
	const camFor = useCallback(
		(what: number | "all") => {
			const r = what === "all" ? bounds(groups.map((g) => g.box)) : (groups.find((g) => g.n === what)?.box ?? null);
			return r && (stacked ? fitWidthCamera(r, free) : fitCamera(r, free));
		},
		[groups, free, stacked],
	);
	const fitTo = useCallback(
		(what: number | "all") => {
			const to = camFor(what);
			if (!to) return;
			fitted.current = what;
			setCam(to);
		},
		[camFor],
	);
	/** The learner's own move: the view is theirs from here. */
	const move = useCallback((to: (c: Camera) => Camera) => {
		fitted.current = null;
		setCam(to);
	}, []);
	// A resized canvas fits it again.
	useEffect(() => {
		const to = fitted.current !== null && camFor(fitted.current);
		if (to) setCam(to);
	}, [camFor]);

	// The newest version, in view whenever it changes (and at the start).
	const newest = groups[0];
	const focused = useRef<number | null>(null);
	useEffect(() => {
		if (!sized || !newest || focused.current === newest.n) return;
		focused.current = newest.n;
		fitTo(newest.n);
	}, [sized, newest, fitTo]);
	// A version the chat asks for: each ask once.
	const shown = useRef<number | null>(null);
	useEffect(() => {
		if (!sized || !focus || shown.current === focus.seq) return;
		shown.current = focus.seq;
		fitTo(focus.n);
	}, [sized, focus, fitTo]);

	useEffect(() => {
		const el = box.current;
		if (!el) return;
		return ownWheel(el, (e) => {
			e.preventDefault();
			const r = el.getBoundingClientRect();
			move((c) => wheelCamera(c, e, { x: e.clientX - r.left, y: e.clientY - r.top }));
		});
	}, [move]);

	const drag = useRef<{ id: number; x: number; y: number } | null>(null);
	const [dragging, setDragging] = useState(false);
	const [pointing, setPointing] = useState(false);
	const [drawn, setDrawn] = useState<{ board: Artboard; a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
	const [pointError, setPointError] = useState<string | null>(null);
	const center = { x: free.x + free.w / 2, y: free.y + free.h / 2 };
	const zoomTo = (zoom: number) => move((c) => zoomAt(c, zoom, center));
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
			<div data-testid="cheat-sheet-zoom" className="flex items-center gap-2">
				<ToolButton label="Zoom out" onClick={() => zoomTo(zoomStep(cam.zoom, -1))} className="px-2.5">
					<PixelIcon name="minus" />
				</ToolButton>
				<ToolButton label="Zoom to 100%" onClick={() => zoomTo(1)} className="w-[66px] justify-center tabular-nums">
					{zoomLabel(cam.zoom)}
				</ToolButton>
				<ToolButton label="Zoom in" onClick={() => zoomTo(zoomStep(cam.zoom, 1))} className="px-2.5">
					<PixelIcon name="plus" />
				</ToolButton>
				<ToolButton label="Zoom to fit" onClick={() => fitTo(stacked && newest ? newest.n : "all")}>
					Fit
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
					className={cn("lh-btn", pointing && "lh-btn-main")}
				>
					Point at the sheet
				</button>
			)}
			{paper && (
				<span data-testid="cheat-sheet-status" className="px-1.5 text-ui text-ink-2">
					{paper}
				</span>
			)}
		</>
	);

	const canvas = (
		<div
			ref={box}
			data-testid="cheat-sheet-canvas"
			className={cn("relative min-h-0 flex-1 touch-none overflow-hidden bg-background select-none", pointing ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-grab")}
			style={{
				backgroundImage: "radial-gradient(color-mix(in oklab, var(--foreground) 10%, transparent) 1px, transparent 1px)",
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
				move((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
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
			{/* What the learner pans: a part out of view is not lost. */}
			<div data-pans="" className="absolute inset-0 overflow-hidden">
				<div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})` }}>
					{groups.flatMap((g) => g.pages.map((board) => <PdfPage key={`${board.n}-${board.page}`} doc={docs.get(pdfUrl(board.n))} board={board} cam={settled} view={view} />))}
				</div>
				{!narrow && groups.map((g, i) => {
					const at = onScreen(cam, g.box);
					const v = versions.find((x) => x.n === g.n)!;
					// A label is as wide as its pages (a small page still names its version) and ends before the next version's.
					const next = groups[i + 1];
					const room = Math.min(Math.max(at.w, 160), next ? onScreen(cam, next.box).x - at.x - 16 : Infinity);
					return (
						<Fragment key={g.n}>
							<p
								data-testid="cheat-sheet-version"
								className={cn("pointer-events-none absolute truncate text-base leading-5", i === 0 ? "font-medium text-ink" : "text-ink-2")}
								style={{ left: at.x, top: at.y - 30, maxWidth: Math.max(room, 0) }}
							>
								{labelFor(v, i === 0)}
							</p>
							{g.pages.map((board) => {
								const p = onScreen(cam, board);
								return (
									<p key={board.page} className="pointer-events-none absolute truncate text-base leading-5 text-ink-2" style={{ left: p.x, top: p.y + p.h + 6, width: Math.max(p.w, 40) }}>
										{board.label}
									</p>
								);
							})}
						</Fragment>
					);
				})}
			</div>
			{drawnBox && <div data-testid="cheat-sheet-pointing-box" className="pointer-events-none absolute bg-highlight/55 outline-2 outline-ink" style={{ left: drawnBox.x, top: drawnBox.y, width: drawnBox.w, height: drawnBox.h }} />}
			{pointing && (
				<div
					data-testid="cheat-sheet-pointing"
					className="absolute top-3.5 left-1/2 flex max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-4 rounded bg-ink py-2 pr-2.5 pl-[18px] text-ui text-background"
					onPointerDown={(e) => e.stopPropagation()}
				>
					<span className="min-w-0 truncate">{pointError ?? "Drag a box around the part you mean"}</span>
					<button type="button" onClick={() => setPointing(false)} className={cn("lh-btn lh-btn-small shrink-0 font-medium text-background", KEY_ON_INK)}>
						Cancel
					</button>
				</div>
			)}
			{!stacked && (
				<div className="absolute bottom-6 left-6 flex max-w-[calc(100%-48px)] flex-wrap items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
					{tools}
				</div>
			)}
		</div>
	);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{canvas}
			{stacked && (
				<div className="flex shrink-0 flex-wrap items-center gap-2 bg-background px-4 pt-2.5 pb-4">
					{tools}
					{foot}
				</div>
			)}
		</div>
	);
}

function ToolButton({ label, onClick, className, children }: { label: string; onClick: () => void; className?: string; children: React.ReactNode }) {
	return (
		<button type="button" aria-label={label} title={label} onClick={onClick} className={cn("lh-btn", className)}>
			{children}
		</button>
	);
}

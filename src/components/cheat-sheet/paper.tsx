"use client";

import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import katex from "katex";
import {
	PAPERS,
	STATUS_COLOR,
	TEXT_SIZES,
	WATCH_OUT,
	columnHeightIn,
	headerHeightIn,
	lineLeading,
	packBlocks,
	sheetText,
	type CheatSheet,
	type Packing,
	type SheetPiece,
	type TopicStatus,
} from "@/core";
import { cn } from "@/lib/utils";

/**
 * THE PAPER: the cheat sheet at its real size in CSS inches, shown scaled
 * to fit the studio and printed unscaled. Every block is measured once in
 * a hidden column of the real width, then packed into columns (core
 * packBlocks), so what the meter says is what prints. Blocks that don't
 * fit hang below the paper, tinted.
 */

/** CSS pixels per inch. */
const IN = 96;
/** Space between two sides on screen. */
const SIDE_GAP = 24;

/** One block on the paper: a real block, or the outline of one the agent is writing. */
export interface PaperItem {
	id: string;
	topicId: string;
	title: string;
	body: string;
	/** Not written yet: a gray outline. */
	pending?: true;
}

/** Where a block sits, in screen pixels from the top of the first side. */
export interface PaperSpot {
	id: string;
	side: number;
	column: number;
	y: number;
	height: number;
	over: boolean;
}

export interface PaperLayout {
	packing: Packing;
	/** Measured heights (paper pixels), by block id. */
	heights: Map<string, number>;
	spots: PaperSpot[];
	/** One line of text, in paper pixels. */
	lineHeight: number;
}

interface PaperGeometry {
	width: number;
	height: number;
	sides: number;
	margin: number;
	header: number;
	gutter: number;
	columnWidth: number;
	columnHeight: number;
	fontPx: number;
	leading: number;
	gap: number;
}

export function paperGeometry(sheet: Pick<CheatSheet, "rules" | "prefs">): PaperGeometry {
	const p = PAPERS[sheet.rules.paper];
	const card = sheet.rules.paper === "index-card";
	const width = p.widthIn * IN;
	const margin = p.marginIn * IN;
	const gutter = (card ? 0.1 : 0.2) * IN;
	const cols = sheet.prefs.columns;
	const fontPx = (TEXT_SIZES[sheet.prefs.textSize].pt * IN) / 72;
	return {
		width,
		height: p.heightIn * IN,
		sides: p.sides,
		margin,
		header: headerHeightIn(sheet.rules.paper) * IN,
		gutter,
		columnWidth: (width - 2 * margin - (cols - 1) * gutter) / cols,
		columnHeight: columnHeightIn(sheet.rules.paper) * IN,
		fontPx,
		leading: lineLeading(sheet.rules.writing),
		gap: fontPx * 0.7,
	};
}

export function Paper({
	sheet,
	items,
	title,
	subtitle,
	status,
	scale,
	selected,
	busyIds,
	onSelect,
	onMove,
	onLayout,
}: {
	sheet: Pick<CheatSheet, "rules" | "prefs">;
	items: readonly PaperItem[];
	/** "CSE 21 Midterm". */
	title: string;
	/** "Wed Nov 4 · one letter page, one side". */
	subtitle: string;
	status: ReadonlyMap<string, TopicStatus>;
	scale: number;
	selected: string | null;
	/** Blocks the agent is rewriting. */
	busyIds: ReadonlySet<string>;
	onSelect: (id: string | null) => void;
	onMove: (id: string, before: string) => void;
	onLayout: (layout: PaperLayout) => void;
}) {
	const g = useMemo(() => paperGeometry(sheet), [sheet]);
	const measurer = useRef<HTMLDivElement>(null);
	const [heights, setHeights] = useState<Map<string, number> | null>(null);
	const [dragOver, setDragOver] = useState<string | null>(null);
	const color = sheet.prefs.ink === "color";

	// Measure every block at the column's width: again when the blocks or
	// the size change, and once the fonts have loaded.
	useLayoutEffect(() => {
		const measure = () => {
			const box = measurer.current;
			if (!box) return;
			const next = new Map<string, number>();
			for (const el of box.querySelectorAll<HTMLElement>("[data-measure]")) next.set(el.dataset.measure!, el.getBoundingClientRect().height);
			setHeights(next);
		};
		measure();
		let live = true;
		void document.fonts?.ready.then(() => {
			if (live) measure();
		});
		return () => {
			live = false;
		};
	}, [items, g, color]);

	const layout = useMemo(() => {
		if (!heights) return null;
		const list = items.map((i) => heights.get(i.id) ?? 0);
		const packing = packBlocks(list, { columnHeight: g.columnHeight, columns: sheet.prefs.columns, sides: g.sides, gap: g.gap });
		const spots: PaperSpot[] = packing.placements.map((p, i) => ({
			id: items[i]!.id,
			side: p.side,
			column: p.column,
			y: p.side * (g.height * scale + SIDE_GAP) + (g.margin + g.header + p.top) * scale,
			height: list[i]! * scale,
			over: p.over,
		}));
		return { packing, heights, spots, lineHeight: g.fontPx * g.leading };
	}, [heights, items, g, sheet.prefs.columns, scale]);

	useLayoutEffect(() => {
		if (layout) onLayout(layout);
	}, [layout, onLayout]);

	const base: CSSProperties = { fontSize: g.fontPx, lineHeight: g.leading };
	const block = (item: PaperItem) => <SheetBlock item={item} status={status.get(item.topicId)} color={color} />;

	return (
		<>
			<div className="lh-print-sheet flex flex-col" style={{ gap: SIDE_GAP }}>
				{Array.from({ length: g.sides }, (_, side) => (
					<div key={side} className="lh-sheet-slot relative shrink-0" style={{ width: g.width * scale, height: g.height * scale }}>
						<div
							data-testid="sheet-side"
							className="lh-sheet lh-sheet-side absolute top-0 left-0 bg-white text-black"
							style={{ ...base, width: g.width, height: g.height, transform: `scale(${scale})`, transformOrigin: "top left" }}
							onClick={() => onSelect(null)}
						>
							<div
								className="absolute flex items-baseline justify-between gap-4 border-b border-black"
								style={{ left: g.margin, right: g.margin, top: g.margin, height: g.header - g.fontPx * 0.5 }}
							>
								<span className="font-title font-bold" style={{ fontSize: g.fontPx * 1.45 }}>
									{side === 0 ? title : `${title}, side 2`}
								</span>
								<span className="font-prose italic" style={{ fontSize: g.fontPx * 0.8 }}>
									{subtitle}
								</span>
							</div>
							{layout &&
								items.map((item, i) => {
									const p = layout.packing.placements[i]!;
									if (p.side !== side) return null;
									return (
										<div
											key={item.id}
											data-testid="sheet-block"
											data-over={p.over || undefined}
											className={cn(
												"absolute cursor-pointer",
												p.over && "bg-[color-mix(in_oklab,var(--lh-ramp-1)_14%,white)]",
												selected === item.id && "outline outline-1 outline-offset-2 outline-black",
												dragOver === item.id && "shadow-[0_-2px_0_#000]",
												busyIds.has(item.id) && "animate-pulse opacity-40",
											)}
											style={{ left: g.margin + p.column * (g.columnWidth + g.gutter), top: g.margin + g.header + p.top, width: g.columnWidth }}
											onClick={(e) => {
												e.stopPropagation();
												if (!item.pending) onSelect(selected === item.id ? null : item.id);
											}}
											onDragOver={(e) => {
												if (item.pending) return;
												e.preventDefault();
												setDragOver(item.id);
											}}
											onDragLeave={() => setDragOver(null)}
											onDrop={(e) => {
												e.preventDefault();
												setDragOver(null);
												const id = e.dataTransfer.getData("text/x-sheet-block");
												if (id && id !== item.id) onMove(id, item.id);
											}}
										>
											{block(item)}
										</div>
									);
								})}
						</div>
					</div>
				))}
			</div>
			{/* The measuring column: the real width, never seen. */}
			<div ref={measurer} aria-hidden className="lh-sheet pointer-events-none fixed top-0 -left-[9999px] invisible bg-white text-black" style={{ ...base, width: g.columnWidth }}>
				{items.map((item) => (
					<div key={item.id} data-measure={item.id}>
						{block(item)}
					</div>
				))}
			</div>
		</>
	);
}

/** One block: its title, then its lines. Watch out is boxed; in color,
 *  a bar in its topic's readiness color. */
const SheetBlock = memo(function SheetBlock({ item, status, color }: { item: PaperItem; status: TopicStatus | undefined; color: boolean }) {
	const watch = item.topicId === WATCH_OUT;
	const bar = color ? (watch ? STATUS_COLOR.weak : status ? STATUS_COLOR[status] : undefined) : undefined;
	if (item.pending)
		return (
			<div className="flex flex-col gap-[0.35em] pb-[0.2em]">
				<p className="font-title font-bold text-black/30" style={{ fontSize: "1.08em" }}>
					{item.title}
				</p>
				<span className="h-[0.55em] w-[88%] bg-black/10" />
				<span className="h-[0.55em] w-[64%] bg-black/10" />
				<span className="h-[0.55em] w-full bg-black/10" />
			</div>
		);
	return (
		<div className={cn(watch && "border border-black px-[0.5em] py-[0.3em]")} style={bar ? { borderLeft: `3px solid ${bar}`, paddingLeft: "0.5em" } : undefined}>
			<p className="font-title font-bold" style={{ fontSize: "1.08em" }}>
				{item.title}
			</p>
			<SheetLines body={item.body} />
		</div>
	);
});

function Pieces({ pieces }: { pieces: readonly SheetPiece[] }) {
	return pieces.map((p, i) =>
		p.kind === "math" ? (
			// KaTeX from the agent's own text (throwOnError off), with its MathML.
			<span key={i} dangerouslySetInnerHTML={{ __html: katex.renderToString(p.tex, { throwOnError: false }) }} />
		) : p.bold ? (
			<strong key={i} className="font-bold">
				{p.text}
			</strong>
		) : (
			<span key={i}>{p.text}</span>
		),
	);
}

/** A block's body, line by line. */
export const SheetLines = memo(function SheetLines({ body }: { body: string }) {
	const lines = useMemo(() => sheetText(body), [body]);
	return (
		<div className="font-prose">
			{lines.map((line, i) =>
				line.kind === "display" ? (
					<div key={i} className="lh-sheet-display" dangerouslySetInnerHTML={{ __html: katex.renderToString(line.tex, { throwOnError: false, displayMode: true }) }} />
				) : line.kind === "text" ? (
					<p key={i}>
						<Pieces pieces={line.pieces} />
					</p>
				) : (
					<p key={i} className="flex gap-[0.4em]">
						<span className="shrink-0">{line.marker ?? "•"}</span>
						<span>
							<Pieces pieces={line.pieces} />
						</span>
					</p>
				),
			)}
		</div>
	);
});

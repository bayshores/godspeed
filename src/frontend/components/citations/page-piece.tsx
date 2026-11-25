import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { useAppearance } from "@/frontend/components/settings/appearance";
import { useElementWidth } from "@/frontend/lib/use-element-width";
import { cn } from "@/frontend/lib/utils";
import type { ProblemPiece } from "@/shared/core";
import { PageMarks } from "./page-excerpt";
import { markBox, partAspect, partSrc, pieceSheet, pieceWidth } from "./page-piece-model";
import { SteadyImg } from "./steady-img";
import { useLookFade } from "./use-look-fade";

const pct = (n: number) => `${n * 100}%`;

/**
 * A problem as its file prints it, on one sheet: each stretch of a page cut out and stacked with
 * no gap, a line of the page above and under it, drawn in the theme's ink straight on the sheet
 * (or as printed, one sheet of the page's white paper). Its words stay in the page for screen
 * readers. The problem's own lines carry the highlighter's bar in the margin; the lines around it
 * and the labelled parts the learner is not on are veiled in the color under them. Where the part
 * he is on starts is marked data-part-current and told to `onPlace`, for the page or box around
 * it to rest there. A picture that does not load gives way to the words. A drawn picture never
 * goes blank when its column changes width: it is asked for again only once the column is wider
 * than it has been, and keeps showing while that loads.
 */
export function PagePiece({
	piece,
	text,
	quiet = false,
	part = null,
	printed = false,
	onPlace,
	onFail,
}: {
	piece: ProblemPiece;
	text: string;
	quiet?: boolean;
	part?: string | null;
	printed?: boolean;
	/** Told where the part the learner is on starts: as the piece is first drawn, and each time the learner moves on to another part (`moved`). */
	onPlace?: (start: HTMLElement, moved: boolean) => void;
	/** Told once the words stand in for a picture that did not load. */
	onFail?: () => void;
}) {
	const { bodyInk } = useAppearance();
	const [width, boxRef] = useElementWidth<HTMLDivElement>(0);
	// Turned to the page as printed and back, the sheet cross-fades.
	useLookFade(boxRef, printed);
	const widest = useRef(0);
	widest.current = Math.max(widest.current, width);
	// A failure belongs to the piece that had it, not to the next one this component draws.
	const key = JSON.stringify(piece);
	const [failedKey, setFailedKey] = useState<string | null>(null);
	const { piece: sheet, veiled, lit, edges, current } = useMemo(() => pieceSheet(piece, part), [piece, part]);
	const anchorRef = useRef<HTMLSpanElement>(null);
	// Keyed on the place, not the object: a caller that rebuilds the piece must not scroll again.
	const place = current && `${current.part}:${current.at}`;
	const onPlaceRef = useRef(onPlace);
	onPlaceRef.current = onPlace;
	const placed = useRef(false);
	// Before the piece is first drawn, so it opens resting on its part.
	useLayoutEffect(() => {
		if (anchorRef.current) onPlaceRef.current?.(anchorRef.current, placed.current);
		placed.current = true;
	}, [place]);
	if (failedKey === key) {
		return text ? (
			<ToolContentResponse>{text}</ToolContentResponse>
		) : (
			<p data-testid="page-piece-failed" className="text-[15px] text-ink-2">
				The page could not be loaded.
			</p>
		);
	}
	const asked = pieceWidth(widest.current, window.devicePixelRatio || 1);
	return (
		<div ref={boxRef} data-testid="page-piece" data-picture="" className={cn("relative flex w-full flex-col", quiet && "opacity-60", printed && "lh-printed")}>
			<span className="sr-only">{text}</span>
			{sheet.parts.map((p, i) => {
				const mark = markBox(sheet, i);
				return (
					<div key={i} className="relative w-full" style={{ aspectRatio: partAspect(p) }}>
						{widest.current > 0 && (
							<SteadyImg
								// A new piece starts afresh; the same piece keeps its picture while a new one loads.
								key={`${key}:${i}`}
								src={partSrc(piece.fileId, p, asked, printed ? null : bodyInk)}
								alt=""
								onFail={() => {
									setFailedKey(key);
									onFail?.();
								}}
							/>
						)}
						{mark && <PageMarks boxes={[mark]} />}
						{veiled[i]!.map((band, k) => (
							<span key={k} aria-hidden data-testid="piece-veil" className={cn("absolute inset-x-0 opacity-55", printed ? "bg-white" : "bg-(--lh-sheet)")} style={{ top: pct(band.top), height: pct(band.height) }} />
						))}
						{edges[i]!.map(
							(band, k) =>
								band && <span key={k} aria-hidden data-testid="piece-edge" className={cn("absolute inset-x-0 from-(--lh-edge) to-transparent", k === 0 ? "bg-linear-to-b" : "bg-linear-to-t", printed ? "[--lh-edge:white]" : "[--lh-edge:var(--lh-sheet)]")} style={{ top: pct(band.top), height: pct(band.height) }} />,
						)}
						{lit[i]!.map((band, k) => (
							<span key={k} aria-hidden data-testid="piece-bar" className="lh-read-mark lh-read-mark-still absolute left-0 w-1.5" style={{ top: pct(band.top), height: pct(band.height) }} />
						))}
						{current?.part === i && <span ref={anchorRef} aria-hidden data-part-current="" className="absolute inset-x-0 h-0" style={{ top: pct(current.at) }} />}
					</div>
				);
			})}
		</div>
	);
}

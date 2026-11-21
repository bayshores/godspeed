import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ToolContentResponse } from "@/frontend/components/ai-elements/message";
import { useAppearance } from "@/frontend/components/settings/appearance";
import { useElementWidth } from "@/frontend/lib/use-element-width";
import { cn } from "@/frontend/lib/utils";
import type { ProblemPiece } from "@/shared/core";
import { PageMarks } from "./page-excerpt";
import { markBox, partAspect, partSrc, pieceWidth, veils } from "./page-piece-model";
import { SteadyImg } from "./steady-img";

const pct = (n: number) => `${n * 100}%`;

/**
 * A problem as its file prints it: each stretch of a page cut out and stacked, drawn in the
 * theme's ink straight on the sheet (or on white, as printed). Its words stay in the page for
 * screen readers. The part the learner is on stays clear while the other labelled parts are
 * veiled in the color under them; where that part starts is marked data-part-current and told
 * to `onPlace`, for the page or box around it to rest there. A picture that does not load gives
 * way to the words. A drawn picture never goes blank when its column changes width: it is asked
 * for again only once the column is wider than it has been, and keeps showing while that loads.
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
	const widest = useRef(0);
	widest.current = Math.max(widest.current, width);
	// A failure belongs to the piece that had it, not to the next one this component draws.
	const key = JSON.stringify(piece);
	const [failedKey, setFailedKey] = useState<string | null>(null);
	const { bands, current } = useMemo(() => veils(piece, part), [piece, part]);
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
		<div ref={boxRef} data-testid="page-piece" data-picture="" className={cn("relative flex w-full flex-col gap-2", quiet && "opacity-60")}>
			<span className="sr-only">{text}</span>
			{piece.parts.map((p, i) => {
				const mark = markBox(piece, i);
				return (
					<div key={i} className={cn("relative w-full", printed && "bg-white")} style={{ aspectRatio: partAspect(p) }}>
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
						{bands[i]!.map((band, k) => (
							<span key={k} aria-hidden data-testid="piece-veil" className={cn("absolute inset-x-0 opacity-55", printed ? "bg-white" : "bg-(--lh-sheet)")} style={{ top: pct(band.top), height: pct(band.height) }} />
						))}
						{current?.part === i && <span ref={anchorRef} aria-hidden data-part-current="" className="absolute inset-x-0 h-0" style={{ top: pct(current.at) }} />}
					</div>
				);
			})}
		</div>
	);
}

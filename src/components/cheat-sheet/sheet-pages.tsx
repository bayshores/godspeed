"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PX_PER_IN, runsOver, sheetPageDocument, type CheatSheetDoc } from "@/core";
import { cn } from "@/lib/utils";
import { CAPTION, PAGE_GAP, pageCaption, pagesLayout } from "./sheet-pages-model";

/**
 * THE PAGES: each page of the agent's sheet in a sandboxed frame at its
 * true size (no scripts; same origin only so the studio can measure it),
 * scaled to fit the stage and printed unscaled, one sheet of paper each.
 * A page whose content runs past its edges is outlined and reported.
 */
export function SheetPages({ doc, onOverflow }: { doc: CheatSheetDoc; onOverflow: (pages: number[]) => void }) {
	const stage = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ w: 1000, h: 800 });
	useLayoutEffect(() => {
		const el = stage.current;
		if (!el) return;
		const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
		read();
		const observer = new ResizeObserver(read);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const pageW = doc.widthIn * PX_PER_IN;
	const pageH = doc.heightIn * PX_PER_IN;
	const { scale, perRow } = pagesLayout({ stageW: size.w, stageH: size.h, pageW, pageH, pages: doc.pages.length });
	const sources = useMemo(() => doc.pages.map((_, i) => sheetPageDocument(doc, i)), [doc]);

	// Measured per page source, so a new sheet never shows the old one's fit.
	const [over, setOver] = useState<ReadonlyMap<string, boolean>>(new Map());
	const overPages = useMemo(() => sources.flatMap((s, i) => (over.get(s) ? [i + 1] : [])), [sources, over]);
	const key = overPages.join(",");
	useEffect(() => onOverflow(key ? key.split(",").map(Number) : []), [key, onOverflow]);

	const measure = (source: string, frame: HTMLIFrameElement) => {
		const page = frame.contentDocument;
		if (!page) return;
		const check = () => {
			const html = page.documentElement;
			const body = page.body;
			const result = runsOver({
				scrollWidth: Math.max(html.scrollWidth, body?.scrollWidth ?? 0),
				scrollHeight: Math.max(html.scrollHeight, body?.scrollHeight ?? 0),
				clientWidth: pageW,
				clientHeight: pageH,
			});
			setOver((m) => (m.get(source) === result ? m : new Map(m).set(source, result)));
		};
		check();
		void page.fonts?.ready.then(check);
	};

	return (
		<div ref={stage} data-testid="cheat-sheet-stage" className="min-h-0 min-w-0 flex-1 overflow-auto">
			<div className="lh-print-sheet mx-auto flex flex-wrap justify-center py-7" style={{ gap: PAGE_GAP, maxWidth: perRow * pageW * scale + (perRow - 1) * PAGE_GAP + 2 }}>
				{sources.map((source, i) => {
					const runs = over.get(source) === true;
					const caption = pageCaption(i, sources.length);
					return (
						<figure key={i} className="lh-sheet-slot m-0 flex shrink-0 flex-col" style={{ width: pageW * scale }}>
							<div className="lh-sheet-frame relative" style={{ width: pageW * scale, height: pageH * scale }}>
								<div className={cn("lh-sheet-page absolute top-0 left-0 bg-white", runs && "outline outline-2 outline-(--lh-ramp-1)")} style={{ width: pageW, height: pageH, transform: `scale(${scale})`, transformOrigin: "top left" }}>
									<iframe
										data-testid="cheat-sheet-page"
										title={caption || "Cheat sheet"}
										sandbox="allow-same-origin"
										srcDoc={source}
										onLoad={(e) => measure(source, e.currentTarget)}
										className="block border-0"
										style={{ width: pageW, height: pageH }}
									/>
								</div>
							</div>
							<figcaption className={cn("lh-sheet-caption flex items-end text-[12.5px]", runs ? "text-ans-wrong" : "text-ink-3")} style={{ height: CAPTION }}>
								{[caption, runs ? "Runs over" : ""].filter(Boolean).join(" · ")}
							</figcaption>
						</figure>
					);
				})}
			</div>
		</div>
	);
}

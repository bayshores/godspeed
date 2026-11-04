"use client";

import { useEffect, useRef } from "react";
import type { SheetPage } from "@/core";
import { PX_PER_PT } from "./canvas-model";
import { drawPage, openPdf } from "./pdf";

/**
 * A small picture of a PDF's first page, drawn by pdf.js only once the
 * card scrolls into view, then the PDF is closed again: a page of cards
 * holds one small bitmap each, never whole documents.
 */
export function PdfThumb({ url, page, width }: { url: string; page: SheetPage; width: number }) {
	const box = useRef<HTMLDivElement>(null);
	const height = Math.round((width * page.heightPt) / page.widthPt);
	useEffect(() => {
		const el = box.current;
		if (!el) return;
		let gone = false;
		let cancel = () => {};
		const draw = async () => {
			const doc = await openPdf(url);
			try {
				if (gone) return;
				const first = await doc.getPage(1);
				const scale = (width / (page.widthPt * PX_PER_PT)) * (window.devicePixelRatio || 1);
				const task = drawPage(first, { scale, width: page.widthPt * PX_PER_PT * scale, height: page.heightPt * PX_PER_PT * scale });
				cancel = task.cancel;
				const canvas = await task.done;
				if (canvas && !gone) el.replaceChildren(Object.assign(canvas, { style: "display:block;width:100%;height:100%" }));
			} finally {
				void doc.loadingTask.destroy();
			}
		};
		const seen = new IntersectionObserver((entries) => {
			if (!entries.some((e) => e.isIntersecting)) return;
			seen.disconnect();
			draw().catch((err: unknown) => console.error("[cheat-sheet] couldn't draw a preview:", err));
		});
		seen.observe(el);
		return () => {
			gone = true;
			seen.disconnect();
			cancel();
		};
	}, [url, page.widthPt, page.heightPt, width]);
	return <div ref={box} data-testid="cheat-sheet-thumb" className="bg-white" style={{ width, height }} />;
}

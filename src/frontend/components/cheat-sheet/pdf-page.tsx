"use client";

import { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { visiblePart, type Artboard, type Camera } from "./canvas-model";
import { drawPage } from "./pdf";

/** The whole page is drawn once at this zoom; past it, the part on screen
 *  is drawn again at the screen's own resolution once the view settles. */
const BASE_ZOOM = 0.5;

/**
 * One PDF page on the canvas, white at its real size. Crisp at any zoom
 * without holding a huge bitmap: a light whole-page drawing sits under a
 * second drawing of just the part on screen, made at the zoom the view
 * settled on (it scales with the canvas while a gesture is going, then is
 * drawn again).
 */
export function PdfPage({ doc, board, cam, view }: { doc: PDFDocumentProxy | "failed" | undefined; board: Artboard; cam: Camera; view: { w: number; h: number } }) {
	const whole = useRef<HTMLDivElement>(null);
	const part = useRef<HTMLDivElement>(null);
	const ready = doc && doc !== "failed" ? doc : null;

	useEffect(() => {
		if (!ready) return;
		const dpr = window.devicePixelRatio || 1;
		let cancel = () => {};
		let gone = false;
		void ready
			.getPage(board.page + 1)
			.then((page) => {
				if (gone) return null;
				const draw = drawPage(page, { scale: BASE_ZOOM * dpr, width: board.w * BASE_ZOOM * dpr, height: board.h * BASE_ZOOM * dpr });
				cancel = draw.cancel;
				return draw.done;
			})
			.then((canvas) => {
				if (canvas && !gone) whole.current?.replaceChildren(fill(canvas));
			})
			.catch((err: unknown) => console.error("[cheat-sheet] couldn't draw a page:", err));
		return () => {
			gone = true;
			cancel();
		};
	}, [ready, board.page, board.w, board.h]);

	const seen = cam.zoom > BASE_ZOOM ? visiblePart(cam, { x: board.x, y: board.y, w: board.w, h: board.h }, view) : null;
	const key = seen ? [seen.x, seen.y, seen.w, seen.h, cam.zoom].map((v) => v.toFixed(2)).join(",") : "";
	useEffect(() => {
		if (!ready || !key) {
			part.current?.replaceChildren();
			return;
		}
		const [x, y, w, h, zoom] = key.split(",").map(Number) as [number, number, number, number, number];
		const scale = zoom * (window.devicePixelRatio || 1);
		let cancel = () => {};
		let gone = false;
		void ready
			.getPage(board.page + 1)
			.then((page) => {
				if (gone) return null;
				const draw = drawPage(page, { scale, width: w * scale, height: h * scale, offset: { x: x * scale, y: y * scale } });
				cancel = draw.cancel;
				return draw.done;
			})
			.then((canvas) => {
				if (!canvas || gone) return;
				Object.assign(canvas.style, { position: "absolute", left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
				part.current?.replaceChildren(canvas);
			})
			.catch((err: unknown) => console.error("[cheat-sheet] couldn't draw a page:", err));
		return () => {
			gone = true;
			cancel();
		};
	}, [ready, board.page, key]);

	return (
		<div data-testid="cheat-sheet-page" className="absolute bg-white" style={{ left: board.x, top: board.y, width: board.w, height: board.h }}>
			<div ref={whole} className="absolute inset-0" />
			<div ref={part} className="absolute inset-0" />
			{doc === "failed" && <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-black/60">Couldn&apos;t show this page.</p>}
		</div>
	);
}

function fill(canvas: HTMLCanvasElement): HTMLCanvasElement {
	Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
	return canvas;
}

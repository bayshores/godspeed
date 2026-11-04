"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { PX_PER_PT } from "./canvas-model";

/**
 * pdf.js in the browser, loaded on first use. Its worker and data come
 * from the app (/pdfjs/), so cheat sheets show offline. The PDF's bytes
 * are fetched by the page itself: in the desktop app only the window's
 * main frame may read /api.
 */
let lib: Promise<typeof import("pdfjs-dist")> | null = null;

function pdfjs(): Promise<typeof import("pdfjs-dist")> {
	return (lib ??= import("pdfjs-dist").then((m) => {
		m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
		return m;
	}));
}

/** A PDF's bytes, as the server keeps them. */
async function pdfBytes(url: string): Promise<Uint8Array> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Couldn't load the PDF (${res.status}).`);
	return new Uint8Array(await res.arrayBuffer());
}

/** A PDF opened with pdf.js. */
export async function openPdf(url: string): Promise<PDFDocumentProxy> {
	const [m, data] = await Promise.all([pdfjs(), pdfBytes(url)]);
	return m.getDocument({ data, cMapUrl: "/pdfjs/cmaps/", standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/", iccUrl: "/pdfjs/iccs/", enableXfa: false }).promise;
}

/** Each URL's PDF once it is open ("failed" when it can't be). Each URL
 *  opens once while the studio is up, and closes when it leaves the list
 *  or the studio goes. */
export function usePdfs(urls: readonly string[]): ReadonlyMap<string, PDFDocumentProxy | "failed"> {
	const [docs, setDocs] = useState<ReadonlyMap<string, PDFDocumentProxy | "failed">>(new Map());
	const open = useRef(new Map<string, Promise<PDFDocumentProxy>>());
	const key = urls.join(" ");
	useEffect(() => {
		const want = new Set(key ? key.split(" ") : []);
		for (const [url, doc] of open.current) {
			if (want.has(url)) continue;
			open.current.delete(url);
			void doc.then((d) => d.loadingTask.destroy(), () => {});
			setDocs((m) => new Map([...m].filter(([u]) => u !== url)));
		}
		for (const url of want) {
			if (open.current.has(url)) continue;
			const doc = openPdf(url);
			open.current.set(url, doc);
			doc.then(
				(d) => {
					if (open.current.get(url) === doc) setDocs((m) => new Map(m).set(url, d));
				},
				(err: unknown) => {
					console.error("[cheat-sheet] couldn't open the PDF:", err);
					if (open.current.get(url) === doc) setDocs((m) => new Map(m).set(url, "failed"));
				},
			);
		}
	}, [key]);
	useEffect(() => {
		const all = open.current;
		return () => {
			for (const doc of all.values()) void doc.then((d) => d.loadingTask.destroy(), () => {});
			all.clear();
		};
	}, []);
	return docs;
}

/** Draw a page (or the part of it at `offset`, in device pixels) into a
 *  new canvas of `width` × `height` device pixels at `scale` device pixels
 *  per CSS pixel. Resolves to the canvas, or null when cancelled. */
export function drawPage(
	page: PDFPageProxy,
	o: { scale: number; width: number; height: number; offset?: { x: number; y: number }; intent?: "display" | "print" },
): { done: Promise<HTMLCanvasElement | null>; cancel: () => void } {
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(o.width));
	canvas.height = Math.max(1, Math.round(o.height));
	const viewport = page.getViewport({ scale: o.scale * PX_PER_PT });
	const task = page.render({ canvas, viewport, intent: o.intent ?? "display", ...(o.offset ? { transform: [1, 0, 0, 1, -o.offset.x, -o.offset.y] } : {}) });
	return {
		done: task.promise.then(
			() => canvas,
			(err: unknown) => {
				if ((err as { name?: string })?.name === "RenderingCancelledException") return null;
				throw err;
			},
		),
		cancel: () => task.cancel(),
	};
}

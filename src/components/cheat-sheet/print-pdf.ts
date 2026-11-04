"use client";

import { drawPage, openPdf } from "./pdf";

/** Print resolution, in dots per inch. */
const PRINT_DPI = 300;

/**
 * Print a PDF as it is: each page drawn by pdf.js at print resolution,
 * one sheet of paper per page at the PDF's own size (the first page's; a
 * cheat sheet's pages share one), and nothing else of the app (print CSS
 * in globals.css). pdf.js's own viewer prints the same way, so it works
 * alike in the desktop app and a browser.
 */
export async function printPdf(url: string): Promise<void> {
	const doc = await openPdf(url);
	const sheet = document.createElement("div");
	sheet.className = "lh-print-sheet";
	const style = document.createElement("style");
	const images: string[] = [];
	const cleanUp = () => {
		sheet.remove();
		style.remove();
		for (const u of images) URL.revokeObjectURL(u);
	};
	try {
		let size = "";
		for (let i = 1; i <= doc.numPages; i++) {
			const page = await doc.getPage(i);
			const { width, height } = page.getViewport({ scale: 1 });
			const w = width / 72;
			const h = height / 72;
			size ||= `${w}in ${h}in`;
			const canvas = await drawPage(page, { scale: PRINT_DPI / 96, width: w * PRINT_DPI, height: h * PRINT_DPI, intent: "print" }).done;
			const blob = canvas && (await new Promise<Blob | null>((r) => canvas.toBlob(r)));
			if (!blob) throw new Error("Couldn't draw the page to print.");
			const img = document.createElement("img");
			img.src = URL.createObjectURL(blob);
			images.push(img.src);
			Object.assign(img.style, { width: `${w}in`, height: `${h}in` });
			sheet.append(img);
		}
		style.textContent = `@page { size: ${size}; margin: 0; }`;
		document.head.append(style);
		document.body.append(sheet);
		await Promise.all([...sheet.querySelectorAll("img")].map((img) => img.decode()));
		window.addEventListener("afterprint", cleanUp, { once: true });
		window.print();
	} catch (err) {
		cleanUp();
		throw err;
	} finally {
		void doc.loadingTask.destroy();
	}
}

/**
 * PDF → text on a worker thread (speed plan, owner 2026-10-27).
 *
 * pdfjs in plain Node parses on the thread that calls it. Run on the server's
 * main thread, a big class PDF froze every API request for 0.5–2 s. This
 * worker does the same extraction off that thread.
 *
 * Plain .mjs on purpose: the standalone server ships no TypeScript, and the
 * bundler never sees this file (it is loaded by path — next.config.ts traces
 * it in). Output MUST match pdf-ops.ts pdfExtract(file, "all") byte for byte:
 * "--- Page N ---" then the page's text items joined, lines joined by "\n".
 * tests/pdf-text-worker.test.ts holds the two to each other.
 */
import { readFile } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

const { filePath, standardFontDataUrl } = workerData;

try {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const data = new Uint8Array(await readFile(filePath));
	const task = pdfjs.getDocument({ data, standardFontDataUrl, verbosity: 0 });
	const doc = await task.promise;
	const out = [];
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		let text = "";
		for (const it of content.items) {
			if (it && typeof it === "object" && typeof it.str === "string") text += it.str;
		}
		out.push(`--- Page ${i} ---`);
		out.push(text);
	}
	await task.destroy();
	parentPort.postMessage({ ok: true, text: doc.numPages === 0 ? "No pages selected — page spec matched nothing." : out.join("\n") });
} catch (err) {
	parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
